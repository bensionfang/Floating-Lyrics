// 行動版的 LRC 解析與目前行判定。跑法:node tests/test_mobile_lyrics.js
const assert = require('assert');
const { parseLrc, activeIndex, medianGap, loopEndMs, escapeHtml, readCache, writeCache, CACHE_KEY, CACHE_MAX } = require('../web-app/public/mobile/lyrics.js');

// 1. 基本解析 + 排序 + 毫秒
{
  const lines = parseLrc('[00:12.50]あ\n[01:00.00]い\n[00:05.00]う');
  assert.deepStrictEqual(lines.map((l) => l.ms), [5000, 12500, 60000]);
  assert.strictEqual(lines[1].html, 'あ');
}

// 2. 一行掛多個時間戳 (副歌重複) → 各自展開成一句
{
  const lines = parseLrc('[00:10.00][01:10.00]サビ');
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual(lines.map((l) => l.ms), [10000, 70000]);
  assert.ok(lines.every((l) => l.html === 'サビ'));
}

// 3. 製作人員列與羅馬字吃掉,ruby 與空行 (間奏) 留著;譯文掛回同一個時間戳的那句
{
  const lines = parseLrc([
    '[source:NetEase]',
    '[00:00.00]#TITLE#作詞 : 米津玄師',
    '[00:05.00]<ruby>春<rt>はる</rt></ruby>',
    '[00:05.00]#TRANS#春天',
    '[00:05.00]#ROMAJI#haru',
    '[00:05.00]#WORDS#0:0,1:400',
    '[00:08.00]',
  ].join('\n'));
  assert.deepStrictEqual(lines.map((l) => l.html), ['<ruby>春<rt>はる</rt></ruby>', '']);
  // 譯文不能自成一句 (會多出一行且時間軸重複),要掛在對應那句上
  assert.strictEqual(lines[0].trans, '春天');
  assert.strictEqual(lines[1].trans, undefined, '沒有譯文的行不該長出 trans');
  // 逐字時間同理:掛成 words 給卡拉OK填色用,不能自成一句
  assert.deepStrictEqual(lines[0].words, [[0, 0], [1, 400]]);
  assert.strictEqual(lines[1].words, undefined, '沒有逐字的行不該長出 words');
}

// 3a. 壞掉的 #WORDS# 不能把整份解析弄爆 (雲端那台的資料是外部來源)
{
  const lines = parseLrc('[00:05.00]本文\n[00:05.00]#WORDS#壞,掉:的,2:800');
  assert.strictEqual(lines.length, 1);
  assert.deepStrictEqual(lines[0].words, [[2, 800]], '只留解析得出數字的那幾點');
}

// 3b. 譯文行排在歌詞行前面也要掛得上 (來源不保證順序)
{
  const lines = parseLrc('[00:05.00]#TRANS#譯\n[00:05.00]本文');
  assert.strictEqual(lines.length, 1);
  assert.strictEqual(lines[0].html, '本文');
  assert.strictEqual(lines[0].trans, '譯');
}

// 3c. 副歌重複時,每個時間戳各自掛自己的譯文
{
  const lines = parseLrc([
    '[00:10.00][01:10.00]サビ',
    '[00:10.00]#TRANS#副歌一',
    '[01:10.00]#TRANS#副歌二',
  ].join('\n'));
  assert.deepStrictEqual(lines.map((l) => l.trans), ['副歌一', '副歌二']);
}

// 4. 目前行:第一句還沒到回 -1,之後取「最後一句時間 <= pos」
{
  const lines = parseLrc('[00:05.00]a\n[00:10.00]b\n[00:20.00]c');
  assert.strictEqual(activeIndex(lines, 0), -1);
  assert.strictEqual(activeIndex(lines, 4999), -1);
  assert.strictEqual(activeIndex(lines, 5000), 0);
  assert.strictEqual(activeIndex(lines, 19999), 1);
  assert.strictEqual(activeIndex(lines, 999999), 2);
  assert.strictEqual(activeIndex([], 1000), -1);
}

// 5. lrclib 備援的逃逸:整份 LRC 逃逸後時間戳不受影響,標籤變不回真標籤
{
  const raw = '[00:05.00]<img src=x onerror=alert(1)>\n[00:10.00]Don\'t & "go"';
  const lines = parseLrc(escapeHtml(raw));
  assert.deepStrictEqual(lines.map((l) => l.ms), [5000, 10000]);
  assert.strictEqual(lines[0].html, '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(lines[1].html, 'Don&#x27;t &amp; &quot;go&quot;');
  assert.strictEqual(escapeHtml(null), '');
}

// 6. 歌詞快取:寫入/讀取、內容壞掉當沒快取、超過上限淘汰最舊的、配額滿了只留這一首
{
  const fake = (init = {}) => ({
    data: init,
    getItem(k) { return k in this.data ? this.data[k] : null; },
    setItem(k, v) { this.data[k] = v; },
  });

  const s = fake();
  writeCache(s, 'abc', { source: 'NetEase', lyrics: '[00:01.00]あ' });
  assert.strictEqual(readCache(s, 'abc').source, 'NetEase');
  assert.strictEqual(readCache(s, 'nope'), null);
  assert.strictEqual(readCache(fake({ [CACHE_KEY]: '{壞掉' }), 'abc'), null);

  // 淘汰:寫滿 CACHE_MAX + 1 首,最早那首要被丟掉
  const many = fake();
  for (let i = 0; i <= CACHE_MAX; i++) writeCache(many, `id${i}`, { lyrics: String(i) });
  assert.strictEqual(readCache(many, 'id0'), null);
  assert.strictEqual(readCache(many, `id${CACHE_MAX}`).lyrics, String(CACHE_MAX));
  assert.strictEqual(Object.keys(JSON.parse(many.data[CACHE_KEY])).length, CACHE_MAX);

  const full = fake();
  full.setItem = function (k, v) {
    if (v.length > 60) throw new Error('QuotaExceededError');   // 只放得下一首的量
    this.data[k] = v;
  };
  writeCache(full, 'x', { lyrics: '1'.repeat(30) });
  writeCache(full, 'y', { lyrics: '2'.repeat(30) });
  assert.strictEqual(readCache(full, 'x'), null);
  assert.strictEqual(readCache(full, 'y').lyrics, '2'.repeat(30));
}

// 7. 一句多長:取中位數而不是平均 (尾段間奏會把平均拉爆);同時間戳的重複行差是 0,不算
{
  const lines = parseLrc('[00:00.00]a\n[00:03.00]b\n[00:07.00]c\n[00:10.00]d\n[02:00.00]e');
  // 間隔 3000/4000/3000/110000 → 排序後取中間那個 (偶數筆取上中位數,不插值)。
  // 重點是那個 110000 的尾段間奏完全影響不到結果 —— 平均會是 30000
  assert.strictEqual(medianGap(lines), 4000);
  // 副歌重複 (同一行兩個時間戳) 不該把中位數壓成 0
  assert.strictEqual(medianGap(parseLrc('[00:00.00][00:00.00]サビ\n[00:04.00]b')), 4000);
  assert.strictEqual(medianGap([]), 0);
  assert.strictEqual(medianGap(parseLrc('[00:05.00]只有一句')), 0);
}

// 8. 循環終點:下一句開頭;最後一句用歌曲長度;離下一句太遠 (尾段間奏) 就提早在 B + 一句長×1.6
{
  const lines = parseLrc('[00:00.00]a\n[00:04.00]b\n[00:08.00]c\n[01:00.00]d');
  const gap = medianGap(lines);                       // 4000
  assert.strictEqual(loopEndMs(lines, 0, gap, 90000), 4000, 'B=第一句 → 下一句開頭');
  assert.strictEqual(loopEndMs(lines, 1, gap, 90000), 8000);
  // c 到 d 隔了 52 秒 (間奏),不能整段跟著循環 → 8000 + 4000×1.6
  assert.strictEqual(loopEndMs(lines, 2, gap, 90000), 14400);
  // B 是最後一句:歌曲長度與 cap 取小的那個
  assert.strictEqual(loopEndMs(lines, 3, gap, 62000), 62000);
  assert.strictEqual(loopEndMs(lines, 3, gap, 90000), 66400);
}

console.log('test_mobile_lyrics: 全部通過');
