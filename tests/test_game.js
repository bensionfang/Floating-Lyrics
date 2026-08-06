// 猜歌小遊戲的純邏輯回歸測試:干擾選項的挑選 (pickDistractors)。
// 這是靜默失效型的東西 —— 選項重複、或答案以兩種寫法同時出現,都只是「看起來怪」,
// 不會有錯誤訊息,所以要釘住。
const assert = require('assert');
const { pickDistractors, filterArtistTracks } = require('../web-app/game');
const { scoreFor, gainFor, round1, WRONG_PENALTY } = require('../web-app/public/js/game-score');
const { songKey, titleKey } = require('../web-app/public/js/song-key');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`PASS  ${name}`); }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}

const song = (artist, title) => ({ artist, title });
const ANSWER = song('ヨルシカ', '春泥棒');

// --- pickDistractors ---

check('同歌手夠 3 首就不往下退', () => {
  const got = pickDistractors(
    ANSWER,
    [song('ヨルシカ', '花に亡霊'), song('ヨルシカ', 'ただ君に晴れ'), song('ヨルシカ', '藍二乗')],
    [song('YOASOBI', '夜に駆ける')],
    [song('Vaundy', '怪獣の花唄')]
  );
  assert.strictEqual(got.length, 3);
  assert.ok(got.every(r => r.artist === 'ヨルシカ'), '不該混進別的歌手');
});

check('同歌手不足時往常聽的池子補', () => {
  const got = pickDistractors(
    ANSWER,
    [song('ヨルシカ', '花に亡霊')],
    [song('YOASOBI', '夜に駆ける'), song('Vaundy', '怪獣の花唄')],
    [song('米津玄師', '春雷')]
  );
  assert.deepStrictEqual(got.map(r => r.title), ['花に亡霊', '夜に駆ける', '怪獣の花唄']);
});

check('三層都不夠就回 null (題庫不足)', () => {
  assert.strictEqual(pickDistractors(ANSWER, [song('ヨルシカ', '花に亡霊')], [], []), null);
});

check('答案自己不會變成干擾項', () => {
  const got = pickDistractors(
    ANSWER,
    [song('ヨルシカ', '春泥棒')],   // 同歌手池子本來就會撈到答案
    [song('YOASOBI', '夜に駆ける'), song('Vaundy', '怪獣の花唄'), song('米津玄師', '春雷')],
    []
  );
  assert.ok(!got.some(r => r.title === '春泥棒'), '答案不該出現在干擾項裡');
});

check('跨池子重複的歌只出現一次', () => {
  const got = pickDistractors(
    ANSWER,
    [song('YOASOBI', '夜に駆ける')],
    [song('YOASOBI', '夜に駆ける'), song('Vaundy', '怪獣の花唄')],
    [song('YOASOBI', '夜に駆ける'), song('米津玄師', '春雷')]
  );
  assert.deepStrictEqual(got.map(r => r.title), ['夜に駆ける', '怪獣の花唄', '春雷']);
});

check('指定歌手的曲目排在最前面', () => {
  const seen = [song('米津玄師', 'KICK BACK'), song('Vaundy', 'そんな君、こんな僕'), song('Chevon', 'ダンス・デカダンス')];
  const got = pickDistractors(
    ANSWER,
    seen,
    [song('ヨルシカ', '花に亡霊'), song('ヨルシカ', '藍二乗')],   // 同歌手池:這題不該被用到
    [song('YOASOBI', '夜に駆ける')],
    []
  );
  assert.deepStrictEqual(got.map(r => r.title), seen.map(r => r.title));
});

check('指定來源不夠 3 首時,照樣往 cache 的同歌手池補', () => {
  const got = pickDistractors(
    ANSWER,
    [song('米津玄師', 'KICK BACK')],
    [song('ヨルシカ', '花に亡霊'), song('ヨルシカ', '藍二乗')],
    [],
    []
  );
  assert.deepStrictEqual(got.map(r => r.title), ['KICK BACK', '花に亡霊', '藍二乗']);
});

check('答案本身在指定來源裡也不會變成干擾項', () => {
  const got = pickDistractors(
    ANSWER,
    [song('ヨルシカ', '春泥棒'), song('米津玄師', 'KICK BACK')],
    [song('ヨルシカ', '花に亡霊'), song('ヨルシカ', '藍二乗')],
    [], []
  );
  assert.ok(!got.some(r => r.title === '春泥棒'));
  assert.strictEqual(got.length, 3);
});

check('iTunes 還原前的原名也要排除,否則答案會以兩種寫法同時出現', () => {
  // 播放器給的是 Spotify 原字串 (Haru Dorobou),播放狀態早被還原成日文原名 (春泥棒)
  const got = pickDistractors(
    [ANSWER, song('Yorushika', 'Haru Dorobou')],
    [song('Yorushika', 'Haru Dorobou'), song('YOASOBI', '夜に駆ける'),
     song('Vaundy', '怪獣の花唄'), song('米津玄師', '春雷')],
    [], [], []
  );
  assert.ok(!got.some(r => /Haru Dorobou|春泥棒/.test(r.title)), JSON.stringify(got));
  assert.strictEqual(got.length, 3);
});

check('Live/feat. 版不算另一首 (兩個選項幾乎一樣是刁難不是難度)', () => {
  const got = pickDistractors(
    ANSWER,
    [song('ヨルシカ', '春泥棒 (Live)'), song('ヨルシカ', '花に亡霊'), song('ヨルシカ', '花に亡霊 (feat. someone)')],
    [song('YOASOBI', '夜に駆ける'), song('Vaundy', '怪獣の花唄')],
    []
  );
  assert.ok(!got.some(r => r.title.startsWith('春泥棒')), '答案的 Live 版不該當選項');
  assert.strictEqual(got.filter(r => r.title.startsWith('花に亡霊')).length, 1);
});

// --- 歌手模式:iTunes lookup 的清洗 ---

check('卡拉OK/伴奏版丟掉 (歌名一樣但不是本人唱的)', () => {
  const got = filterArtistTracks([
    { trackId: 1, trackName: '春泥棒', artistName: 'ヨルシカ' },
    { trackId: 2, trackName: '春泥棒 (カラオケ)', artistName: '歌っちゃ王' },
    { trackId: 3, trackName: 'Haru Dorobou (Karaoke Version)', artistName: 'X' },
    { trackId: 4, trackName: '花に亡霊 (Instrumental)', artistName: 'ヨルシカ' },
  ]);
  assert.deepStrictEqual(got.map((t) => t.title), ['春泥棒']);
});

check('同一首歌的單曲/專輯/Live 版只留一筆', () => {
  const got = filterArtistTracks([
    { trackId: 1, trackName: '春泥棒', artistName: 'ヨルシカ' },
    { trackId: 2, trackName: '春泥棒 (Live)', artistName: 'ヨルシカ' },
    { trackId: 3, trackName: '花に亡霊 feat. someone', artistName: 'ヨルシカ' },
    { trackId: 4, trackName: '花に亡霊', artistName: 'ヨルシカ' },
    { trackId: 1, trackName: '春泥棒', artistName: 'ヨルシカ' },
  ]);
  assert.deepStrictEqual(got.map((t) => t.title), ['春泥棒', '花に亡霊 feat. someone']);
});

check('lookup 第一筆是歌手本身 (沒有 trackName),要跳過', () => {
  const got = filterArtistTracks([
    { wrapperType: 'artist', artistName: 'Yorushika', artistId: 1 },
    { trackId: 2, trackName: '晴る', artistName: 'ヨルシカ' },
  ]);
  assert.deepStrictEqual(got, [{ artist: 'ヨルシカ', title: '晴る' }]);
});

check('空輸入不會炸', () => {
  assert.deepStrictEqual(filterArtistTracks(null), []);
  assert.deepStrictEqual(filterArtistTracks([]), []);
});

// --- 計分公式 (答對 = 基本 + 速度 + 連勝;答錯 −1;跳過 0) ---

check('速度分是半衰期曲線:每 10 秒剩一半', () => {
  assert.strictEqual(scoreFor(0, 1).speed, 5, 't=0 拿滿');
  assert.strictEqual(scoreFor(10000, 1).speed, 2.5);
  assert.strictEqual(scoreFor(20000, 1).speed, 1.3, '5 → 2.5 → 1.25,取一位是 1.3');
  assert.strictEqual(scoreFor(30000, 1).speed, 0.6);
});

check('速度分吃實際秒數,差一秒就有差 (不是門檻)', () => {
  // 門檻制的老問題:4.9 秒與 5.1 秒差一整分,5 秒到 9 秒卻完全一樣
  assert.strictEqual(scoreFor(4900, 1).speed, 3.6);
  assert.strictEqual(scoreFor(5100, 1).speed, 3.5);
  assert.strictEqual(scoreFor(9000, 1).speed, 2.7, '同一段裡也要有差別');
  assert.ok(scoreFor(3000, 1).speed > scoreFor(3100, 1).speed, '晚 0.1 秒就該少一點');
});

check('慢答不歸零也不倒扣 (倒扣只針對答錯)', () => {
  assert.ok(scoreFor(60000, 1).speed > 0, '一分鐘還是拿得到一點');
  assert.ok(scoreFor(600000, 1).speed >= 0, '十分鐘也不會變負的');
});

check('分數只取到小數點後一位 (浮點誤差不能外流)', () => {
  const t = scoreFor(7000, 3).total;
  assert.strictEqual(t, round1(t));
  assert.strictEqual(String(t).split('.')[1] === undefined || String(t).split('.')[1].length, 1);
});

check('第一題答對沒有連勝加成,第二題起每題多 1 分', () => {
  assert.strictEqual(scoreFor(30000, 1).streak, 0);
  assert.strictEqual(scoreFor(30000, 2).streak, 1);
  assert.strictEqual(scoreFor(30000, 4).streak, 3);
});

check('連勝加成有上限,不會一題抵前面十題', () => {
  assert.strictEqual(scoreFor(30000, 20).streak, 5);
});

check('答錯倒扣,跳過不扣不加 (兩者不可以混為一談)', () => {
  const q = { correct: false, elapsedMs: 3000, streak: 0 };
  assert.strictEqual(gainFor({ ...q, skipped: false }), -WRONG_PENALTY, '選錯要倒扣');
  assert.strictEqual(gainFor({ ...q, skipped: true }), 0, '跳過是 0,不是倒扣');
  assert.ok(WRONG_PENALTY > 0, '倒扣值本身是正的,加負號在 gainFor 裡');
});

check('答對照舊走三項相加,不受倒扣影響', () => {
  assert.strictEqual(gainFor({ correct: true, skipped: false, elapsedMs: 0, streak: 1 }), 6);
});

check('總分 = 三項相加', () => {
  assert.strictEqual(scoreFor(0, 1).total, 6, '秒殺第一題 = 1 + 5 + 0');
  assert.strictEqual(scoreFor(3000, 5).total, 9.1, '3 秒 + 5 連勝 = 1 + 4.1 + 4');
  assert.ok(scoreFor(120000, 1).total >= 1, '慢慢想至少拿得到基本分');
  assert.strictEqual(scoreFor(-5, 1).total, 6, '時鐘倒退也不該變成負分');
});

// --- 全曲目玩法:「這首考過了沒」的比對 ---
// 前端 (public/js/game.js) 拿 songKey 當已考過的鍵,server 拿同一份挑干擾選項。
// 兩邊算出來的鍵一有出入就是靜默失效:覆蓋率永遠差幾首,而且不會有錯誤訊息

check('版本不同算同一首 (Live / feat. / 全形括號都要收斂)', () => {
  const k = songKey(song('ヨルシカ', '春泥棒'));
  for (const t of ['春泥棒 (Live)', '春泥棒（Live）', '春泥棒 [Remastered]', '春泥棒【MV】', '春 泥棒']) {
    assert.strictEqual(songKey(song('ヨルシカ', t)), k, t);
  }
});

check('不同歌手的同名歌不算考過', () => {
  assert.notStrictEqual(songKey(song('ヨルシカ', '初恋')), songKey(song('宇多田ヒカル', '初恋')));
});

check('剩餘曲目 = 曲目池扣掉考過的 (結算列的就是這份)', () => {
  const pool = [song('ヨルシカ', '春泥棒'), song('ヨルシカ', '晴る'), song('ヨルシカ', '花に亡霊')];
  const asked = new Set([titleKey(song('ヨルシカ', '春泥棒 (Live)'))]);   // 播到的是 Live 版
  const left = pool.filter((t) => !asked.has(titleKey(t)));
  assert.deepStrictEqual(left.map((t) => t.title), ['晴る', '花に亡霊']);
});

check('連動曲只當干擾選項,不算進全曲目的分母', () => {
  // server 給補進來的連動曲標 extra:題目一律來自播放清單實際播到的歌,
  // 這批只是讓四個選項湊得出來,算進分母會讓覆蓋率永遠差幾首
  const pool = [song('ヨルシカ', '春泥棒'), song('ヨルシカ', '晴る'),
                { ...song('ヨルシカ', '斜陽'), extra: true }];
  const main = pool.filter((t) => !t.extra);
  assert.deepStrictEqual(main.map((t) => t.title), ['春泥棒', '晴る']);
  // 但干擾項照樣挑得到它
  const got = pickDistractors(song('ヨルシカ', '花に亡霊'), pool, [song('ヨルシカ', '藍二乗')], []);
  assert.ok(got.some((r) => r.title === '斜陽'), '連動曲該能當干擾項');
});

check('連動曲:歌手是聯名寫法,所以覆蓋率只能比歌名', () => {
  // iTunes 的曲目池已收斂成正規名 (ヨルシカ),播放器給的卻是聯名寫法
  const pooled = song('ヨルシカ', '斜陽');
  const played = song('Chevon & ヨルシカ', '斜陽');
  assert.notStrictEqual(songKey(played), songKey(pooled), 'songKey 對不上,這正是不能用它的理由');
  assert.strictEqual(titleKey(played), titleKey(pooled));
});

check('titleKey 也要吃掉 feat. 與括號尾綴', () => {
  const k = titleKey(song('ヨルシカ', '花に亡霊'));
  for (const t of ['花に亡霊 feat. someone', '花に亡霊 (Movie ver.)', '花に亡霊　']) {
    assert.strictEqual(titleKey(song('誰か', t)), k, t);
  }
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
