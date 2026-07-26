/**
 * 靈動島的開窗位置判定 —— 純函式,不 require electron,所以測試 (test_island_position.js)
 * require 得到而不必起 Electron (island.js 第一行就 require('electron'))。
 * 理由同 s2t.js / scroll-zone.js / game.js。
 *
 * 螢幕的鍵用**工作區幾何**而不是 display.id:Windows 的 id 是每次列舉時生成的,
 * 重開機或重接線就可能變,存進 settings.json 後對不上等於沒記。
 * 幾何在「同一套螢幕配置」下穩定,而配置真的變了本來就該重新判位置。
 * ponytail: 幾何當鍵,兩台工作區完全重疊的螢幕會共用一筆 —— 那種配置不存在。
 */

function displayKey(display) {
  const wa = (display && display.workArea) || {};
  return `${wa.x},${wa.y},${wa.width}x${wa.height}`;
}

// 把座標夾進某台螢幕的工作區。island.js 原本的 clampToScreen 就是這段。
function clampTo(display, x, y, size) {
  const wa = display.workArea;
  return {
    x: Math.round(Math.min(Math.max(x, wa.x), wa.x + wa.width - size.width)),
    y: Math.round(Math.min(Math.max(y, wa.y), wa.y + wa.height - size.height))
  };
}

function nearestDisplay(displays, x, y) {
  let best = displays[0], bestDist = Infinity;
  for (const d of displays) {
    const wa = d.workArea;
    // 點到矩形的距離 (在矩形內是 0)
    const dx = Math.max(wa.x - x, 0, x - (wa.x + wa.width));
    const dy = Math.max(wa.y - y, 0, y - (wa.y + wa.height));
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) { bestDist = dist; best = d; }
  }
  return best;
}

/**
 * 決定島要開在哪裡。回 { x, y, docked }。
 *
 * 依序:
 *   1. island_display 記的那台螢幕還在,且 island_pos 有它 → 用那筆 (多螢幕位置記憶的正路)
 *   2. island_pos 裡任一筆對應到還在的螢幕 → 用它 (記的那台被拔掉,但別台有記錄)
 *   3. 舊的 island_x/island_y → 用它 (改版前的設定;重設寫的是 null,所以用 isFinite 判)
 *   4. 主螢幕上緣置中
 * 座標一律夾進所屬螢幕的工作區。
 */
function pickPosition(settings, displays, size, primary) {
  const s = settings || {};
  const list = (displays && displays.length) ? displays : [];
  const home = primary || list[0];
  const byKey = new Map(list.map(d => [displayKey(d), d]));
  const map = s.island_pos && typeof s.island_pos === 'object' ? s.island_pos : {};

  const useEntry = (key) => {
    const d = byKey.get(key);
    const p = map[key];
    if (!d || !p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    return { ...clampTo(d, p.x, p.y, size), docked: p.docked !== false };
  };

  const wanted = useEntry(s.island_display);
  if (wanted) return wanted;

  for (const key of Object.keys(map)) {
    const hit = useEntry(key);
    if (hit) return hit;
  }

  if (Number.isFinite(s.island_x) && Number.isFinite(s.island_y)) {
    const d = nearestDisplay(list, s.island_x, s.island_y) || home;
    return { ...clampTo(d, s.island_x, s.island_y, size), docked: s.island_docked !== false };
  }

  const wa = home.workArea;
  return {
    x: Math.round(wa.x + (wa.width - size.width) / 2),
    y: Math.round(wa.y),
    docked: true
  };
}

module.exports = { displayKey, clampTo, nearestDisplay, pickPosition };
