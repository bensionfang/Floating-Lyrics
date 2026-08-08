/**
 * 行動版的歌詞解析 (規格 §4.1 / §5.1)。純函式,獨立成檔的理由同 playback.js:
 * 測試 require 得到,瀏覽器則當一般 <script> 載入。
 *
 * 吃的是 /api/lyrics 回的 LRC 字串,行內已經是注音好的 <ruby> HTML
 * (furigana_inject.py 分詞前就 html.escape 過了,所以 innerHTML 畫它是安全的)。
 */

/**
 * LRC → [{ ms, html, trans, romaji }],依時間排序。一行可以掛多個時間戳 (副歌重複),
 * 各自展開成一句。
 *
 * `#TRANS#` 是 mergeTranslations 插進來的譯文行,時間戳與它要翻的那句**完全相同**,
 * 所以用時間當鍵掛回去、不自成一句。`#ROMAJI#` (羅馬拼音) 與 `#WORDS#` (逐字時間)
 * 同理,分別掛成 `l.romaji` 與 `l.words`。只有 `#TITLE#` (製作人員列) 整行吃掉 ——
 * 那不是歌詞。
 */
function parseLrc(text) {
  const out = [];
  const trans = new Map();
  const romaji = new Map();
  const words = new Map();
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/);
    if (!m) continue;
    const html = m[2].trim();
    if (html.startsWith('#TITLE#')) continue;
    const isTrans = html.startsWith('#TRANS#');
    const isRomaji = html.startsWith('#ROMAJI#');
    const isWords = html.startsWith('#WORDS#');
    for (const tag of m[1].match(/\[\d+:\d+(?:\.\d+)?\]/g) || []) {
      const [mm, ss] = tag.slice(1, -1).split(':');
      const ms = (parseInt(mm, 10) * 60 + parseFloat(ss)) * 1000;
      if (isTrans) trans.set(ms, html.slice(7));
      else if (isRomaji) romaji.set(ms, html.slice(8));
      else if (isWords) {
        words.set(ms, html.slice(7).split(',').map((p) => {
          const [i, t] = p.split(':');
          return [parseInt(i, 10), parseInt(t, 10)];
        }).filter(([i, t]) => Number.isFinite(i) && Number.isFinite(t)));
      }
      else out.push({ ms, html });
    }
  }
  // 掛譯文/逐字要等整份掃完 —— 那兩種行在歌詞行後面,邊掃邊掛也可以,但同一個時間戳
  // 可能先出現它們再出現歌詞 (來源沒有保證順序),掃完再掛才不會漏
  for (const l of out) {
    if (trans.has(l.ms)) l.trans = trans.get(l.ms);
    if (romaji.has(l.ms)) l.romaji = romaji.get(l.ms);
    if (words.has(l.ms)) l.words = words.get(l.ms);
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/**
 * 目前唱到第幾句 (最後一句時間 <= pos)。第一句還沒到就回 -1,那時不高亮任何一行。
 *
 * `hint` 是「上一幀的答案」。rAF 每幀都會問一次,而答案幾乎永遠是上一次或它的下一個,
 * 從那裡往前/往後走就好 —— 每幀重掃整首歌是 100 行 × 120fps = 每秒一萬多次比較,
 * 而這一頁的 Wake Lock 正壓著螢幕不熄,那些都是白燒的電。
 * **傳錯不會算錯**,只是退回原本的線性掃描 (從 -1 往後走)。
 */
function activeIndex(lines, posMs, hint) {
  const n = lines.length;
  if (!n) return -1;
  let i = (Number.isInteger(hint) && hint >= -1 && hint < n) ? hint : -1;
  while (i + 1 < n && lines[i + 1].ms <= posMs) i++;   // 往後:下一句的時間已經到了
  while (i >= 0 && lines[i].ms > posMs) i--;           // 往回:seek 往前、或偏移改了
  return i;
}

/**
 * 「一句多長」= 全曲相鄰時間戳的**中位數**。平均值會被尾段間奏 (最後一句到歌末) 拉爆,
 * 中位數不會。只算正的間隔:同一時間戳的重複行 (副歌) 差是 0,算進去會把中位數壓到 0。
 */
function medianGap(lines) {
  const gaps = [];
  for (let i = 1; i < lines.length; i++) {
    const d = lines[i].ms - lines[i - 1].ms;
    if (d > 0) gaps.push(d);
  }
  if (!gaps.length) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

/**
 * 循環到哪裡:B 唱完 = 下一句開頭;B 已是最後一句就唱到歌曲結束。
 * 間奏防護:B 到下一句若遠超「一句長 × 1.6」(= 尾段間奏),提早在那裡跳回,
 * 不讓整段間奏跟著循環。數學照桌面的 loopEndTime() (app.js)。
 */
const LOOP_TAIL_FACTOR = 1.6;
function loopEndMs(lines, b, gapMs, durationMs) {
  const next = lines[b + 1];
  const hardEnd = next ? next.ms : (durationMs > 0 ? durationMs : Infinity);
  const cap = lines[b].ms + gapMs * LOOP_TAIL_FACTOR;
  return hardEnd > cap ? cap : hardEnd;
}

/**
 * lrclib 備援 (規格 §4.2) 的歌詞沒有經過 `furigana_inject.py`,**沒有人幫它逃逸過**,
 * 而畫面是 innerHTML 畫的 —— 不逃逸等於讓任何人上傳的歌詞在同源執行腳本。
 * 逃逸整份 LRC 字串再交給 parseLrc 就好:時間戳是 ASCII,不受影響。
 */
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
function escapeHtml(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/**
 * 歌詞快取 (規格 §4.3)。**用 localStorage 而不是 IndexedDB**:一首幾 KB,
 * 5MB 的配額放得下上千首,不值得為它引入非同步的 API。
 *
 * 整份存成**一個鍵底下的 map** (id → /api/lyrics 的回應),不是一首一個鍵 ——
 * 這樣淘汰最舊的只要靠物件的鍵順序,不必掃整個 localStorage。
 */
const CACHE_KEY = 'kanaric.mobile.lyrics';
const CACHE_MAX = 100;

function readCache(store, id) {
  try {
    return (JSON.parse(store.getItem(CACHE_KEY) || '{}'))[id] || null;
  } catch (e) {
    return null;   // 內容壞掉就當沒快取,下次寫入會整份蓋掉
  }
}

function writeCache(store, id, data) {
  let all;
  try { all = JSON.parse(store.getItem(CACHE_KEY) || '{}'); } catch (e) { all = {}; }
  all[id] = data;
  for (const k of Object.keys(all).slice(0, -CACHE_MAX)) delete all[k];
  try {
    store.setItem(CACHE_KEY, JSON.stringify(all));
  } catch (e) {
    // 配額滿了。歌詞隨時能重抓,整份丟掉只留這一首,不必挑要留哪些
    try { store.setItem(CACHE_KEY, JSON.stringify({ [id]: data })); } catch (e2) { /* 還是滿的就算了 */ }
  }
}

if (typeof module !== 'undefined') {
  module.exports = { parseLrc, activeIndex, medianGap, loopEndMs, escapeHtml, readCache, writeCache, CACHE_KEY, CACHE_MAX };
}
