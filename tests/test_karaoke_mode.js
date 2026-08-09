// 卡拉OK模式的回歸測試:node tests/test_karaoke_mode.js
// 兩個純函式:LRC 解析 (從 app.js 抽出來,首頁與卡拉OK頁共用) 與字幕機的兩行版面數學。
const assert = require('assert');
const { parseLrc } = require('../web-app/public/js/lrc-parse.js');
const { karaokeSlots } = require('../web-app/public/js/karaoke-slots.js');

// ===== 1. parseLrc =====

// 標記行不自成一行,而是掛回歌詞行上
{
    const r = parseLrc([
        '[source:NetEase]',
        '[00:00.00]#TITLE#作詞 : A',
        '[00:10.00]AAA',
        '[00:10.00]#TRANS#譯文一',
        '[00:10.00]#ROMAJI#roma ichi',
        '[00:20.00]BBB',
    ].join('\n'));
    assert.strictEqual(r.source, 'NetEase', '[source:] 挖得出來');
    assert.strictEqual(r.unsynced, false);
    assert.strictEqual(r.lines.length, 2, '#TITLE# 丟掉、#TRANS#/#ROMAJI# 不佔行');
    assert.strictEqual(r.lines[0].text, 'AAA');
    assert.strictEqual(r.lines[0].translation, '譯文一');
    assert.strictEqual(r.lines[0].romaji, 'roma ichi');
    assert.strictEqual(r.lines[1].translation, null, '沒有譯文就是 null 不是 undefined');
}

// #WORDS# 要掛到**每一個**同時間戳的重複句 (副歌一行帶多個時間戳)
{
    const r = parseLrc([
        '[00:10.00]AAA',
        '[00:30.00]AAA',
        '[00:20.00]BBB',
        '[00:10.00][00:30.00]#WORDS#0:0,3:900',
    ].join('\n'));
    assert.deepStrictEqual(r.lines.map(l => l.time), [10, 20, 30], '排序過');
    assert.deepStrictEqual(r.lines[0].words, [[0, 0], [3, 900]], '第一次出現有逐字');
    assert.strictEqual(r.lines[1].words, null, '沒被指到的行不該有');
    assert.deepStrictEqual(r.lines[2].words, [[0, 0], [3, 900]], '重複那次也要有 —— 只掛上一句就會漏');
}

// 沒有時間戳 = 純文字歌詞
{
    const r = parseLrc('第一行\n第二行\n');
    assert.strictEqual(r.unsynced, true);
    assert.strictEqual(r.lines.length, 2);
    assert.strictEqual(r.lines[0].time, -1);
}

// 空歌詞不該炸,medianGap 要有保底值
{
    const r = parseLrc('');
    assert.deepStrictEqual(r.lines, []);
    assert.strictEqual(r.medianGap, 4);
}

// 沒有文字的時間戳補成 ♫,連續的只留一個;間隔中位數算得出來
{
    const r = parseLrc('[00:00.00]\n[00:02.00]\n[00:10.00]AAA\n[00:14.00]BBB\n');
    assert.deepStrictEqual(r.lines.map(l => l.text), ['♫', 'AAA', 'BBB'], '連續 ♫ 只留一個');
    assert.strictEqual(r.medianGap, 10, '間隔 [4, 10] 的中位數取上面那個');
}

// ===== 2. karaokeSlots =====

const L = [
    { time: 10, text: 'AAA' },
    { time: 13, text: 'BBB' },
    { time: 16, text: '♫' },       // 間奏
    { time: 30, text: 'CCC' },
    { time: 33, text: 'DDD' },
];

// 一般推進:當前句 + 下一句
{
    const s = karaokeSlots(L, 13.5);
    assert.strictEqual(s.index, 1, '落在 BBB');
    assert.strictEqual(s.nextIndex, 3, '下一句要跳過間奏行');
    assert.strictEqual(s.countdown, null, '正在唱不倒數');
}

// 間奏中:♫ 不佔畫面,直接把 CCC 提上來,而且要倒數
{
    const s = karaokeSlots(L, 20);
    assert.strictEqual(s.index, 3, '間奏時顯示接下來那一句');
    assert.strictEqual(s.nextIndex, 4);
    assert.ok(s.countdown, '間奏要倒數');
    assert.strictEqual(s.countdown.total, 3, '倒數窗最多 COUNT_IN 秒');
    assert.strictEqual(s.countdown.remain, 3, '離開口還很遠時點全亮');
    assert.strictEqual(karaokeSlots(L, 28.5).countdown.remain, 1.5, '快到了剩一半');
}

// 開頭:還沒唱第一句
{
    const s = karaokeSlots(L, 2);
    assert.strictEqual(s.index, 0, '第一句先擺上去');
    assert.ok(s.countdown, '前奏要倒數');
}

// 沒有 ♫ 標記的長間隔:開口前 COUNT_IN 秒才換上來 (很多來源不寫間奏行)
{
    const M = [{ time: 10, text: 'AAA' }, { time: 40, text: 'BBB' }];
    assert.strictEqual(karaokeSlots(M, 20).index, 0, '間隔中段仍停在剛唱完那句');
    assert.strictEqual(karaokeSlots(M, 20).countdown, null, '那時不倒數');
    const s = karaokeSlots(M, 38);
    assert.strictEqual(s.index, 1, '剩 2 秒才換上來');
    assert.strictEqual(s.countdown.remain, 2);
}

// 句距短就不倒數,否則整首歌都在閃
{
    const s = karaokeSlots(L, 12.9);
    assert.strictEqual(s.index, 0, 'AAA 還沒唱完');
    assert.strictEqual(s.countdown, null);
}

// 尾段間奏:後面沒有真歌詞了就停在最後一句,不倒數
{
    const s = karaokeSlots([{ time: 10, text: 'AAA' }, { time: 20, text: '♫' }], 25);
    assert.strictEqual(s.index, 0);
    assert.strictEqual(s.nextIndex, -1);
    assert.strictEqual(s.countdown, null);
}

// hint 是效能提示,不准改變答案
for (let pos = 0; pos <= 40; pos += 0.5) {
    const truth = karaokeSlots(L, pos);
    for (let h = -1; h < L.length; h++) {
        assert.strictEqual(karaokeSlots(L, pos, h).index, truth.index, `hint=${h} pos=${pos}`);
    }
}

// 空歌詞
assert.deepStrictEqual(karaokeSlots([], 5), { index: -1, nextIndex: -1, top: -1, bottom: -1, countdown: null });

// ===== 3. 上下槽的交替 (JOYSOUND 式) =====
// 槽位是「第幾句真歌詞」的奇偶,所以同一句永遠待在同一槽 —— 唱上面那句時下面已經是
// 下一句,唱下面那句時上面換成再下一句。
{
    const s0 = karaokeSlots(L, 11);       // AAA (第 0 句真歌詞) → 上
    assert.deepStrictEqual([s0.top, s0.bottom], [0, 1], 'AAA 在上、BBB 在下');
    assert.strictEqual(s0.index, 0, '活躍句是上面那句');

    const s1 = karaokeSlots(L, 14);       // BBB (第 1 句) → 下,上面換成 CCC
    assert.deepStrictEqual([s1.top, s1.bottom], [3, 1], '唱下面那句時上面換成再下一句');
    assert.strictEqual(s1.index, 1, '活躍句是下面那句');

    const s2 = karaokeSlots(L, 31);       // CCC (第 2 句,間奏不算) → 上
    assert.deepStrictEqual([s2.top, s2.bottom], [3, 4], '間奏行不佔奇偶序號');
    assert.strictEqual(s2.index, 3);
}

// 同一句不會因為 seek 而換槽:一路掃過去,每個 index 出現時都在同一邊
{
    const seen = {};
    for (let pos = 0; pos <= 40; pos += 0.25) {
        const s = karaokeSlots(L, pos);
        for (const [i, side] of [[s.top, 'top'], [s.bottom, 'bottom']]) {
            if (i < 0) continue;
            if (seen[i] === undefined) seen[i] = side;
            assert.strictEqual(seen[i], side, `第 ${i} 行在 pos=${pos} 跳槽了`);
        }
    }
}

// 最後一句:另一槽留空
{
    const s = karaokeSlots(L, 34);
    assert.strictEqual(s.index, 4, 'DDD');
    assert.deepStrictEqual([s.top, s.bottom], [-1, 4], '沒有下一句時上槽是空的');
}

console.log('test_karaoke_mode: OK');
