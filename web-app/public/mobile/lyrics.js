/**
 * 行動版的歌詞解析 (規格 §4.1 / §5.1)。純函式,獨立成檔的理由同 playback.js:
 * 測試 require 得到,瀏覽器則當一般 <script> 載入。
 *
 * 吃的是 /api/lyrics 回的 LRC 字串,行內已經是注音好的 <ruby> HTML
 * (furigana_inject.py 分詞前就 html.escape 過了,所以 innerHTML 畫它是安全的)。
 */

/**
 * LRC → [{ ms, html }],依時間排序。一行可以掛多個時間戳 (副歌重複),各自展開成一句。
 * 行動版只畫歌詞本體:製作人員列與譯文/羅馬字都吃掉 —— 那三種在桌面版各有開關,
 * 手機上沒有開關,而 server 是否併入它們取決於桌面的設定,照單全收會突然多出兩行。
 */
function parseLrc(text) {
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const m = line.match(/^((?:\[\d+:\d+(?:\.\d+)?\])+)(.*)$/);
    if (!m) continue;
    const html = m[2].trim();
    if (/^#(TITLE|TRANS|ROMAJI)#/.test(html)) continue;
    for (const tag of m[1].match(/\[\d+:\d+(?:\.\d+)?\]/g) || []) {
      const [mm, ss] = tag.slice(1, -1).split(':');
      out.push({ ms: (parseInt(mm, 10) * 60 + parseFloat(ss)) * 1000, html });
    }
  }
  return out.sort((a, b) => a.ms - b.ms);
}

/** 目前唱到第幾句 (最後一句時間 <= pos)。第一句還沒到就回 -1,那時不高亮任何一行 */
function activeIndex(lines, posMs) {
  let i = -1;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k].ms > posMs) break;
    i = k;
  }
  return i;
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
  module.exports = { parseLrc, activeIndex, escapeHtml, readCache, writeCache, CACHE_KEY, CACHE_MAX };
}
