/**
 * 靈動島 (Electron 視窗版)
 *
 * 島是 app 的一個 frameless 透明置頂視窗,不是獨立程式 —— app 結束它就跟著消失,
 * 設定與歌詞跟網頁共用同一份來源 (views/island.ejs 直接接 server 的 WebSocket 廣播)。
 *
 * 拖曳刻意不用 -webkit-app-region: drag (沒有拖曳結束事件,做不了吸附判定),
 * 也不用「每次 mousemove 送一次 IPC」(跨進程,60Hz 下容易掉幀)。
 * 改成:renderer 只在按下/放開各送一次 IPC,移動期間由主進程自己讀游標
 * (screen.getCursorScreenPoint) 並 setBounds —— 全程在主進程,沒有 per-frame IPC。
 */
const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');
const { displayKey, pickPosition } = require('./island-position.js');

// 視窗要比島本體寬:貼齊頂端時左右的「外擴角」畫在這段透明邊裡
const EDGE = 24;
const BASE_WIDTH = 420;   // 開窗時的起始尺寸,之後由頁面量到的內容尺寸接手
const BASE_HEIGHT = 64;
const MIN_WIDTH = 220;
const MIN_HEIGHT = 36;
const DOCK_THRESHOLD = 2;   // 視窗頂端離工作區頂端多近就算吸附
const DRAG_HZ = 120;         // 游標取樣頻率,高於螢幕更新率才不會是動畫瓶頸

let win = null;
let dragTimer = null;
let dockAnim = null;
let serverPort = 5720;

function settings() {
  try { return global.readSettings ? global.readSettings() : {}; } catch (e) { return {}; }
}

// 只是開窗時的起始尺寸。真正的寬高由頁面量完內容回報 (island:resize) —— 行數、假名開關
// 會影響實際高度,在這裡用公式猜一定會錯。島的字級固定,不隨 font_size 變 (見 island.ejs)。
function windowSize() {
  return {
    width: BASE_WIDTH + EDGE * 2,
    height: BASE_HEIGHT
  };
}

// 位置判定 (含多螢幕記憶與防呆) 全在 island-position.js,這裡只負責餵現況給它
function startPosition(width, height) {
  return pickPosition(settings(), screen.getAllDisplays(), { width, height }, screen.getPrimaryDisplay());
}

// 螢幕熱插拔:記住的那台被拔掉/插回來/改解析度,島都要跟著重新落位,
// 否則島會留在一個已經不存在的座標上 (看起來就是「島不見了」)。
let screenWatched = false;
function watchScreens() {
  if (screenWatched) return;
  screenWatched = true;
  const relocate = () => {
    if (!win) return;
    const b = win.getBounds();
    const { x, y, docked } = startPosition(b.width, b.height);
    win.setBounds({ x, y, width: b.width, height: b.height });
    win.webContents.send('island:docked', docked);
  };
  screen.on('display-added', relocate);
  screen.on('display-removed', relocate);
  screen.on('display-metrics-changed', relocate);
}

function openIsland(port) {
  if (port) serverPort = port;
  if (win) { win.show(); return win; }

  const { width, height } = windowSize();
  const { x, y, docked } = startPosition(width, height);
  watchScreens();

  win = new BrowserWindow({
    width, height, x, y,
    frame: false,
    transparent: true,
    resizable: false,        // transparent 視窗改尺寸會閃,尺寸只在設定變更時由程式調
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload-island.js') }
  });
  // 'screen-saver' 這一層才蓋得過全螢幕播放的影片
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadURL(`http://127.0.0.1:${serverPort}/island`);
  win.once('ready-to-show', () => {
    if (!win) return;
    win.show();
    win.webContents.send('island:docked', docked);
  });
  win.on('closed', () => { stopDrag(); win = null; });
  return win;
}

function closeIsland() {
  if (win) win.destroy();   // close 事件沒人攔,destroy 比較直接;closed 會清掉 win
  win = null;
  stopDrag();
  clearInterval(dockAnim);
}

function isIslandOpen() { return !!win; }

// 拖到奇怪的地方 (或存了一個已拔掉的螢幕座標) 時的退路:清掉記住的位置,回到主螢幕上方置中
function resetIslandPosition() {
  clearInterval(dockAnim);   // 吸附動畫還在跑的話會把 y 拉回去,重置就白做了
  if (global.updateSettings) {
    // 每台螢幕的記錄也要一起清 —— 只清 island_x/y 的話,下次開島又從 island_pos 跳回舊位置
    try {
      global.updateSettings({
        island_x: null, island_y: null, island_docked: true,
        island_pos: {}, island_display: null
      });
    } catch (e) {}
  }
  if (!win) return;
  const b = win.getBounds();
  const { workArea } = screen.getPrimaryDisplay();
  win.setBounds({
    x: Math.round(workArea.x + (workArea.width - b.width) / 2),
    y: workArea.y, width: b.width, height: b.height
  });
  win.webContents.send('island:docked', true);
}


function stopDrag() {
  if (dragTimer) { clearInterval(dragTimer); dragTimer = null; }
}

// 位置存兩份:island_pos 是「每台螢幕各記一組」(多螢幕記憶的正路),
// island_x/y 留著當退路 —— 改版前的設定、以及 island_pos 裡的螢幕全被拔掉時還有東西可用。
// updateSettings 是淺層合併,所以整份 map 要自己併好再交出去,不能只傳新增的那一筆。
function savePosition(docked) {
  if (!win || !global.updateSettings) return;
  const b = win.getBounds();
  const key = displayKey(screen.getDisplayNearestPoint({ x: b.x, y: b.y }));
  const s = settings();
  const pos = Object.assign({}, s.island_pos);
  pos[key] = { x: b.x, y: b.y, docked: !!docked };
  try {
    global.updateSettings({
      island_x: b.x, island_y: b.y, island_docked: !!docked,
      island_pos: pos, island_display: key
    });
  } catch (e) {}
}

// 吸附/脫離都用同一段:把視窗 y 用 easing 推到目標,同時告訴 renderer 切圓角
function animateY(targetY, ms = 260, done) {
  if (!win) return;
  clearInterval(dockAnim);
  const startY = win.getBounds().y;
  const startAt = Date.now();
  dockAnim = setInterval(() => {
    if (!win) return clearInterval(dockAnim);
    const t = Math.min(1, (Date.now() - startAt) / ms);
    const ease = 1 - Math.pow(1 - t, 4);   // easeOutQuart,跟舊的 C# 島同一條曲線
    const b = win.getBounds();
    win.setBounds({ ...b, y: Math.round(startY + (targetY - startY) * ease) });
    if (t >= 1) { clearInterval(dockAnim); if (done) done(); }
  }, 8);
}

ipcMain.on('island:drag-start', () => {
  if (!win || settings().island_locked) return;
  clearInterval(dockAnim);
  const cursor = screen.getCursorScreenPoint();
  const b = win.getBounds();
  const offX = cursor.x - b.x;
  const offY = cursor.y - b.y;
  let wasDocked = true;

  stopDrag();
  dragTimer = setInterval(() => {
    if (!win) return stopDrag();
    const c = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    win.setBounds({ x: c.x - offX, y: c.y - offY, width: bounds.width, height: bounds.height });
    // 往下拖離吸附區的瞬間就恢復圓角,不等放開 (舊島的手感)
    const top = screen.getDisplayNearestPoint(c).workArea.y;
    const docked = (c.y - offY) - top < DOCK_THRESHOLD;
    if (docked !== wasDocked) {
      wasDocked = docked;
      win.webContents.send('island:docked', docked);
    }
  }, Math.round(1000 / DRAG_HZ));
});

ipcMain.on('island:drag-end', () => {
  stopDrag();
  // 鎖定時 drag-start 就沒開始拖,這裡也要跟著早退 —— 否則在島上點一下就會白寫一次 settings.json
  if (!win || settings().island_locked) return;
  const b = win.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const docked = b.y - workArea.y < DOCK_THRESHOLD;
  win.webContents.send('island:docked', docked);
  if (docked) animateY(workArea.y, 220, () => savePosition(true));
  else savePosition(false);
});

// 單擊 = 在「貼齊頂端」與「浮在下面一點」之間切換
ipcMain.on('island:toggle-dock', () => {
  if (!win || settings().island_locked) return;
  const b = win.getBounds();
  const { workArea } = screen.getDisplayNearestPoint({ x: b.x, y: b.y });
  const docked = b.y - workArea.y < DOCK_THRESHOLD;
  win.webContents.send('island:docked', !docked);
  animateY(docked ? workArea.y + 28 : workArea.y, 260, () => savePosition(!docked));
});

// 頁面量完內容要多大就回報,視窗跟著縮放 —— 島才會「貼著歌詞」而不是一個固定的大黑框。
// 寬度以中心點為錨 (視窗置中時看起來就是兩邊一起收);寬高各留 8px 死區,免得逐句抖動。
// 高度也吃頁面量到的值:ruby 有沒有顯示、一行還兩行、字體大小,全部自動貼合,不用維護對照表。
// 逐行切換時「只長不縮」:短行藥丸靠 CSS 在視窗內收窄 (不閃),只有更寬的行才把視窗撐大一次
// (透明視窗改尺寸會閃,次數壓到最低)。歌名/前奏/設定變更 growOnly=false,讓視窗剛好貼合、
// 允許縮回 —— 那些是低頻事件,而歌名通常比歌詞行寬,不放它縮的話整首歌會卡在歌名的寬度。
let maxW = 0, maxH = 0;
ipcMain.on('island:resize', (_e, size) => {
  if (!win || !size) return;
  const b = win.getBounds();
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const wantW = Math.max(MIN_WIDTH, Math.min(Math.round(size.width) + EDGE * 2, wa.width));
  const wantH = size.height ? Math.max(MIN_HEIGHT, Math.round(size.height)) : b.height;
  const width = maxW = size.growOnly ? Math.max(maxW, wantW) : wantW;
  const height = maxH = size.growOnly ? Math.max(maxH, wantH) : wantH;
  if (Math.abs(width - b.width) < 8 && Math.abs(height - b.height) < 8) return;
  const centerX = b.x + b.width / 2;
  const x = Math.round(Math.min(Math.max(centerX - width / 2, wa.x), wa.x + wa.width - width));
  // 吸附狀態下高度變化不能把島往下推,上緣要一直貼著工作區頂端
  const y = b.y - wa.y < DOCK_THRESHOLD ? wa.y : b.y;
  win.setBounds({ x, y, width, height });
});

module.exports = { openIsland, closeIsland, isIslandOpen, resetIslandPosition };
