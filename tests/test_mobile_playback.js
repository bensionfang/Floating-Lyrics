/**
 * 行動版播放插值的回歸測試。
 *
 *   node tests/test_mobile_playback.js
 *
 * 插值壞掉在畫面上只是「進度條怪怪的」,沒有錯誤訊息,所以把邊界釘死。
 */
const assert = require('assert');
const {
  snapshot, positionAt, pollDelay, POLL_PLAYING_MS, POLL_PAUSED_MS,
} = require('../web-app/public/mobile/playback');

const payload = (over = {}) => ({
  is_playing: true,
  progress_ms: 30000,
  item: { id: 'abc', name: '春泥棒', artists: [{ name: 'ヨルシカ' }], duration_ms: 240000 },
  ...over,
});

// --- snapshot -------------------------------------------------------------
const t0 = 1000;
const s = snapshot(payload(), t0);
assert.strictEqual(s.id, 'abc');
assert.strictEqual(s.artist, 'ヨルシカ');
assert.strictEqual(s.at, t0, '快照要記下量測時間,否則插值沒有基準');
assert.strictEqual(snapshot(null, t0), null, '沒有播放中的裝置應回 null');
assert.strictEqual(snapshot({ item: null }, t0), null);
// 多位歌手串起來
assert.strictEqual(
  snapshot(payload({ item: { ...payload().item, artists: [{ name: 'A' }, { name: 'B' }] } }), t0).artist,
  'A, B');

// 封面:images 由大到小,取 [0];沒有 album 的 (單曲、podcast) 要回空字串而不是炸掉,
// 前端靠這個空字串把 <img> 藏起來,不然會留一個破圖框
assert.strictEqual(s.art, '', '沒有 album 時封面應為空字串');
assert.strictEqual(
  snapshot(payload({ item: {
    ...payload().item,
    album: { images: [{ url: 'https://i.scdn.co/big' }, { url: 'https://i.scdn.co/small' }] },
  } }), t0).art,
  'https://i.scdn.co/big');
assert.strictEqual(
  snapshot(payload({ item: { ...payload().item, album: { images: [] } } }), t0).art, '');

// --- positionAt -----------------------------------------------------------
assert.strictEqual(positionAt(s, t0), 30000, '同一時刻應等於量到的位置');
assert.strictEqual(positionAt(s, t0 + 2500), 32500, '播放中要隨時間前進');
assert.strictEqual(positionAt({ ...s, isPlaying: false }, t0 + 2500), 30000, '暫停中不可以前進');
assert.strictEqual(positionAt(s, t0 + 999999), 240000, '不可以超過歌曲長度');
assert.strictEqual(positionAt(s, t0 - 500), 30000, '時鐘倒退時不可以往回跑');
assert.strictEqual(positionAt(null, t0), 0);
// 長度不明 (0) 時不夾,免得進度條永遠停在 0
assert.strictEqual(positionAt({ ...s, durationMs: 0 }, t0 + 5000), 35000);

// --- pollDelay ------------------------------------------------------------
assert.strictEqual(pollDelay(s), POLL_PLAYING_MS);
assert.strictEqual(pollDelay({ ...s, isPlaying: false }), POLL_PAUSED_MS);
assert.strictEqual(pollDelay(null), POLL_PAUSED_MS, '沒有播放來源時不要用最短間隔空轉');

console.log('全部通過');
