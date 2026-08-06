// 猜歌的計分公式。獨立成檔的理由跟 scroll-zone.js 一樣:純函式,測試 (test_game.js)
// require 得到而不必開瀏覽器;瀏覽器則是當一般 script 載入。
//
// 答對是三個加項相加,答錯倒扣一分,跳過不扣不加:
//   基本   答對就有 1 分
//   速度   5 × 2^(−t/10) —— **實際秒數的連續曲線,不是門檻**
//   連勝   連續答對的第 2 題起每題多 1 分,上限 +5 (不封頂的話後段一題抵前面十題)
//   答錯   −WRONG_PENALTY
//
// **扣分只掛在「真的按了一個錯的選項」上,跳過是 0**:不分開的話跳過等於挨罰,
// 使用者就會亂猜一個而不是跳過 —— 那反而讓成績更沒意義。答得慢照舊不倒扣
// (舊版是「滿分 10 分往下扣」,碼表旁邊掛著一個一直變小的數字,看起來像在懲罰慢慢想)。
//
// 速度用**半衰期**而不是分段門檻:門檻會讓 4.9 秒與 5.1 秒差一整分、5 秒到 9 秒卻完全一樣,
// 而使用者要的是「快多少就多拿多少」。一句話講得完 (每過 10 秒剩一半),而且永遠 > 0 ——
// 慢慢想仍然拿得到一點 —— 倒扣只針對答錯。取到小數點後一位,前幾秒的差別才看得出來
// (1 秒 4.7、3 秒 4.1、10 秒 2.5、30 秒 0.6)。
const SPEED_MAX = 5;      // t=0 時的速度分
const HALF_LIFE = 10;     // 每過幾秒剩一半
const STREAK_CAP = 5;
const WRONG_PENALTY = 1;  // 答錯倒扣 (跳過不套)
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * @param {number} elapsedMs 這題花掉的時間
 * @param {number} streak    含這一題在內的連勝數 (第一題答對 = 1)
 * @returns {{base:number, speed:number, streak:number, total:number}}
 */
function scoreFor(elapsedMs, streak) {
  const sec = Math.max(0, elapsedMs) / 1000;
  const speed = round1(SPEED_MAX * Math.pow(2, -sec / HALF_LIFE));
  // streak 由呼叫端維護 (答錯歸零),這裡只把它換算成分數
  const bonus = Math.min(Math.max(0, streak - 1), STREAK_CAP);
  return { base: 1, speed, streak: bonus, total: round1(1 + speed + bonus) };
}

/**
 * 一題實際的加減分。答對走 scoreFor,答錯 −WRONG_PENALTY,跳過 0。
 * 三種情況寫在一起是為了讓 test_game.js 釘得住「跳過不等於答錯」——
 * game.js 是 DOM 的 IIFE,require 不到。
 * @param {{correct:boolean, skipped:boolean, elapsedMs:number, streak:number}} q
 */
function gainFor({ correct, skipped, elapsedMs, streak }) {
  if (correct) return scoreFor(elapsedMs, streak).total;
  return skipped ? 0 : -WRONG_PENALTY;
}

if (typeof module !== 'undefined') {
  module.exports = { scoreFor, gainFor, round1, SPEED_MAX, HALF_LIFE, STREAK_CAP, WRONG_PENALTY };
}
