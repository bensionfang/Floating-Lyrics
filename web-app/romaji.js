/**
 * 羅馬拼音行的合併 (#ROMAJI#)。
 *
 * **讀音不另外去要,直接從注音結果讀回來** —— `injectFurigana` 的輸出裡每個漢字詞都帶著
 * `<ruby>漢字<rt>かな</rt></ruby>`,假名本來就是假名,整行的讀音已經在畫面上了。
 * 假名 → 羅馬字是確定性轉換,本機做零成本;反過來 (羅馬字 → 假名) 才有損失
 * (づ/ず、ぢ/じ 分不出來,助詞 は/へ/を 寫成 wa/e/o 就回不去),那正是 cn_music 的羅馬字
 * 提示要層層修正的原因。所以**不要為了羅馬字再打一次 LLM**,那是把方向做反。
 *
 * 插入方式與 `#TRANS#` 完全一致 (同一個時間戳、前綴標記、前端掛到上一句上),
 * 併在 `mergeTranslations` 之後,所以三行的順序固定是 歌詞 / 羅馬字 / 譯文。
 *
 * 獨立成檔的理由同 translations.js:測試 require 得到而不必啟動 server。
 */

const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.+)$/;

// 直音 + 濁半濁。拗音、促音、撥音、長音在 kanaToRomaji 裡另外處理。
const BASE = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'i', ゑ: 'e', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa', ヶ: 'ka',
};

// 拗音:し/ち/じ 系的寫法不是機械式的 (しゃ = sha 不是 shya),所以整組列出來
const YOON = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo', ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho', じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho', ぢゃ: 'ja', ぢゅ: 'ju', ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo', ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo', ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo', りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du', ふぁ: 'fa', ふぃ: 'fi',
  ふぇ: 'fe', ふぉ: 'fo', うぃ: 'wi', うぇ: 'we', うぉ: 'wo', ゔぁ: 'va',
  ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo', ゔ: 'vu',
};

const KATA_TO_HIRA = (s) => s.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/**
 * 假名轉羅馬字 (平文式)。
 * - 促音 っ:重複下一個音的第一個子音 (きって = kitte);ch 前面照慣例寫 t (まっちゃ = matcha)
 * - 撥音 ん:後面接母音或 y 時加隔音符號 (きんえん = kin'en),不然分不出 きんえん / きねん
 * - 長音符 ー:延長前一個母音 (ラーメン = rāmen 這裡簡化成 raamen 的 a 重複)
 */
function kanaToRomaji(kana) {
  const s = KATA_TO_HIRA(String(kana || ''));
  let out = '';
  let i = 0;
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (YOON[two]) { out += YOON[two]; i += 2; continue; }

    const c = s[i];
    if (c === 'っ') {
      // 促音後面沒東西 (行尾的 っ) 就當作沒有 —— 硬要標會變出一個孤立子音
      const nextTwo = s.slice(i + 1, i + 3);
      const next = YOON[nextTwo] || BASE[s[i + 1]] || '';
      if (next) out += next.startsWith('ch') ? 't' : next[0];
      i += 1;
      continue;
    }
    if (c === 'ー') {
      const last = out[out.length - 1];
      if (/[aiueo]/.test(last || '')) out += last;
      i += 1;
      continue;
    }
    if (c === 'ん') {
      const nextTwo = s.slice(i + 1, i + 3);
      const next = YOON[nextTwo] || BASE[s[i + 1]] || '';
      out += /^[aiueoy]/.test(next) ? "n'" : 'n';
      i += 1;
      continue;
    }
    if (BASE[c]) { out += BASE[c]; i += 1; continue; }
    out += c;   // 假名以外的字 (英數、標點) 原樣留著
    i += 1;
  }
  return out;
}

/**
 * 詞與詞之間要不要空格,靠助詞判斷。
 *
 * 注音把每個**漢字詞**包成 `<ruby>`,夾在中間的假名段有兩種:詞尾的送り仮名 (聞<ruby>+こえる)
 * 與獨立的助詞 (君<ruby>+の+声<ruby>)。**單獨成段、而且正好是常見助詞**的才斷開,其餘一律
 * 黏著 —— 每個 ruby 邊界都斷的話「聞こえる」會裂成 ki koeru,而完全不斷就是一長串沒有空格
 * 的字母,兩種都難讀。
 *
 * 只收單字助詞:から/まで 這類雖然也常獨立成段,但「〜てから」的から 黏在動詞後面,斷了更糟。
 */
const PARTICLE = new Set(['の', 'は', 'が', 'を', 'に', 'へ', 'と', 'で', 'も', 'や', 'か', 'ね', 'よ']);

/**
 * 詞頭在哪裡,靠 ruby 的 `data-hs` 判斷:那是「這顆 ruby 佔整詞讀音的第幾個字」,
 * `0` = 詞的開頭。**不能每個 ruby 邊界都斷** —— 一個詞被送り仮名拆成好幾顆 ruby 是常態
 * (噛み締め = 噛(か) + み + 締(し) + め,第二顆的 data-hs 是 2),每顆都斷會變成 ka mi shi me。
 * 片假名 ruby (`kata-ruby`) 沒有這個屬性,它本來就自成一個詞,視同詞頭。
 */
const WORD_START = (attrs) => !/data-hs='[1-9]/.test(attrs);

const RUBY_RE = /<ruby([^>]*)>(.*?)<rt[^>]*>(.*?)<\/rt>\s*<\/ruby>/g;
const HAS_JA = /[぀-ヿ一-龯々]/;

/**
 * 轉出來的字串要**重新逃逸**才能插回 HTML:來源是已逃逸的歌詞,而 lineToRomaji 為了
 * 比對讀音會先解回實體字串 —— 不逃逸就等於把 `&lt;img onerror=…&gt;` 還原成真標籤,
 * 前端 innerHTML 一畫就中招 (同 translations.js 的 escapeHtml)。
 */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c]));
}

function unescapeHtml(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#x27|#39);/g, (_, e) => (
    { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" }[e]));
}

/**
 * 把注音後的一行 HTML 轉成羅馬字。
 *
 * 助詞的 は/へ/を 要唸 wa/e/o,而這一層沒有詞性可用 —— 但注音把每個詞切成了 <ruby>,
 * **夾在 ruby 之間、長度剛好 1 的假名段幾乎就是助詞** (私<ruby>は</ruby>… 的 は 自成一段,
 * 而「こんばんは」的 は 黏在五個字的段落裡)。所以只有「整段就是這一個字」時才改讀音。
 * を 例外:它在現代日文裡幾乎只當助詞,整段都轉 o (BASE 表裡就是 o)。
 * 純假名而且整行沒有 ruby 的句子分不出來,那時 は 只能唸 ha —— 這是已知的取捨。
 */
function lineToRomaji(html) {
  const parts = [];
  let last = 0;
  let m;
  RUBY_RE.lastIndex = 0;
  while ((m = RUBY_RE.exec(html))) {
    if (m.index > last) parts.push({ kana: html.slice(last, m.index), plain: true });
    parts.push({ kana: m[3], plain: false, wordStart: WORD_START(m[1]) });   // <rt> 的讀音就是這段的假名
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ kana: html.slice(last), plain: true });

  const particle = (p) => (p === 'は' ? 'wa' : p === 'へ' ? 'e' : kanaToRomaji(p));

  return parts.map((p) => {
    const text = unescapeHtml(p.kana.replace(/<[^>]+>/g, ''));
    if (!p.plain) return (p.wordStart ? ' ' : '') + kanaToRomaji(text);
    // 標點先剝掉再判斷是不是助詞:「も、」這種結尾在歌詞裡很常見,不剝就變成不是助詞而黏住,
    // 同一首歌裡同一個 も 會時斷時不斷
    const [, kana, punct] = text.match(/^(.*?)([、。，．「」『』【】\s]*)$/);
    if (PARTICLE.has(kana)) return ` ${particle(kana)}${punct} `;
    // 片假名詞後面直接黏著助詞 (ドアを):片假名詞沒有 ruby,整段會連在一起。
    // **只有片假名 + 助詞才拆** —— 平假名詞這樣拆會出事 (こんばんは → konban wa 還好,
    // ばか → ba ka 就錯了),而片假名詞的邊界很明確。
    const kataThenParticle = text.match(/^([ァ-ヶー]+)([のはがをにへとでもやかねよ])$/);
    if (kataThenParticle) return `${kanaToRomaji(kataThenParticle[1])} ${particle(kataThenParticle[2])} `;
    return kanaToRomaji(text);
  }).join('')
    // 全形標點跟著轉半形,不然羅馬字行裡會夾著 、 。 這種格格不入的字
    .replace(/[、，]/g, ',').replace(/[。．]/g, '.').replace(/[「」『』【】]/g, '')
    .replace(/\s+([,.])/g, '$1')
    .replace(/([,.])(?=\S)/g, '$1 ')   // 逗號後面一定要有空格 (asamo,sono → asamo, sono)
    .replace(/\s+/g, ' ').trim();
}

/**
 * 把羅馬拼音併進注音後的 LRC。
 * @param {string} lrcHtml  injectFurigana (+ mergeTranslations) 的輸出
 * @returns {string} 原字串 (沒有任何日文行時逐字不變) 或插入 #ROMAJI# 行後的新字串
 */
function mergeRomaji(lrcHtml) {
  if (!lrcHtml) return lrcHtml;
  const lines = lrcHtml.split('\n');
  const out = [];
  let inserted = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.trim().match(LINE_RE);
    if (!m) continue;
    const text = m[2].trim();
    // 製作人員列、譯文行、已經插好的羅馬字行都不處理
    if (/^#(TITLE|TRANS|ROMAJI)#/.test(text)) continue;
    // 同一份輸入合併兩次不可以插出兩行 (比照 mergeTranslations)
    const next = (lines[i + 1] || '').trim().match(LINE_RE);
    if (next && next[2].trim().startsWith('#ROMAJI#')) continue;
    // 整行沒有日文 (英文歌詞、純符號) 就不必轉,轉了也只是同一串字
    if (!HAS_JA.test(text)) continue;

    const romaji = lineToRomaji(text);
    if (!romaji) continue;
    out.push(`${m[1]}#ROMAJI#${escapeHtml(romaji)}`);
    inserted++;
  }
  return inserted ? out.join('\n') : lrcHtml;
}

module.exports = { mergeRomaji, lineToRomaji, kanaToRomaji };
