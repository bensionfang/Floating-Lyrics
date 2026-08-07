// node tests/test_win_corners.js — 貼齊判定 (半螢幕 / 1-4 螢幕 / 最大化 / 一般視窗)
const assert = require('assert');
const { isSnapped } = require('../web-app/win-corners.js');

const wa = { x: 0, y: 0, width: 1920, height: 1040 }; // 工作區 (扣掉工作列)
const T = (b) => isSnapped(b, wa);

// 一般視窗:置中,四條邊都不貼
assert.strictEqual(T({ x: 320, y: 100, width: 1280, height: 840 }), false);

// 左半螢幕:左、上、下三條貼
assert.strictEqual(T({ x: 0, y: 0, width: 960, height: 1040 }), true);
// 右半螢幕
assert.strictEqual(T({ x: 960, y: 0, width: 960, height: 1040 }), true);
// 左上 1/4:左、上兩條貼
assert.strictEqual(T({ x: 0, y: 0, width: 960, height: 520 }), true);
// 右下 1/4
assert.strictEqual(T({ x: 960, y: 520, width: 960, height: 520 }), true);
// 最大化
assert.strictEqual(T({ x: 0, y: 0, width: 1920, height: 1040 }), true);

// 隱形調整邊框造成的幾 px 誤差要吃掉
assert.strictEqual(T({ x: -7, y: 0, width: 967, height: 1047 }), true);

// 只貼一條邊 (拖到左邊但沒 snap) 不算
assert.strictEqual(T({ x: 0, y: 200, width: 800, height: 500 }), false);

// 第二台螢幕 (工作區原點非 0)
const wa2 = { x: 1920, y: -120, width: 2560, height: 1400 };
assert.strictEqual(isSnapped({ x: 1920, y: -120, width: 1280, height: 1400 }, wa2), true);
assert.strictEqual(isSnapped({ x: 2200, y: 100, width: 1280, height: 840 }, wa2), false);

console.log('ok');
