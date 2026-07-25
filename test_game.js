// 猜歌小遊戲的純邏輯回歸測試:干擾選項的挑選 (pickDistractors)。
// 這是靜默失效型的東西 —— 選項重複、或答案以兩種寫法同時出現,都只是「看起來怪」,
// 不會有錯誤訊息,所以要釘住。
const assert = require('assert');
const { pickDistractors, filterArtistTracks } = require('./web-app/game');

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
