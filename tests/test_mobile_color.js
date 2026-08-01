/**
 * 行動版的封面主色採樣 (web-app/public/mobile/color.js)。
 * 跑法:node tests/test_mobile_color.js
 */

const assert = require('assert');
const { pickBg, FALLBACK, DARKEN, LUMA_SPLIT } =
  require('../web-app/public/mobile/color.js');

/** 造一張 n 個像素、全部同色的假圖 (RGBA) */
const solid = (r, g, b, n = 16) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push(r, g, b, 255);
  return out;
};

// --- 平均與壓暗 -----------------------------------------------------------
// 純白 255 → 255 × 0.65 = 165 (取整)
const white = pickBg(solid(255, 255, 255));
assert.strictEqual(white.bg, 'rgb(165, 165, 165)', '純白應被壓到 65% 亮度');

// 兩半各一色,平均要落在中間:紅 200 與紅 0 → 100 → ×0.65 = 65
const half = solid(200, 0, 0, 8).concat(solid(0, 0, 0, 8));
assert.strictEqual(pickBg(half).bg, 'rgb(65, 0, 0)', '應取整張圖的平均色');

// 壓暗係數若被改動,上面兩條會一起錯 —— 這條說明它們的來源
assert.strictEqual(DARKEN, 0.65);

// --- 非活躍字色靠亮度決定 -------------------------------------------------
// 亮背景 → 非活躍歌詞要用黑色系,否則白字疊白底看不見
assert.strictEqual(white.dim, 'rgba(0,0,0,0.5)', '亮背景的非活躍字要用黑透明');
// 暗背景 → 白色系
assert.strictEqual(pickBg(solid(0, 0, 0)).dim, 'rgba(255,255,255,0.5)');

// 亮度是感知加權不是三色平均:純藍很暗 (0.114),純綠很亮 (0.587)。
// 兩者的 RGB 平均一模一樣,分不出來的話這兩條會有一條掛掉。
assert.strictEqual(pickBg(solid(0, 0, 255)).dim, 'rgba(255,255,255,0.5)', '純藍算暗背景');
assert.strictEqual(pickBg(solid(0, 255, 0)).dim, 'rgba(0,0,0,0.5)', '純綠算亮背景');

// 分界值本身:綠 214 × 0.65 = 139,139 × 0.587 = 81.6 > 80 → 亮
assert.ok(0.587 * Math.floor(214 * DARKEN) > LUMA_SPLIT);
assert.strictEqual(pickBg(solid(0, 214, 0)).dim, 'rgba(0,0,0,0.5)');

// --- 沒有像素就退回預設 ---------------------------------------------------
// 封面還沒載完、沒有 album、canvas 被跨網域污染都會走到這裡,不可以丟例外
for (const empty of [[], null, undefined]) {
  assert.deepStrictEqual(pickBg(empty), FALLBACK, '沒有像素時要回 FALLBACK 而不是炸掉');
}
assert.strictEqual(FALLBACK.bg, '#121212');

console.log('test_mobile_color: 全部通過');
