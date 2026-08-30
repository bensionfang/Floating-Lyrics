const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parsePairingString,
  normalizeSocketCommand,
  createRevisionTracker,
  buildYouTubeWatchUrl,
  ensureYouTubeTab,
} = require('../src/service-worker.js');

test('parsePairingString accepts exact localhost pairing format', () => {
  assert.deepEqual(parsePairingString('http://127.0.0.1:5720#abc_DEF-123'), {
    baseUrl: 'http://127.0.0.1:5720',
    token: 'abc_DEF-123',
    wsUrl: 'ws://127.0.0.1:5720',
  });
});

test('parsePairingString rejects hostname https path and invalid tokens', () => {
  assert.equal(parsePairingString('http://localhost:5720#abc_DEF-123'), null);
  assert.equal(parsePairingString('https://127.0.0.1:5720#abc_DEF-123'), null);
  assert.equal(parsePairingString('http://127.0.0.1:0#abc_DEF-123'), null);
  assert.equal(parsePairingString('http://127.0.0.1:65536#abc_DEF-123'), null);
  assert.equal(parsePairingString('http://127.0.0.1:5720/watch#abc_DEF-123'), null);
  assert.equal(parsePairingString('http://127.0.0.1:5720#abc/DEF'), null);
  assert.equal(parsePairingString('http://127.0.0.1:5720#abc=DEF'), null);
});

test('normalizeSocketCommand maps supported commands to tab actions', () => {
  assert.deepEqual(
    normalizeSocketCommand({ type: 'youtube_karaoke_command', command: { action: 'play', revision: 3 } }),
    { action: 'play', revision: 3 }
  );
  assert.deepEqual(
    normalizeSocketCommand({ type: 'youtube_karaoke_command', command: { action: 'seek', revision: 4, seconds: 9.5 } }),
    { action: 'seek', revision: 4, positionMs: 9500 }
  );
  assert.deepEqual(
    normalizeSocketCommand({
      type: 'youtube_karaoke_command',
      command: { action: 'load', videoId: 'dQw4w9WgXcQ', positionMs: 1200 },
    }),
    { action: 'load', videoId: 'dQw4w9WgXcQ', positionMs: 1200 }
  );
});

test('createRevisionTracker increments only on load', () => {
  const tracker = createRevisionTracker();
  assert.equal(tracker.current(), 0);
  assert.equal(tracker.apply({ action: 'play', revision: 3 }), 0);
  assert.equal(tracker.apply({ action: 'load', videoId: 'dQw4w9WgXcQ', positionMs: 0 }), 1);
  assert.equal(tracker.apply({ action: 'seek', revision: 9, positionMs: 1000 }), 1);
  assert.equal(tracker.apply({ action: 'load', videoId: 'kJQP7kiw5Fk', positionMs: 0 }), 2);
  assert.equal(tracker.current(), 2);
});

test('load URL preserves the requested start position', () => {
  assert.equal(buildYouTubeWatchUrl('dQw4w9WgXcQ', 1250), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1.25s');
});

test('ensureYouTubeTab reuses only the extension-owned tab', async () => {
  const calls = [];
  const api = {
    storage: { local: {
      get: async () => ({ youtubeTabId: 17 }),
      set: async (value) => calls.push(['set', value]),
    } },
    tabs: {
      get: async (id) => ({ id, url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }),
      update: async (id, value) => calls.push(['update', id, value]),
      create: async () => { throw new Error('must not create when owned tab exists'); },
    },
  };
  const tab = await ensureYouTubeTab(api);
  assert.equal(tab.id, 17);
  assert.deepStrictEqual(calls, [['update', 17, { active: true }]]);
});
