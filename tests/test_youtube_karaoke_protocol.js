const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeExtensionState,
  normalizeKaraokeCommand,
  readOrCreateExtensionToken,
} = require('../web-app/youtube-karaoke-protocol.js');

{
  const state = normalizeExtensionState({
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: 'RickAstleyVEVO',
    state: 'playing',
    positionMs: 12500,
    durationMs: 245100,
    keySemitones: -2,
    error: null,
    commandId: 12,
  });
  assert.deepStrictEqual(state, {
    revision: 7,
    videoId: 'dQw4w9WgXcQ',
    title: 'Never Gonna Give You Up',
    channel: 'RickAstleyVEVO',
    state: 'playing',
    positionMs: 12500,
    durationMs: 245100,
    keySemitones: -2,
    error: null,
    commandId: 12,
  });
}

{
  assert.strictEqual(normalizeExtensionState({ videoId: 'bad', state: 'playing', positionMs: 0, durationMs: 1, keySemitones: 0, revision: 1 }), null);
  assert.strictEqual(normalizeExtensionState({ videoId: 'dQw4w9WgXcQ', state: 'playing', positionMs: -1, durationMs: 1, keySemitones: 0, revision: 1 }), null);
  assert.strictEqual(normalizeExtensionState({ videoId: 'dQw4w9WgXcQ', state: 'playing', positionMs: 0.5, durationMs: 1, keySemitones: 0, revision: 1 }), null);
  assert.strictEqual(normalizeExtensionState({ videoId: 'dQw4w9WgXcQ', state: 'playing', positionMs: 0, durationMs: 1, keySemitones: 7, revision: 1 }), null);
  assert.strictEqual(normalizeExtensionState({ videoId: 'dQw4w9WgXcQ', state: 'unknown', positionMs: 0, durationMs: 1, keySemitones: 0, revision: 1 }), null);
  assert.strictEqual(normalizeExtensionState({ videoId: 'dQw4w9WgXcQ', state: 'playing', positionMs: 0, durationMs: 1, keySemitones: 0, revision: 1, title: 'x'.repeat(201) }), null);
}

{
  assert.deepStrictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'load', videoId: 'dQw4w9WgXcQ' }), {
    commandId: 1, action: 'load', videoId: 'dQw4w9WgXcQ', positionMs: 0,
  });
  assert.deepStrictEqual(normalizeKaraokeCommand({ commandId: 2, action: 'play' }), { commandId: 2, action: 'play' });
  assert.deepStrictEqual(normalizeKaraokeCommand({ commandId: 3, action: 'seek', positionMs: 9500 }), {
    commandId: 3, action: 'seek', positionMs: 9500,
  });
  assert.deepStrictEqual(normalizeKaraokeCommand({ commandId: 4, action: 'set_key', semitones: -6 }), {
    commandId: 4, action: 'set_key', semitones: -6,
  });
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'load', videoId: 'bad' }), null);
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'set_key', semitones: 7 }), null);
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'seek', positionMs: -1 }), null);
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'bogus' }), null);
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1.5, action: 'play' }), null);
  assert.strictEqual(normalizeKaraokeCommand({ commandId: 1, action: 'play', extra: true }), null);
}

{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-token-'));
  const randomBytes = (n) => Buffer.alloc(n, 7);
  const first = readOrCreateExtensionToken({ dataDir: tmp, randomBytes });
  const second = readOrCreateExtensionToken({ dataDir: tmp, randomBytes: () => Buffer.alloc(32, 9) });
  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(first, second);
  assert.strictEqual(fs.readFileSync(path.join(tmp, 'youtube-karaoke-token'), 'utf8'), first);
}

console.log('test_youtube_karaoke_protocol: OK');
