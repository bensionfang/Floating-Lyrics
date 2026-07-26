// 猜歌小遊戲的純邏輯:選項挑選與提示句挑選。
// 獨立成一個檔案的理由跟 s2t.js / title-lines.js 一樣 —— 測試 (test_game.js) require 得到,
// 不必為了驗兩個純函式而啟動一份 server。SQL 只負責撈 rows,排序與取捨規則全在這裡。

// 歌曲身分的鍵在 public/js/song-key.js —— 前端「全曲目」玩法要用同一份 (見那個檔的說明)
const { songKey } = require('./public/js/song-key');

// 依序從各個池子取,取滿 3 個就停 (呼叫端決定順序:貼進來的播放清單 → 同歌手 → 常聽 → 全庫隨機)。
// `answer` 可以是一首歌,也可以是一組要排除的寫法 —— iTunes 還原前後的歌名都要排掉,
// 否則同一首歌會以兩種寫法同時出現在四個選項裡。
// 湊不滿 3 個 (題庫太小) 回 null,呼叫端要顯示「題庫不足」而不是硬出一題。
function pickDistractors(answer, ...pools) {
  const seen = new Set([].concat(answer).map(songKey));
  const picked = [];
  for (const pool of pools) {
    for (const row of pool || []) {
      if (picked.length >= 3) return picked;
      const k = songKey(row);
      if (seen.has(k)) continue;
      seen.add(k);
      picked.push({ artist: row.artist, title: row.title });
    }
  }
  return picked.length >= 3 ? picked : null;
}

// iTunes lookup 回來的曲目清洗 (歌手模式的干擾池)。
// **一定要用 country=JP 查** —— tw storefront 會把日文歌手/歌名換成羅馬字或英譯
// (`Yorushika / Sunny`),那正是別的猜歌網站最惱人的地方。
//
// 三件事:
//   1. 丟掉卡拉OK版 —— iTunes 的歌手曲目裡混著「歌っちゃ王」這類翻唱,歌名一樣但不是本人
//   2. 同一首歌會以單曲/專輯/Live 各出現一次,用 trackId 與正規化後的歌名兩層去重
//   3. 只留 (artist, title),與 cache 的鍵同形
function filterArtistTracks(results) {
  const out = [];
  const ids = new Set();
  const titles = new Set();
  for (const r of results || []) {
    if (!r || !r.trackName || !r.artistName) continue;
    const low = String(r.trackName).toLowerCase();
    if (low.includes('カラオケ') || low.includes('karaoke') || low.includes('instrumental')) continue;
    // 去重用的正規化:砍 feat.、括號尾綴、所有空白
    const norm = String(r.trackName)
      .replace(/\s*[(（\[【].*$/, '')
      .replace(/\s*feat\.?.*$/i, '')
      .replace(/[\s　]+/g, '')
      .toLowerCase();
    if (!norm) continue;
    if ((r.trackId && ids.has(r.trackId)) || titles.has(norm)) continue;
    if (r.trackId) ids.add(r.trackId);
    titles.add(norm);
    out.push({ artist: String(r.artistName).trim(), title: String(r.trackName).trim() });
  }
  return out;
}

module.exports = { pickDistractors, songKey, filterArtistTracks };
