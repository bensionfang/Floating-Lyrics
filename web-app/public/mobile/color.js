/**
 * 封面主色 → 背景色。純函式,獨立成檔的理由同 lyrics.js:測試 require 得到,
 * 瀏覽器則當一般 <script> 載入。
 *
 * 數學照抄電腦版 (public/js/app.js 的 coverImg.onload):整張圖的 RGB 平均、
 * 壓到 65% 亮度、再用亮度決定非活躍歌詞該用黑透明還是白透明。**不要另外發明一套** ——
 * 兩邊看起來要是同一個 app。
 */

const DARKEN = 0.65;      // 壓暗係數:平均色直接當底太亮,歌詞會看不清楚
const LUMA_SPLIT = 80;    // 亮度分界,超過就代表背景偏亮,非活躍字要用黑色系

// 沒有封面、圖還沒載完、canvas 被跨網域污染時都用這組 (電腦版 catch 分支的同一組值)。
// **宣告要放在 pickBg 之前** —— const 有 TDZ,擺後面的話早退那條路是靠「呼叫時模組已經
// 跑完」才沒炸,改成模組載入期呼叫就會踩到
const FALLBACK = { bg: '#121212', dim: 'rgba(255,255,255,0.5)' };

/** 取像素陣列 (ctx.getImageData().data,RGBA 四個一組) 的平均色 → 背景與非活躍字色 */
function pickBg(pixels) {
  const count = pixels && pixels.length ? pixels.length / 4 : 0;
  if (!count) return FALLBACK;

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    r += pixels[i];
    g += pixels[i + 1];
    b += pixels[i + 2];
  }
  r = Math.floor((r / count) * DARKEN);
  g = Math.floor((g / count) * DARKEN);
  b = Math.floor((b / count) * DARKEN);

  // 亮度用感知加權 (綠色對人眼最亮),不是三色平均
  const luma = 0.299 * r + 0.587 * g + 0.114 * b;
  return {
    bg: `rgb(${r}, ${g}, ${b})`,
    dim: luma > LUMA_SPLIT ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)',
  };
}

if (typeof module !== 'undefined') {
  module.exports = { pickBg, FALLBACK, DARKEN, LUMA_SPLIT };
}
