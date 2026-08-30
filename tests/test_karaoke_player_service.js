const assert = require('node:assert/strict');
const { createKaraokePlayerService } = require('../web-app/karaoke-player-service');

class FakePlayer {
  constructor() {
    this.calls = [];
    this.state = 'IDLE';
    this.positionMs = 0;
    this.durationMs = 1234;
    this.listeners = new Set();
  }

  on(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(type, event) { this.listeners.forEach(listener => listener({ type, ...event })); }

  async load(file) {
    this.calls.push(['load', file]);
    this.state = 'INTRO';
    this.emit('event', { type: 'load', positionMs: 0, durationMs: this.durationMs });
  }

  async play() { this.calls.push(['play']); this.state = 'PLAYING'; }
  async pause() { this.calls.push(['pause']); this.state = 'PAUSED'; }
  async seek(positionMs) { this.calls.push(['seek', positionMs]); this.positionMs = positionMs; }
  async restart() { this.calls.push(['restart']); this.positionMs = 0; this.state = 'PLAYING'; }
  async stop() { this.calls.push(['stop']); this.state = 'IDLE'; }
  async setKey(semitones) { this.calls.push(['setKey', semitones]); }
  async getOutputDevices() {
    this.calls.push(['getOutputDevices']);
    return [{ name: 'auto' }, { name: 'speaker-b', description: 'Speaker B' }];
  }
  async setOutputDevice(deviceId) {
    this.calls.push(['setOutputDevice', deviceId]);
    return { supported: true, deviceId, readback: deviceId, selected: true };
  }
  async dispose() { this.calls.push(['dispose']); }

  snapshot() {
    return {
      state: this.state,
      positionMs: this.positionMs,
      durationMs: this.durationMs,
      output: { requested: 'auto', active: 'auto', verified: true, degraded: false },
    };
  }
}

async function main() {
  const player = new FakePlayer();
  const events = [];
  const service = createKaraokePlayerService({
    library: {
      async loadSong(songId) {
        assert.equal(songId, 'song-1');
        return {
          songId,
          playable: true,
          title: 'Test Song',
          artist: 'Test Artist',
          audio: { path: 'C:\\songs\\test.mp3', status: 'ready', durationMs: 1234 },
        };
      },
    },
    playerFactory: () => player,
    session: { snapshot: () => ({ sessionId: 'session-1' }) },
    queue: {},
  });
  service.on(event => events.push(event));

  const loaded = await service.loadSong('song-1', { sessionId: 'session-1', key: -2 });
  assert.equal(loaded.songId, 'song-1');
  assert.deepEqual(player.calls.slice(0, 2), [
    ['load', { id: 'song-1', src: 'C:\\songs\\test.mp3', durationMs: 1234, title: 'Test Song', artist: 'Test Artist' }],
    ['setKey', -2],
  ]);
  await service.command({ sessionId: 'session-1', command: 'play' });
  await service.command({ sessionId: 'session-1', command: 'pause' });
  await service.command({ sessionId: 'session-1', command: 'seek', positionMs: 321 });
  await service.command({ sessionId: 'session-1', command: 'key', semitones: 3 });
  assert.deepEqual(player.calls.slice(2), [['play'], ['pause'], ['seek', 321], ['setKey', 3]]);

  player.emit('event', { type: 'ended', positionMs: 1234, durationMs: 1234 });
  assert.equal(events.at(-1).type, 'ended');
  assert.equal(events.at(-1).sessionId, 'session-1');
  assert.equal(service.snapshot().songId, 'song-1');

  assert.deepEqual(await service.listOutputDevices(), [{ name: 'auto' }, { name: 'speaker-b', description: 'Speaker B' }]);
  assert.deepEqual(await service.setOutputDevice('speaker-b'), {
    requested: 'speaker-b', active: 'speaker-b', verified: true, degraded: false,
  });
  player.emit('output', { output: { requested: 'speaker-b', active: 'auto', verified: false, degraded: true } });
  assert.deepEqual(service.snapshot().output, {
    requested: 'speaker-b', active: 'auto', verified: false, degraded: true,
  });

  await assert.rejects(
    () => service.command({ sessionId: 'stale', command: 'play' }),
    error => error.code === 'stale-session',
  );
  await assert.rejects(
    () => service.loadSong('song-1', { sessionId: 'session-1', key: 13 }),
    error => error.code === 'invalid-key',
  );

  await service.dispose();
  assert.equal(player.calls.at(-1)[0], 'dispose');
  console.log('test_karaoke_player_service: OK');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
