/**
 * 製作人員/版權列的標記 (`#TITLE#` 前綴)。這是唯一的實作 —— 舊的 Python 複本 (utils.py)
 * 已刪除,不要再開第二份。獨立成一個檔案是為了讓 test_title_lines.js require 得到
 * 而不必啟動 server,跟 s2t.js、browser-query.js 同一個理由。
 */

// 製作人員/職位名。繁簡成對列出,因為中國平台的日文歌詞混用兩種寫法。
// 單字的 (詞/曲/鼓...) 只在「標籤位置」比對 —— 那些字在歌詞正文裡到處都是,
// 放進無冒號那條規則會大量誤殺,所以分成兩張表。
const CREDIT_KEYWORDS = [
  "作詞", "作词", "作曲", "編曲", "编曲", "製作", "制作", "混音", "演唱", "原唱",
  "和聲", "和声", "合聲", "合声", "企劃", "企划", "監製", "监制", "發行", "发行",
  "出品", "統籌", "统筹", "錄音", "录音", "母帶", "母带",
  "翻譯", "翻译", "編集", "编辑", "校對", "校对",
  "吉他", "貝斯", "贝斯", "鼓手", "鋼琴", "钢琴", "鍵盤", "键盘", "弦樂", "弦乐", "提琴",
  "合唱", "伴奏", "配唱", "封面", "設計", "设计", "曲繪", "曲绘", "調校", "调校",
  "厂牌", "廠牌", "工作室", "鳴謝", "鸣谢",
  "vocal", "lyric", "music", "arrange", "mix", "mastering", "master", "compose",
  "produce", "producer", "engineer", "record", "guitar", "bass", "drum", "piano",
  "strings", "chorus", "keyboard", "synth", "programming",
  // 管弦與職位:日文歌的英文標頭很常見 (`Trumpet：…`、`Sound Direction：…`)。
  // 這些是子字串比對,所以 mixing/recording/mastering 不必再列 (mix/record/master 已涵蓋)。
  "trumpet", "trombone", "sax", "violin", "cello", "flute", "horn", "percussion",
  "direction", "manipulator"
];

// 只在冒號前那一小段比對才安全的短標籤 (周杰倫那批中文歌用的就是這種寫法)。
const LABEL_ONLY_KEYWORDS = ["詞", "词", "曲", "鼓", "唱", "監", "监"];

// 版權聲明行 (「未經著作權人許可不得使用」之類)。這種行通常又長又沒冒號,
// 過不了「像不像標籤」的判斷,所以獨立計分:命中夠多個宣告用詞就算。
function isCopyrightClaim(text) {
  const words = ["未經", "未经", "許可", "许可", "授權", "授权", "不得", "請勿", "请勿", "使用", "版權", "版权", "翻唱", "轉載", "转载"];
  const hits = words.filter(w => text.includes(w)).length;
  return hits >= 3;
}

/**
 * 規則 1:標籤式 (`作詞 : 某某`)。
 *
 * **判斷的是冒號前那一段,不是整行長度** —— 這是這支函式最容易寫錯的地方。
 * 製作人員多的時候值會很長 (實測有 109 字的 `编曲 : A/B/.../T`),用整行長度當守門
 * 會整批漏掉;真正穩定的訊號是標籤本身。
 *
 * **真正在把關的是「標籤裡有沒有關鍵字」,長度只是第二道。** 日文歌詞裡的真冒號
 * (`Q:本日の出来栄えは…`、`目が開いてく4:30 A.M.`、`Give me "5:00上がり"`) 全部是敗在
 * 沒有關鍵字,不是敗在長度。
 *
 * 上限曾經是 8 字,那是照**中文**標籤 (`作詞`、`編曲`) 配的,英文的職位名本來就是多字詞組,
 * 整批被擋掉:`Rec & Mix Engineer：…` (18)、`Mastering Engineer：…` (18)、
 * `Sound Direction：…` (15)、`Lyrics，Composition，Arrangement：…` (34) 都漏標
 * (實測 ずっと真夜中でいいのに。/ 消えてしまいそうです 一首就漏了 5 行)。
 * 放寬到 40 之後全庫 465 首**多標 9 行、全部是真的製作人員列、零誤判**。
 */
function isCreditLabel(text) {
  const m = text.match(/^\s*([^:：]{1,40})\s*[:：]/);
  if (!m) return false;
  const label = m[1].trim().toLowerCase();
  if (!label) return false;
  return CREDIT_KEYWORDS.some(kw => label.includes(kw)) ||
         LABEL_ONLY_KEYWORDS.some(kw => label.includes(kw));
}

/** 規則 2:無冒號式 (`Vocal 初音ミク`)。這條才需要整行長度守門。 */
function isCreditPlain(text) {
  if (text.length >= 40) return false;
  const lower = text.toLowerCase();
  return CREDIT_KEYWORDS.some(kw => {
    if (!lower.includes(kw)) return false;
    return new RegExp(`${kw}\\s+`, 'i').test(lower) || text.length < kw.length + 5;
  });
}

// 比對歌名時把整行的引號/書名號剝掉:網易與 QQ 的標頭常寫成 `「夜の踊り子」`、`《歌名》`,
// 不剝就永遠對不上 (全庫實測漏標 2 首:サカナクション/夜の踊り子、SPITZ/チェリー)。
// 只影響「這一行是不是歌名」的比對,而那個判斷還壓著「前面每一行都是製作人員列」這道閘門,
// 所以真的唱出來的 `「ありがとう」` 這種行不會被誤判。
const normalizeName = (s) => s.toLowerCase().replace(/[\s　「」『』《》〈〉“”"']/g, '');

/**
 * 規則 4:歌名行 (整行就是歌名,中國平台常夾在製作人員列中間)。
 *
 * **判準是「前面每一行都已經是製作人員列」,不是行號、也不是時間戳。** 兩個都試過,都錯:
 * - 行號:ヨルシカ「あぶく」第 4 行 (t=23.6s) 是唱出來的歌名,前面三行是真歌詞。
 * - 時間戳:muque「TIME」的歌名行在 t=11.6s,但它前後都是製作人員列,是貨真價實的標頭。
 *
 * 還要求前面**至少有一行**製作人員列 —— 否則第 1 行就是歌名的情況無從判斷是標頭還是
 * 開口就唱歌名 (WurtS「分かってないよ」第 1、2 行都是歌名,顯然是唱的)。寧可漏標。
 */
/**
 * 歌名的幾種寫法。版本尾綴在**歌名這一側**是括號 (`クリームで会いにいけますか (Live)`) 還是
 * 破折號 (`クズリ念 - Live in Studio_温蔵庫`) 取決於播放器,而歌詞來源那一側常常用另一種 ——
 * QQ 的標頭就寫成 `クズリ念 (Live in Studio_温蔵庫) - ずっと真夜中でいいのに。`,兩邊形狀不同
 * 就整行漏標。所以四種變體都拿去比。
 *
 * **破折號兩邊都要有空白** —— 沒空白的連字號多半是名字本身 (`n-buna`、`go!go!vanillas`),
 * 同 utaten.clean_title 的判準。
 */
function titleVariants(songTitle) {
  const out = [];
  for (const s of [songTitle, songTitle.replace(/\s[-–—]\s.*$/, '')]) {
    out.push(s.trim(), s.replace(/[(（].*$/, '').trim());
  }
  return out.filter(Boolean);
}

function isSongNameLine(text, songTitle) {
  if (!songTitle) return false;
  const t = normalizeName(text);
  if (!t) return false;
  return titleVariants(songTitle).some((v) => t === normalizeName(v));
}

/**
 * 規則 5:標頭行 (`AIZO - King Gnu`、`Official髭男dism - バッドフォーミー`)。
 * QQ 與酷狗把「歌名 - 歌手」放在**第 1 行**,排在製作人員列前面 —— 規則 4 要求前面至少有一行
 * 製作人員列,所以它永遠接不到這種行 (全庫 454 首裡有 19 首,一首都沒標到)。
 *
 * 這種行不需要那個證據:**同一行同時寫著歌名與另一段文字**,沒有人會這樣唱。所以只要
 * 破折號切出來的某一段「就是歌名」(沿用規則 4 的同一個比對,含剝版本尾綴) 就算標頭。
 *
 * 兩個刻意的限制:
 * - **破折號兩邊都要有空白** —— 沒空白的連字號多半是名字本身 (`n-buna`、`go!go!vanillas`),
 *   同 utaten.clean_title 的判準。
 * - 比的是**整段相等**而不是互相包含:包含法會被短歌名 (單字母、`x`) 誤判成任何一行。
 *
 * 歌名本身帶破折號的 (`怪獣の花唄 - replica -`) 會切散而漏標 —— 寧可漏標,同規則 4。
 */
function isTitleArtistHeader(text, songTitle) {
  if (!songTitle) return false;
  const parts = text.split(/\s+[-–—]\s+/).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return false;
  // 括號附註在**行**這一側 (`バッドフォーミー (《Good Bye》日劇主題曲) - …`),而 isSongNameLine
  // 只剝歌名那一側的,所以這裡自己再剝一次
  return parts.some((p) => isSongNameLine(p, songTitle) ||
    isSongNameLine(p.replace(/[(（].*$/, '').trim(), songTitle));
}

/**
 * @param {string} lrcText  LRC 全文
 * @param {string} [songTitle]  歌名。沒給就只跑規則 1~3 (歌名行需要它才判斷得了)
 */
/**
 * 時間戳的第三段統一成點號:網易有些歌給的是 `[00:04:03]` 而不是 `[00:04.03]`
 * (實測 muque / tape 是 44/46 行都這樣)。只有 `app.js` 的正規式兩種都吃,
 * 靈動島、行動版、以及譯文/羅馬字/逐字三個合併模組全部只認點號 ——
 * 症狀是「網頁有歌詞、島是空的」,而且沒有任何錯誤訊息。
 * 正規化集中在兩個匯流點 (這裡 = 所有寫入路徑,server.js 的 injectFurigana = 所有讀取路徑),
 * **不要改成去各家的正規式加 `[\.:]`** —— 那是六份要同步改的東西。
 * 三段都是數字才換,所以 `[source:NetEase]`、`[ar:…]` 與 `#WORDS#` 的 `索引:毫秒` 都不受影響。
 */
function normalizeLrcTime(text) {
  return text ? text.replace(/\[(\d+):(\d+):(\d+)\]/g, '[$1:$2.$3]') : text;
}

function autoMarkTitleLines(lrcText, songTitle) {
  if (!lrcText) return lrcText;
  const lines = normalizeLrcTime(lrcText).split('\n');
  const newLines = [];
  // 標頭區塊的狀態:一旦遇到「不是製作人員列」的內容行就永久關閉
  let headerIntact = true;
  let creditsSoFar = 0;

  for (let line of lines) {
    let stripped = line.trim();
    if (!stripped) {
      newLines.push(line);
      continue;
    }
    const match = stripped.match(/^(\[(?:\d+:\d+(?:\.\d+)?)\])+(.+)$/);
    if (match) {
      const tags = match[1];
      let text = match[2].trim();
      const already = text.startsWith("#TITLE#");
      // **無冒號式只在標頭區塊內才算數。** `music`/`bass`/`lyric`/`drum` 這些關鍵字在英文歌詞
      // 正文裡到處都是,不設限就會把唱出來的句子當成製作人員列藏掉 —— 全庫實測誤殺 11 行,
      // 全部是正文 (`Greatest music saves the day`、`君へのlyric 隠したlipstick`、
      // `Turn it bass turn it beats`)。有冒號的標籤式與版權聲明不受限:它們的訊號夠強,
      // 而收在歌尾的製作人員列 (實測 TEST/FAST、Kroi/Hyper) 正是那種寫法。
      // ponytail: 代價是「歌尾的無冒號製作人員列」會漏標,全庫目前一首都沒有,真的出現再說。
      let isTitle = already ||
        isCopyrightClaim(text) || isCreditLabel(text) || (headerIntact && isCreditPlain(text));

      if (!isTitle && headerIntact &&
          (isTitleArtistHeader(text, songTitle) ||
           (creditsSoFar > 0 && isSongNameLine(text, songTitle)))) {
        isTitle = true;
      }
      if (isTitle) {
        creditsSoFar++;
        if (!already) text = "#TITLE#" + text;
      } else {
        headerIntact = false;
      }
      newLines.push(`${tags}${text}`);
    } else {
      newLines.push(stripped);
    }
  }
  return newLines.join('\n');
}

module.exports = { autoMarkTitleLines, normalizeLrcTime, isCreditLabel, isCreditPlain, isCopyrightClaim, isSongNameLine, isTitleArtistHeader };
