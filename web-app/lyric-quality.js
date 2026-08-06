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

// 第二種整份沒救的:**羅馬字轉寫版** —— 歌名是 CJK,歌詞本體卻一個假名一個漢字都沒有。
// 來源是使用者上傳的轉寫版本,而 search_fallback.generate_queries 本來就會拿羅馬字歌名
// (baddofoomii) 去問,問到的正是它。壞的程度跟內嵌注音一樣:fugashi 沒有東西可以注音、
// translations.js 與 word-times.js 的比對鍵是原文算的,整份對不上,而且全都是靜默失效。
// 誤判的代價只是換下一家 (而且全部來源都這樣時 rejectedBackup 會把它拿回來用),所以抓緊一點。
// **「沒有 CJK」一條不夠,還要看它像不像羅馬字。** 日文歌名配一整份英文歌詞是真的存在的
// (實測全庫唯一的誤判就是 Lavt / アルコール,那首本來就是英文),而那種歌擋掉只是白重抓一次。
// 分界用英文虛詞密度:轉寫版沒有 the/you/is 這種詞,英文歌滿滿都是。實測 0.048 vs 0.478,
// 訊號分得很開,門檻取 0.20。刻意排除 no / to / made / so 這些跟日文羅馬字同形的。
const EN_STOPWORD = /\b(the|you|your|and|is|are|was|be|of|in|it|that|this|with|for|but|not|have|will|can|just|all|we|my|me|i|know|like)\b/gi;
const EN_MAX_RATIO = 0.20;
const CJK = /[぀-ヿ一-鿿々]/;
const MIN_BODY = 50;        // 太短的樣本比例沒有意義 (只有一行 "Instrumental" 之類)
const CJK_MIN_RATIO = 0.05; // 真的轉寫版是 0;留一點餘裕給夾雜的一兩個漢字標題/合聲
function isRomajiOnly(lrc, title) {
  if (!CJK.test(title || '')) return false;   // 歌名是純 ASCII:歌詞本來就可能全是英文,無從判斷
  const body = lyricBody(lrc);
  if (body.replace(/\s/g, '').length < MIN_BODY) return false;
  const cjk = (body.match(new RegExp(CJK.source, 'g')) || []).length;
  if (cjk / body.replace(/\s/g, '').length >= CJK_MIN_RATIO) return false;
  const words = (body.match(/[A-Za-z']+/g) || []).length;
  if (!words) return false;                   // 一個拉丁字母都沒有 = 韓文/純符號之類,不是這條要管的
  return (body.match(EN_STOPWORD) || []).length / words < EN_MAX_RATIO;
}

// 兩道守門的共用入口:回不可用的原因 (空字串 = 可用)。抓取時的 usable() 與快取命中時的
// 重抓判斷共用這一支,兩邊各寫一次 OR 就是哪天只改到一邊
function badLyric(lrc, title) {
  if (hasInlineRuby(lrc)) return '內嵌注音';
  if (isRomajiOnly(lrc, title)) return '羅馬字轉寫';
  return '';
}

module.exports = { hasInlineRuby, isRomajiOnly, badLyric, inlineRubyRatio, INLINE_RUBY_RATIO };
