/**
 * 逐字時間的合併 (卡拉OK填色用)。以 `#WORDS#` 前綴插在對應歌詞行後面,
 * 走 `#TRANS#`/`#ROMAJI#` 完全一樣的路 —— 同一個時間戳、獨立一行、客戶端自己認前綴。
 *
 * **兩份資料的斷句常常不同**:逐字時間只有 QQ 的 QRC 給得出來,而歌詞本體 65% 來自網易,
 * 網易切短行、QQ 併長行 (`ぶっ飛んじゃってる` vs `ぶっ飛んじゃってる 自意識過剰`)。
 * 整行比對只有 62% 對得上,所以 python 端 (`cn_music._qrc_flow`) 把整首歌串成一條
 * 「字元流 + 每字毫秒」,這裡用單調前進的方式在流裡找每一行。實測行覆蓋率中位數 98%。
 *
 * 獨立成一個檔案是為了讓 test_word_times.js require 得到而不必啟動 server,
 * 跟 s2t.js、translations.js 同一個理由 —— **記得同步加進 package.json 的 build.files**。
 */
const { normalizeLine, stripRuby } = require('./translations');

const LINE_RE = /^((?:\[\d+:\d+(?:\.\d+)?\])+)(.+)$/;
const SKIP = /^#(TITLE|TRANS|ROMAJI|WORDS)#/;

/**
 * 正規化後的第 j 個字元,在原始行裡是第幾個字元。
 * normalizeLine 是逐字元篩選 (只留 \p{L}\p{N}\p{M}_),所以走一遍原文數過去就是了。
 */
function rawIndexMap(raw) {
  const map = [];
  for (let i = 0; i < raw.length; i++) {
    if (normalizeLine(raw[i])) map.push(i);
  }
  return map;
}

/**
 * (字元索引, 毫秒) 折線的簡化:斜率沒變的中間點可以丟掉,客戶端本來就是線性內插。
 * python 端在 token 內是把長度平均分給每個字的,所以一個 token 通常只剩頭尾兩點。
 */
function simplify(points) {
  if (points.length < 3) return points;
  const out = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const [pi, pt] = out[out.length - 1];
    const [ci, ct] = points[i];
    const [ni, nt] = points[i + 1];
    // 前後兩段斜率相同 = 這一點落在直線上,丟掉不影響內插結果
    if ((ct - pt) * (ni - ci) !== (nt - ct) * (ci - pi)) out.push(points[i]);
  }
  out.push(points[points.length - 1]);
  return out;
}

/**
 * 把逐字時間併進注音後的 LRC。
 * @param {string} lrcHtml  injectFurigana (含譯文/羅馬字) 的輸出
 * @param {object} wt       {flow, ms} —— 整首歌的正規化字元流與每字的絕對毫秒。空物件 = 沒有逐字
 * @returns {string} 原字串 (沒有任何行對得上時逐字不變) 或插入 #WORDS# 行後的新字串
 */
function mergeWordTimes(lrcHtml, wt) {
  const flow = wt && wt.flow;
  const ms = wt && wt.ms;
  if (!lrcHtml || !flow || !ms || ms.length !== flow.length) return lrcHtml;

  const lines = lrcHtml.split('\n');
  const out = [];
  let cursor = 0;
  let inserted = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    const m = line.trim().match(LINE_RE);
    if (!m) continue;
    const text = m[2].trim();
    if (SKIP.test(text)) continue;
    // 下一行已經是這句的逐字時間就跳過 —— 同一份輸入合併兩次不該插出兩行
    const next = (lines[i + 1] || '').trim().match(LINE_RE);
    if (next && next[2].trim().startsWith('#WORDS#')) continue;

    const raw = stripRuby(text);
    const key = normalizeLine(raw);
    if (!key) continue;

    // 單調前進;找不到再從頭找一次 (副歌重複行、兩邊行序不同)
    let at = flow.indexOf(key, cursor);
    if (at < 0) at = flow.indexOf(key);
    if (at < 0) continue;
    cursor = at + key.length;

    const map = rawIndexMap(raw);
    if (map.length !== key.length) continue;   // 理論上不會,對不上就寧可不插

    // **毫秒要改成相對於這一行自己的時間戳**:flow 的毫秒是 QQ 的時間軸,
    // 而客戶端的播放位置是對著歌詞本身的時間戳 (多半來自網易),兩條時間軸不同源。
    // 逐行重新對齊比整體套一個偏移穩,行內的漂移只有幾百毫秒。
    const base = ms[at];
    const pts = [];
    for (let j = 0; j < key.length; j++) pts.push([map[j], ms[at + j] - base]);
    // 收尾點:最後一個字唱完的時間。流裡還有下一個字就用它 —— 但**要封頂**,
    // 這一句後面接間奏時下一個字可能是好幾秒後,不封頂的話最後一個字會慢慢填好幾秒。
    const last = pts[pts.length - 1][1];
    const lastStep = key.length > 1 ? Math.max(ms[at + key.length - 1] - ms[at + key.length - 2], 120) : 300;
    const cap = last + lastStep * 2;
    const endMs = at + key.length < ms.length
      ? Math.min(Math.max(ms[at + key.length] - base, last + 1), cap)
      : last + lastStep;
    pts.push([raw.length, endMs]);

    out.push(`${m[1]}#WORDS#${simplify(pts).map(([idx, t]) => `${idx}:${t}`).join(',')}`);
    inserted++;
  }
  return inserted ? out.join('\n') : lrcHtml;
}

module.exports = { mergeWordTimes, rawIndexMap, simplify };
