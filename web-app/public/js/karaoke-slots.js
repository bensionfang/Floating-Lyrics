/*
 * 卡拉OK字幕機的版面數學:給定歌詞與播放位置,回答「哪一句放上面、哪一句放下面、
 * 還有幾秒開口」。純函式,獨立成檔的理由同 scroll-zone.js —— 測試 require 得到而不必起瀏覽器。
 *
 * 與首頁 `syncLyricsToTime` 的差別有兩處,都是「唱」與「聽」的差別:
 *
 * 1. **當前句永遠是「有字的那一句」**。落在間奏 (♫) 上時直接把後面那句真歌詞提上來 ——
 *    那時 `pos < cur.time`,karaokePaint 自己算出 0%,一個字都不會亮。首頁捲動時 ♫ 是
 *    一行畫面,唱的人卻要在間奏時就看到下一句是什麼。
 * 2. **間隔夠長才倒數**。句與句之間本來就有三四秒 (`medianGap` 全庫多半是 4 上下),
 *    每句都倒數等於整首歌都在閃。所以「這是間奏」的門檻 (GAP) 與「倒數窗」(COUNT_IN)
 *    是兩個數:間隔 >= GAP 才算間奏,而且要到開口前 COUNT_IN 秒才把下一句換上來。
 *    這條讓沒有 ♫ 標記的歌詞 (很多來源不寫間奏行) 一樣有倒數。
 */
const KARAOKE_COUNT_IN_SEC = 3;
const KARAOKE_GAP_SEC = 6;      // 超過這個間隔才算間奏 —— 一般句距的兩倍

function karaokeSlots(lines, posSec, hint, countInSec) {
    const countIn = typeof countInSec === 'number' ? countInSec : KARAOKE_COUNT_IN_SEC;
    if (!lines || !lines.length) return { index: -1, nextIndex: -1, countdown: null };

    // 落在哪一行 (最後一個 time <= pos)。hint 是上一幀的答案,傳錯不會算錯,只是退回全掃。
    let i = (typeof hint === 'number' && hint >= 0 && hint < lines.length && lines[hint].time <= posSec)
        ? hint : -1;
    while (i + 1 < lines.length && lines[i + 1].time <= posSec) i++;

    const upcoming = nextReal(lines, i);
    let cur;
    if (i < 0 || isFiller(lines[i])) {
        // 間奏中 / 還沒開唱:直接顯示接下來那一句
        cur = upcoming >= 0 ? upcoming : lastReal(lines);
    } else if (upcoming >= 0 &&
               lines[upcoming].time - lines[i].time >= KARAOKE_GAP_SEC &&
               lines[upcoming].time - posSec <= countIn) {
        // 沒有 ♫ 標記的長間隔:開口前 countIn 秒才換上來
        cur = upcoming;
    } else {
        cur = i;
    }
    if (cur < 0) return { index: -1, nextIndex: -1, countdown: null };

    const nextIndex = nextReal(lines, cur);

    let countdown = null;
    if (lines[cur].time > posSec) {
        const anchor = i >= 0 ? lines[i].time : 0;
        const gap = lines[cur].time - anchor;
        if (gap >= countIn) {
            const total = Math.min(gap, countIn);
            countdown = { total, remain: Math.min(lines[cur].time - posSec, total) };
        }
    }

    return { index: cur, nextIndex, countdown };
}

// 間奏行:沒有文字的時間戳被 lrc-parse.js 補成 ♫
function isFiller(line) {
    return !line || !line.text || line.text === '♫';
}

function nextReal(lines, from) {
    for (let j = from + 1; j < lines.length; j++) if (!isFiller(lines[j])) return j;
    return -1;
}

function lastReal(lines) {
    for (let j = lines.length - 1; j >= 0; j--) if (!isFiller(lines[j])) return j;
    return -1;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { karaokeSlots, KARAOKE_COUNT_IN_SEC, KARAOKE_GAP_SEC };
