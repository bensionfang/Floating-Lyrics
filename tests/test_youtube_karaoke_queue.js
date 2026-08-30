const assert = require('assert');
const { createYouTubeKaraokeQueue } = require('../web-app/public/js/youtube-karaoke-queue.js');

const item = (videoId) => ({ videoId, title: `Song ${videoId}`, channel: 'Channel', durationSec: 180, thumb: `https://img/${videoId}` });
const q = createYouTubeKaraokeQueue();

const a = q.add(item('dQw4w9WgXcQ'));
const b = q.add(item('kJQP7kiw5Fk'));
assert.match(a.queueId, /^q-\d+$/);
assert.notStrictEqual(a.queueId, b.queueId);
assert.deepStrictEqual(q.snapshot().items.map((x) => x.videoId), ['dQw4w9WgXcQ', 'kJQP7kiw5Fk']);
assert.strictEqual(q.snapshot().currentQueueId, a.queueId);

assert.strictEqual(q.start(a.queueId).queueId, a.queueId);
assert.strictEqual(q.advance(q.snapshot().revision).queueId, b.queueId);
const afterAdvance = q.snapshot();
assert.strictEqual(q.advance(afterAdvance.revision - 1), null);
assert.strictEqual(q.advance(afterAdvance.revision), null);

const c = q.add(item('9bZkp7q19f0'));
assert.deepStrictEqual(q.move(c.queueId, -1).items.map((x) => x.videoId), ['dQw4w9WgXcQ', '9bZkp7q19f0', 'kJQP7kiw5Fk']);
assert.deepStrictEqual(q.move(c.queueId, -99).items.map((x) => x.videoId), ['9bZkp7q19f0', 'dQw4w9WgXcQ', 'kJQP7kiw5Fk']);
assert.strictEqual(q.remove('q-999'), null);
assert.strictEqual(q.remove(b.queueId).videoId, 'kJQP7kiw5Fk');
assert.strictEqual(q.clear().items.length, 0);
assert.strictEqual(q.snapshot().currentQueueId, null);

console.log('test_youtube_karaoke_queue: OK');
