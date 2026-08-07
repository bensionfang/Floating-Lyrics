'use strict';
// Windows 11 只在「最大化」時自己收成直角,貼齊 (半螢幕 / 1/4 螢幕) 仍然是圓角,
// 邊緣就會留下一圈跟螢幕或鄰居視窗對不上的缺口。這支在貼齊時把 DWM 的
// DWMWA_WINDOW_CORNER_PREFERENCE 改成 DONOTROUND,離開貼齊再改回 ROUND。
// Electron 33 的 roundedCorners 只能在建立視窗時給,沒有 setter,所以只能走 DWM。
const { spawn } = require('child_process');

const DWMWA_WINDOW_CORNER_PREFERENCE = 33;
const DWMWCP_DONOTROUND = 1;
const DWMWCP_ROUND = 2;

// getBounds 與工作區邊界會差幾 px (Win11 的隱形調整邊框)
const FLUSH = 8;

/**
 * 貼齊 = 至少兩條邊與工作區切齊 (半螢幕 3 條、1/4 螢幕 2 條、最大化 4 條)。
 * 一般視窗剛好拖到角落也會中,但那時本來就該是直角,誤判無害 ——
 * 反過來去列舉 Windows 的各種 snap layout (halves / quarters / thirds) 才是坑。
 */
function isSnapped(b, wa) {
  let n = 0;
  if (Math.abs(b.x - wa.x) <= FLUSH) n++;
  if (Math.abs(b.y - wa.y) <= FLUSH) n++;
  if (Math.abs((b.x + b.width) - (wa.x + wa.width)) <= FLUSH) n++;
  if (Math.abs((b.y + b.height) - (wa.y + wa.height)) <= FLUSH) n++;
  return n >= 2;
}

// ponytail: 用 PowerShell + Add-Type 打 P/Invoke,零相依但每次切換有約 1 秒延遲
// (只在貼齊狀態真的改變時才 spawn,一般拖曳/縮放不會打到)。要即時就換成 koffi。
function applyCorners(win, round) {
  if (process.platform !== 'win32') return;
  let hwnd;
  try {
    const buf = win.getNativeWindowHandle();
    hwnd = buf.length >= 8 ? buf.readBigInt64LE(0) : BigInt(buf.readInt32LE(0));
  } catch { return; }
  const pref = round ? DWMWCP_ROUND : DWMWCP_DONOTROUND;
  const ps =
    "Add-Type -Namespace K -Name W -MemberDefinition '[DllImport(\"dwmapi.dll\")] public static extern int DwmSetWindowAttribute(IntPtr h,int a,ref int v,int s);';" +
    `$v=${pref};[K.W]::DwmSetWindowAttribute([IntPtr]${hwnd},${DWMWA_WINDOW_CORNER_PREFERENCE},[ref]$v,4) | Out-Null`;
  try {
    spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      windowsHide: true, stdio: 'ignore'
    }).on('error', () => {});
  } catch { /* 沒有 powershell 就算了,只是圓角沒切掉 */ }
}

function watch(win) {
  if (process.platform !== 'win32') return;
  const { screen } = require('electron'); // 延後 require,測試才載得到這支檔案
  let snapped = false; // 建立時是圓角,所以初值就是「沒貼齊」,不必先打一次
  let timer = null;
  const check = () => {
    if (win.isDestroyed()) return;
    const b = win.getBounds();
    const now = win.isMaximized() || isSnapped(b, screen.getDisplayMatching(b).workArea);
    if (now === snapped) return;
    snapped = now;
    applyCorners(win, !now);
  };
  const debounced = () => { clearTimeout(timer); timer = setTimeout(check, 150); };
  for (const ev of ['resize', 'move', 'maximize', 'unmaximize']) win.on(ev, debounced);
}

module.exports = { isSnapped, applyCorners, watch };
