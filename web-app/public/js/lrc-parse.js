/*
 * LRC 解析:把 server 送來的歌詞字串拆成 [{time, text, translation, romaji, words}]。
 *
 * 從 app.js 抽出來的,行為一個字都沒改。獨立成檔的理由同 scroll-zone.js / karaoke.js:
 * 卡拉OK頁 (karaoke-mode.js) 要用同一份,而測試要 require 得到而不必啟動 server。
 * **各寫一份就是靜默失效的來源** —— 標記行的處理漏一種不會報錯,只是那個功能在那一頁不動。
 *
 * (島與行動版各自還有一份 parseLrc,那兩份回傳的形狀不同 —— 它們把譯文/羅馬字/逐字收進
 *  以時間戳為鍵的對照表而不是掛在行物件上 —— 刻意不動。)
 */
function parseLrc(lrcText) {
    let lines = [];
    let unsynced = false;
    let source = '';
    if (!lrcText) return { lines, unsynced, source, medianGap: 4 };

    const rawLines = lrcText.split('\n');
    const timeReg = /\[(\d+):(\d+)(?:[\.:](\d+))?\]/g;

    let hasTags = false;

    rawLines.forEach(line => {
        line = line.trim();
        if (!line) return;

        if (line.startsWith("[source:")) {
            source = line.substring(8, line.length - 1);
            return;
        }

        let match;
        const text = line.replace(/\[\d+:\d+(?:[\.:]\d+)?\]/g, '').trim();
        if (text.startsWith('#TITLE#')) return;
        // 譯文行 (server 端 mergeTranslations 插的) 掛到上一句歌詞上,不自成一行。
        // 它與原句共用時間戳,所以下面的 0.05s 合併也接得住,但顯式判斷比較穩 ——
        // 有些來源的歌詞本身就自帶譯文行,那條路徑仍然要留著。
        if (text.startsWith('#TRANS#')) {
            const prev = lines[lines.length - 1];
            if (prev) prev.translation = text.substring(7);
            return;
        }
        // 羅馬拼音行 (server 端 mergeRomaji 插的),同樣掛到上一句而不自成一行
        if (text.startsWith('#ROMAJI#')) {
            const prev = lines[lines.length - 1];
            if (prev) prev.romaji = text.substring(8);
            return;
        }
        // 逐字時間行 (server 端 mergeWordTimes 插的):`字元索引:相對毫秒` 的折線,
        // 客戶端線性內插就得到「現在唱到第幾個字」。毫秒是相對於這一句自己的時間戳 ——
        // 逐字來源 (QQ) 與歌詞來源 (多半網易) 是兩條時間軸,只有逐行重新對齊才對得上。
        if (text.startsWith('#WORDS#')) {
            const pts = text.substring(7).split(',').map((p) => {
                const [idx, ms] = p.split(':');
                return [parseInt(idx, 10), parseInt(ms, 10)];
            }).filter(([idx, ms]) => Number.isFinite(idx) && Number.isFinite(ms));
            // 掛回去要**比對時間戳**而不是「掛到上一句」:副歌重複時一行帶多個時間戳,
            // 會展開成好幾筆,只掛最後一筆的話重複的那幾句就沒有填色 (譯文/羅馬字有同樣的
            // 限制,但那兩個少一行只是少一行,這裡是功能整段不動)
            const times = new Set();
            timeReg.lastIndex = 0;
            let wm;
            while ((wm = timeReg.exec(line)) !== null) {
                times.add(parseInt(wm[1]) * 60 + parseInt(wm[2]) + (wm[3] ? parseFloat('0.' + wm[3]) : 0));
            }
            for (let i = lines.length - 1; i >= 0 && times.size; i--) {
                if (!times.has(lines[i].time)) continue;
                lines[i].words = pts;
                times.delete(lines[i].time);
            }
            return;
        }

        timeReg.lastIndex = 0;
        while ((match = timeReg.exec(line)) !== null) {
            hasTags = true;
            const minutes = parseInt(match[1]);
            const seconds = parseInt(match[2]);
            let msFraction = 0;
            if (match[3]) {
                msFraction = parseFloat('0.' + match[3]);
            }
            const timeInSeconds = minutes * 60 + seconds + msFraction;
            lines.push({ time: timeInSeconds, text: text || '♫' });
        }
    });

    if (!hasTags) {
        // If no LRC tags were found, treat it as unsynced plain text
        unsynced = true;
        lines = [];
        rawLines.forEach(line => {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#TITLE#') && !trimmed.startsWith('[source:')) {
                lines.push({ time: -1, text: trimmed });
            }
        });
    } else {
        lines.sort((a, b) => a.time - b.time);

        // Remove consecutive empty lines (♫)
        lines = lines.filter((item, index, arr) => {
            if (item.text === '♫') {
                if (index > 0 && arr[index - 1].text === '♫') {
                    return false;
                }
            }
            return true;
        });

        // Merge lines with similar time tags (translations/romaji)
        const merged = [];
        for (let i = 0; i < lines.length; i++) {
            const current = lines[i];
            const prev = merged[merged.length - 1];

            // If time diff is very small (< 0.05s), treat as a translation line
            if (prev && Math.abs(current.time - prev.time) < 0.05) {
                if (!prev.translation) {
                    prev.translation = current.text;
                } else {
                    prev.translation += ' / ' + current.text;
                }
            } else {
                // translation/romaji/words 要帶過來 —— 那幾個是在上面掛到物件上的,漏一個就洗掉一個
                merged.push({ time: current.time, text: current.text, translation: current.translation || null, romaji: current.romaji || null, words: current.words || null });
            }
        }
        lines = merged;
    }

    // 段落循環用:相鄰行間隔的中位數 = 「一句大約多長」,估尾段間奏。
    // 只取正的間隔 (unsynced 的 -1 或同時間戳的 0 都跳過),沒有就用預設保底。
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
        const d = lines[i].time - lines[i - 1].time;
        if (d > 0) gaps.push(d);
    }
    let medianGap = 4;
    if (gaps.length) {
        gaps.sort((a, b) => a - b);
        medianGap = gaps[Math.floor(gaps.length / 2)];
    }

    return { lines, unsynced, source, medianGap };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { parseLrc };
