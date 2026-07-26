// 靈動島多螢幕位置記憶的回歸測試:node test_island_position.js
const assert = require('assert');
const { displayKey, pickPosition } = require('./web-app/island-position.js');

const SIZE = { width: 468, height: 64 };   // BASE_WIDTH + EDGE*2, BASE_HEIGHT

// 主螢幕 1920x1080 (工作列佔 40px),右邊接一台 1280x1024
const main = { workArea: { x: 0, y: 0, width: 1920, height: 1040 } };
const ext = { workArea: { x: 1920, y: 0, width: 1280, height: 1024 } };
const KEY_MAIN = '0,0,1920x1040';
const KEY_EXT = '1920,0,1280x1024';

assert.strictEqual(displayKey(main), KEY_MAIN, '鍵是工作區幾何,不是 display.id');
assert.strictEqual(displayKey(ext), KEY_EXT);

// 1. 記住的螢幕還在 → 回到記住的座標
assert.deepStrictEqual(
  pickPosition({
    island_display: KEY_EXT,
    island_pos: { [KEY_EXT]: { x: 2100, y: 300, docked: false } }
  }, [main, ext], SIZE, main),
  { x: 2100, y: 300, docked: false },
  '記住的第二螢幕還在,原位開回去'
);

// 2. 記住的螢幕被拔掉 → 落在還在的螢幕裡 (island_pos 另一筆)
assert.deepStrictEqual(
  pickPosition({
    island_display: KEY_EXT,
    island_pos: {
      [KEY_EXT]: { x: 2100, y: 300, docked: false },
      [KEY_MAIN]: { x: 700, y: 0, docked: true }
    }
  }, [main], SIZE, main),
  { x: 700, y: 0, docked: true },
  '第二螢幕拔掉,退回主螢幕記過的位置'
);

// 拔掉且只記過那台 → 不能吐出螢幕外的座標
{
  const p = pickPosition({
    island_display: KEY_EXT,
    island_pos: { [KEY_EXT]: { x: 2100, y: 300, docked: false } }
  }, [main], SIZE, main);
  assert.ok(p.x >= 0 && p.x + SIZE.width <= 1920, '沒有可用記錄時不能落在拔掉的螢幕上: ' + p.x);
}

// 3. 只有舊的 island_x/y (改版前的設定) → 沿用
assert.deepStrictEqual(
  pickPosition({ island_x: 800, island_y: 120, island_docked: false }, [main, ext], SIZE, main),
  { x: 800, y: 120, docked: false },
  '相容:沒有 island_pos 就吃舊的單一組座標'
);

// 舊座標指向已拔掉的螢幕 → 夾回還在的那台
{
  const p = pickPosition({ island_x: 2500, island_y: 300 }, [main], SIZE, main);
  assert.ok(p.x + SIZE.width <= 1920, '舊座標在拔掉的螢幕上,要夾回來: ' + p.x);
}

// 4. 什麼都沒記過 → 主螢幕上緣置中
assert.deepStrictEqual(
  pickPosition({}, [main, ext], SIZE, main),
  { x: Math.round((1920 - SIZE.width) / 2), y: 0, docked: true },
  '全新安裝:主螢幕上緣置中'
);

// 重設位置寫的是 null,要當成「沒記過」而不是座標 0
assert.deepStrictEqual(
  pickPosition({ island_x: null, island_y: null, island_pos: {} }, [main], SIZE, main),
  { x: Math.round((1920 - SIZE.width) / 2), y: 0, docked: true },
  'null 不是有效座標'
);

// 5. 記的座標超出工作區 (改了解析度) → 夾回邊界內
assert.deepStrictEqual(
  pickPosition({
    island_display: KEY_MAIN,
    island_pos: { [KEY_MAIN]: { x: 5000, y: 5000, docked: false } }
  }, [main], SIZE, main),
  { x: 1920 - SIZE.width, y: 1040 - SIZE.height, docked: false },
  '越界的座標夾回工作區'
);

// 負座標的螢幕 (第二螢幕擺左邊) 也要能記
assert.deepStrictEqual(
  pickPosition({
    island_display: '-1280,0,1280x1024',
    island_pos: { '-1280,0,1280x1024': { x: -900, y: 0, docked: true } }
  }, [main, { workArea: { x: -1280, y: 0, width: 1280, height: 1024 } }], SIZE, main),
  { x: -900, y: 0, docked: true },
  '螢幕在左邊 (負座標) 一樣記得住'
);

console.log('test_island_position.js OK');
