// node tests/test_lrc_time.js
// 網易有些歌的時間戳是 `[mm:ss:xx]` (第三段用冒號而不是點),實測 muque / tape 是 44/46 行。
// 只有 app.js (網頁歌詞區) 的正規式吃得下,靈動島、行動版、以及譯文/羅馬字/逐字三個合併
// 模組全部只認點號 —— 症狀是「網頁有歌詞、島是空的」,而且沒有任何錯誤訊息。
// 修法是在匯流點統一成點號,不是去改六份正規式。
const assert = require('assert');
const { normalizeLrcTime, autoMarkTitleLines } = require('../web-app/title-lines');
const { parseLrc } = require('../web-app/public/mobile/lyrics.js');

// 冒號式的第三段換成點號
assert.strictEqual(normalizeLrcTime('[00:04:03]歌詞'), '[00:04.03]歌詞');
// 一行多個時間戳 (副歌重複行) 每個都要換
assert.strictEqual(normalizeLrcTime('[00:04:03][01:12:50]歌詞'), '[00:04.03][01:12.50]歌詞');
// 已經是點號的不動
assert.strictEqual(normalizeLrcTime('[00:04.03]歌詞'), '[00:04.03]歌詞');
// 只有 mm:ss 的不動 (各家解析器本來就吃得下)
assert.strictEqual(normalizeLrcTime('[00:04]歌詞'), '[00:04]歌詞');
// 不可以動到 [source:…] 與 [ar:…] 這類 meta,也不可以動到 #WORDS# 裡的 `索引:毫秒`
assert.strictEqual(normalizeLrcTime('[source:NetEase]'), '[source:NetEase]');
assert.strictEqual(normalizeLrcTime('[ar:米津玄師]'), '[ar:米津玄師]');
assert.strictEqual(normalizeLrcTime('[00:04:03]#WORDS#0:0,3:520'), '[00:04.03]#WORDS#0:0,3:520');

// autoMarkTitleLines 自己就會正規化 —— 五個呼叫點都經過它,不必各包一次
const marked = autoMarkTitleLines('[00:00:00]作詞 : ASAKURA\n[00:04:03]歌詞', 'tape');
assert.strictEqual(marked, '[00:00.00]#TITLE#作詞 : ASAKURA\n[00:04.03]歌詞');

// 正規化之後,只認點號的解析器 (行動版與靈動島是同一份寫法) 才吃得到這些行
const raw = '[00:00.50]零\n[00:04:03]一\n[00:08:11]二\n[00:12:22]三';
assert.strictEqual(parseLrc(raw).length, 1, '未正規化時只解析得到點號那一行');
assert.strictEqual(parseLrc(normalizeLrcTime(raw)).length, 4);

console.log('ok');
