// 抓回來的歌詞裡有一種整份沒救的:**內嵌注音** —— 漢字後面直接黏著讀音,
// 「とある言葉ことばが君きみに突つき刺ささり」。網易的使用者上傳常有這種版本。
// 它壞的不只是好看:fugashi 會把「言葉ことば」當成沒見過的詞硬斷,注音、譯文比對 (translations.js
// 的鍵是逐字算的)、猜歌的歌名比對全部跟著錯,而且沒有任何自動修法 —— 所以在抓取階段就換下一家。
//
// 判準是「漢字串後面接著的平假名長度 >= 漢字數的兩倍」的比例:一個漢字的讀音幾乎都 >= 2 個假名,
// 所以內嵌注音的歌整份都命中;正常歌詞只有送假名長的動詞會命中 (刺さり、醒めないで)。
// 全庫 433 首日文歌實測:內嵌注音那首 0.93,乾淨的最高 0.75 (レトロリロン / ワンタイムエピローグ),
// 中位數 0.47 —— 門檻取 0.85。**門檻是拿一份樣本配出來的**,誤判的代價是換下一個來源 (還有
// fallback 與 lrclib 接著),不是整首沒歌詞,所以寧可抓得緊一點。
// 單獨一個檔案 (而非留在 server.js) 只是為了讓 test_lyric_quality.js 能直接 require,同 s2t.js。
const RUN = /([一-鿿々]+)([ぁ-ゖ]*)/g;
const INLINE_RUBY_RATIO = 0.85;
const MIN_RUNS = 20;   // 短歌詞/沒幾個漢字的歌樣本太小,比例沒有意義

// 只看歌詞本體:時間標籤、[source:] 標頭、製作人員列都不算
function lyricBody(lrc) {
  return (lrc || '')
    .split('\n')
    .filter((l) => !l.startsWith('[source:') && !l.includes('#TITLE#'))
    .map((l) => l.replace(/^(\[[^\]]*\])+/, ''))
    .join('\n');
}

function inlineRubyRatio(lrc) {
  const body = lyricBody(lrc);
  let total = 0;
  let hit = 0;
  let m;
  RUN.lastIndex = 0;
  while ((m = RUN.exec(body))) {
    total++;
    if (m[2].length >= 2 * m[1].length) hit++;
  }
  return { total, ratio: total ? hit / total : 0 };
}

function hasInlineRuby(lrc) {
  if (!/[぀-ヿ]/.test(lrc || '')) return false;   // 沒假名 = 中文歌,這條規則不適用
  const { total, ratio } = inlineRubyRatio(lrc);
  return total >= MIN_RUNS && ratio >= INLINE_RUBY_RATIO;
}

module.exports = { hasInlineRuby, inlineRubyRatio, INLINE_RUBY_RATIO };
