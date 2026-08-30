'use strict';

const assert = require('node:assert/strict');
const { KaraokeSession } = require('../web-app/karaoke-session');
const { createKaraokeStageController } = require('../web-app/karaoke-stage-controller');

function song(id) {
  return {
    songId: id,
    playable: true,
    title: `Title ${id}`,
    artist: 'Artist',
    audio: { path: `C:\\songs\\${id}.mp3`, status: 'ready', durationMs: 1000 },
  };
}

async function main() {
  const session = new KaraokeSession({ idFactory: () => 'session-1' });
  const queue = {
    state: {
      revision: 4,
      currentQueueId: 'q1',
      hasNext: true,
      items: [
        { queueId: 'q1', songId: 'song-1', key: -2, status: 'current' },
        { queueId: 'q2', songId: 'song-2', key: 1, status: 'queued' },
      ],
    },
    async skip(expectedRevision) {
      assert.equal(expectedRevision, this.state.revision);
      this.state = this.state.currentQueueId === 'q1'
        ? { ...this.state, revision: 5, currentQueueId: 'q2', hasNext: false,
          items: [{ ...this.state.items[0], status: 'played' }, { ...this.state.items[1], status: 'current' }] }
        : { ...this.state, revision: 6, currentQueueId: null, hasNext: false,
          items: this.state.items.map(item => ({ ...item, status: 'played' })) };
      return { accepted: true, state: this.state };
    },
  };
  const players = [];
  const listeners = new Set();
  const playerService = {
    snapshot: () => ({ songId: players.at(-1)?.songId || null }),
    on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async loadSong(songId, options) {
      players.push({ songId, options });
      listeners.forEach(listener => listener({ type: 'load', sessionId: options.sessionId, revision: players.length, order: 0, positionMs: 0, durationMs: 1000 }));
    },
    async command({ sessionId, command }) {
      listeners.forEach(listener => listener({ type: command === 'play' ? 'play' : command, sessionId, revision: players.length, order: 1, positionMs: command === 'play' ? 0 : 1000, durationMs: 1000 }));
      return { accepted: true };
    },
  };
  const controller = createKaraokeStageController({
    session,
    queue,
    library: { loadSong: async id => song(id) },
    playerService,
  });

  await controller.reconcile(queue.state);
  assert.equal(session.snapshot().state, 'INTRO');
  assert.deepEqual(players[0], { songId: 'song-1', options: { sessionId: 'session-1', key: -2 } });
  await controller.command({ sessionId: 'session-1', command: 'play' });
  assert.equal(session.snapshot().state, 'PLAYING');

  await controller.playerEvent({ type: 'ended', sessionId: 'session-1', revision: 3, order: 2, positionMs: 1000, durationMs: 1000 });
  assert.equal(session.snapshot().state, 'INTRO');
  assert.equal(session.snapshot().song.id, 'song-2');
  assert.equal(players.at(-1).songId, 'song-2');

  await controller.command({ sessionId: 'session-1', command: 'play' });
  await controller.playerEvent({ type: 'ended', sessionId: 'session-1', revision: 5, order: 2, positionMs: 1000, durationMs: 1000 });
  assert.equal(session.snapshot().state, 'IDLE');
  assert.equal(session.snapshot().sessionId, null);
  assert.equal((await controller.command({ sessionId: 'stale', command: 'play' })).accepted, false);
  console.log('test_karaoke_stage_mpv: OK');
}

main().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
