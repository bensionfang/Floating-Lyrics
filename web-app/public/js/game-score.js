// 猜歌的計分公式。獨立成檔的理由跟 scroll-zone.js 一樣:純函式,測試 (test_game.js)
// require 得到而不必開瀏覽器;瀏覽器則是當一般 script 載入。
//
// 三個加項相加,**沒有任何扣分項**:答得慢只是拿不到速度加成,不會倒扣。
// 舊版是「滿分 10 分往下扣」,碼表旁邊掛著一個一直變小的數字,看起來像在懲罰慢慢想。
//   基本   答對就有 1 分
//   速度   5 × 2^(−t/10) —— **實際秒數的連續曲線,不是門檻**
//   連勝   連續答對的第 2 題起每題多 1 分,上限 +5 (不封頂的話後段一題抵前面十題)
//
// 速度用**半衰期**而不是分段門檻:門檻會讓 4.9 秒與 5.1 秒差一整分、5 秒到 9 秒卻完全一樣,
// 而使用者要的是「快多少就多拿多少」。一句話講得完 (每過 10 秒剩一半),而且永遠 > 0 ——
// 慢慢想仍然拿得到一點,符合「只有加分沒有扣分」。取到小數點後一位,前幾秒的差別才看得出來
// (1 秒 4.7、3 秒 4.1、10 秒 2.5、30 秒 0.6)。
const SPEED_MAX = 5;      // t=0 時的速度分
const HALF_LIFE = 10;     // 每過幾秒剩一半
const STREAK_CAP = 5;
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

if (typeof module !== 'undefined') {
  module.exports = { scoreFor, round1, SPEED_MAX, HALF_LIFE, STREAK_CAP };
}
