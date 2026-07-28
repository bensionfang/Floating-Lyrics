// 行動版的 LRC 解析與目前行判定。跑法:node tests/test_mobile_lyrics.js
const assert = require('assert');
const { parseLrc, activeIndex, escapeHtml, readCache, writeCache, CACHE_KEY, CACHE_MAX } = require('../web-app/public/mobile/lyrics.js');

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

// 3. 製作人員列 / 譯文 / 羅馬字都吃掉,ruby 與空行 (間奏) 留著
{
  const lines = parseLrc([
    '[source:NetEase]',
    '[00:00.00]#TITLE#作詞 : 米津玄師',
    '[00:05.00]<ruby>春<rt>はる</rt></ruby>',
    '[00:05.00]#TRANS#春天',
    '[00:05.00]#ROMAJI#haru',
    '[00:08.00]',
  ].join('\n'));
  assert.deepStrictEqual(lines.map((l) => l.html), ['<ruby>春<rt>はる</rt></ruby>', '']);
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

console.log('test_mobile_lyrics: 全部通過');
