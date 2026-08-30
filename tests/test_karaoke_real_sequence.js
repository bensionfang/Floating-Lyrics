'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('../web-app/node_modules/sqlite3').verbose();
const WebSocket = require('../web-app/node_modules/ws');
const { SongLibrary } = require('../web-app/song-library');

const base = process.env.KANARIC_BASE || 'http://127.0.0.1:5790';
const wsUrl = base.replace(/^http/, 'ws');
const dbPath = process.env.KANARIC_TASK5_DB;
const fixtureDir = process.env.KANARIC_TASK5_FIXTURES;
const mp3 = path.join(fixtureDir || '', 'Sample MP3 - Demo.mp3');
const m4a = path.join(fixtureDir || '', 'Sample M4A - Demo.m4a');

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl, { origin: base });
    ws.messages = [];
    ws.on('message', raw => { try { ws.messages.push(JSON.parse(String(raw))); } catch {} });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

async function waitFor(ws, predicate, label, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const index = ws.messages.findIndex(predicate);
    if (index >= 0) return ws.messages.splice(0, index + 1).at(-1);
    await delay(100);
  }
  throw new Error(`timeout waiting for ${label}`);
}

async function importFixtures() {
  assert.ok(dbPath && fixtureDir, 'KANARIC_TASK5_DB and KANARIC_TASK5_FIXTURES are required');
  assert.equal(fs.statSync(mp3).isFile(), true);
  assert.equal(fs.statSync(m4a).isFile(), true);
  const db = new sqlite3.Database(dbPath);
  const library = new SongLibrary(db);
  await library.importSong({
    songId: 'task5-real-mp3',
    metadata: { title: 'Task 5 MP3', artist: 'Kanaric Fixture' },
    audio: { path: mp3, durationMs: 30000 },
    lyrics: { text: '[00:00.00]Task 5 MP3\n[00:10.00]central playback', durationMs: 30000 },
  });
  await library.importSong({
    songId: 'task5-real-m4a',
    metadata: { title: 'Task 5 M4A', artist: 'Kanaric Fixture' },
    audio: { path: m4a, durationMs: 15000 },
    video: { path: path.join(fixtureDir, 'missing-task5.mp4') },
    lyrics: { text: '[00:00.00]Task 5 M4A\n[00:05.00]audio only', durationMs: 15000 },
  });
  await new Promise((resolve, reject) => db.close(error => error ? reject(error) : resolve()));
}

async function main() {
  await importFixtures();
  const stage = await connect();
  const host = await connect();
  const evidence = [];
  try {
    stage.send(JSON.stringify({ type: 'karaoke_role', role: 'stage' }));
    stage.send(JSON.stringify({ type: 'karaoke_player_mode', player: 'mpv' }));
    host.send(JSON.stringify({ type: 'karaoke_role', role: 'host' }));

    let queueRevision = 0;
    host.send(JSON.stringify({ type: 'karaoke_queue_reserve', expectedRevision: queueRevision, item: {
      reservationId: 'task5-mp3', songId: 'task5-real-mp3', singer: 'Task 5', key: 0,
    }}));
    let result = await waitFor(host, m => m.type === 'karaoke_queue_result', 'MP3 reserve');
    assert.equal(result.accepted, true);
    queueRevision = result.queueRevision;

    host.send(JSON.stringify({ type: 'karaoke_queue_reserve', expectedRevision: queueRevision, item: {
      reservationId: 'task5-m4a', songId: 'task5-real-m4a', singer: 'Task 5', key: 0,
    }}));
    result = await waitFor(host, m => m.type === 'karaoke_queue_result', 'M4A reserve');
    assert.equal(result.accepted, true);
    evidence.push({ step: 'queue-projection', state: result.state.queue });

    let session = await waitFor(stage, m => m.type === 'karaoke_session'
      && m.state?.state === 'INTRO' && m.state.song?.id === 'task5-real-mp3', 'MP3 INTRO', 30000);
    const sessionId = session.state.sessionId;
    evidence.push({ step: 'mp3-loaded', state: session.state.state, song: session.state.song.id });

    const command = name => stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId, command: name }));
    command('play');
    await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'PLAYING', 'MP3 PLAYING');
    evidence.push({ step: 'mp3-play', state: 'PLAYING' });
    command('pause');
    await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'PAUSED', 'MP3 PAUSED');
    evidence.push({ step: 'mp3-pause', seconds: 30 });
    await delay(30000);
    command('play');
    await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'PLAYING', 'MP3 RESUME');
    stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId, command: 'seek', positionMs: 4097 }));
    await waitFor(stage, m => m.type === 'karaoke_player_result' && m.command === 'seek' && m.accepted, 'random seek');
    stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId, command: 'restart' }));
    await waitFor(stage, m => m.type === 'karaoke_player_result' && m.command === 'restart' && m.accepted, 'restart');
    evidence.push({ step: 'mp3-controls', actions: ['pause-30s', 'resume', 'random-seek-4097ms', 'restart'] });

    session = await waitFor(stage, m => m.type === 'karaoke_session'
      && m.state?.state === 'INTRO' && m.state.song?.id === 'task5-real-m4a', 'M4A next after EOF', 45000);
    evidence.push({ step: 'ended-next', state: session.state.state, song: session.state.song.id });
    const secondSessionId = session.state.sessionId;
    stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId: secondSessionId, command: 'play' }));
    await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'PLAYING'
      && m.state.song?.id === 'task5-real-m4a', 'M4A PLAYING');
    stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId: secondSessionId, command: 'stop' }));
    await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'ENDING', 'stop');
    stage.send(JSON.stringify({ type: 'karaoke_player_command', sessionId: secondSessionId, command: 'next' }));
    session = await waitFor(stage, m => m.type === 'karaoke_session' && m.state?.state === 'IDLE', 'final IDLE');
    evidence.push({ step: 'stop-idle', state: session.state.state });
    assert.equal(session.state.song, null);
    console.log(JSON.stringify({ sequence: 'PASS', evidence }));
  } finally {
    stage.close();
    host.close();
  }
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
