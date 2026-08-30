const assert = require('assert');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('../web-app/node_modules/ws');
const sqlite3 = require('../web-app/node_modules/sqlite3').verbose();
const { SongLibrary } = require('../web-app/song-library');
const {
  REMOTE_COMMANDS,
  KaraokeRemoteGateway,
} = require('../web-app/karaoke-remote');

let now = 1000;
let randomSeed = 0;
let session = {
  sessionId: 'session-1',
  revision: 7,
  state: 'PLAYING',
  remoteCredentials: { valid: true, epoch: 1 },
};

function makeGateway() {
  return new KaraokeRemoteGateway({
    now: () => now,
    pairingTtlMs: 100,
    tokenTtlMs: 200,
    getSession: () => session,
    random: (size) => Buffer.alloc(size, ++randomSeed),
  });
}

function pair(gateway) {
  const pairing = gateway.createPairing();
  const result = gateway.pair(pairing.code);
  assert.strictEqual(result.accepted, true);
  return result;
}

function run() {
  const gateway = makeGateway();

  assert.deepStrictEqual(gateway.authorize({
    command: 'pause',
    sessionId: session.sessionId,
    requestId: 'unpaired-1',
  }), { accepted: false, reason: 'unpaired' });

  const pairing = gateway.createPairing();
  assert.strictEqual(gateway.pair('INVALID'), null);
  now = pairing.expiresAt + 1;
  assert.strictEqual(gateway.pair(pairing.code), null);
  now = 1000;

  const first = pair(gateway);
  const second = pair(gateway);
  assert.notStrictEqual(first.token, second.token);

  assert.strictEqual(gateway.authorize({
    token: first.token,
    sessionId: session.sessionId,
    requestId: 'refresh-1',
    command: 'reconnect',
  }).accepted, true);
  assert.strictEqual(gateway.authorize({
    token: second.token,
    sessionId: session.sessionId,
    requestId: 'refresh-2',
    command: 'state_refresh',
  }).accepted, true);

  const allowed = new Set(REMOTE_COMMANDS);
  for (const command of ['search', 'reserve', 'queue_view', 'key', 'pause', 'restart', 'skip', 'stop', 'reconnect', 'state_refresh']) {
    assert.strictEqual(allowed.has(command), true, `missing allowlist command: ${command}`);
  }
  const remotePage = fs.readFileSync(path.join(__dirname, '..', 'web-app', 'remote-mobile.html'), 'utf8');
  assert.match(remotePage, /item\.lyricsStatus/);
  const rejectedCommand = gateway.authorize({
    token: first.token,
    sessionId: session.sessionId,
    requestId: 'admin-1',
    command: 'settings',
  });
  assert.deepStrictEqual(rejectedCommand, { accepted: false, reason: 'remote-command-not-allowed' });

  const replay = gateway.authorize({
    token: first.token,
    sessionId: session.sessionId,
    requestId: 'refresh-1',
    command: 'reconnect',
  });
  assert.deepStrictEqual(replay, { accepted: false, reason: 'replay' });
  assert.deepStrictEqual(gateway.authorize({
    token: first.token,
    sessionId: session.sessionId,
    requestId: 'after-replay',
    command: 'pause',
  }), { accepted: false, reason: 'unpaired' });

  const expiring = pair(gateway);
  now = expiring.expiresAt + 1;
  assert.deepStrictEqual(gateway.authorize({
    token: expiring.token,
    sessionId: session.sessionId,
    requestId: 'expired-1',
    command: 'pause',
  }), { accepted: false, reason: 'token-expired' });

  now = 1000;
  const stale = pair(gateway);
  session = { ...session, sessionId: 'session-2', revision: 8 };
  assert.deepStrictEqual(gateway.authorize({
    token: stale.token,
    sessionId: 'session-1',
    requestId: 'stale-1',
    command: 'pause',
  }), { accepted: false, reason: 'stale-session' });

  now = 1000;
  const ended = pair(gateway);
  gateway.invalidateSession('session-2');
  assert.deepStrictEqual(gateway.authorize({
    token: ended.token,
    sessionId: 'session-2',
    requestId: 'ended-1',
    command: 'pause',
  }), { accepted: false, reason: 'unpaired' });

  console.log('test_karaoke_remote: unit ok');
}

function waitForHttp(url, deadlineMs = 20000) {
  const until = Date.now() + deadlineMs;
  return (async () => {
    while (Date.now() < until) {
      try { await fetch(url); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error(`server did not start: ${url}`);
  })();
}

function connect(url, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, origin ? { origin } : undefined);
    const messages = [];
    const waiters = [];
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      messages.push(message);
      for (let index = waiters.length - 1; index >= 0; index--) {
        if (!waiters[index].predicate(message)) continue;
        const waiter = waiters.splice(index, 1)[0];
        clearTimeout(waiter.timer);
        waiter.resolve(message);
      }
    });
    ws.waitFor = (predicate, timeoutMs = 5000) => new Promise((waitResolve, waitReject) => {
      const existing = messages.find(predicate);
      if (existing) return waitResolve(existing);
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.timer === timer);
        if (index >= 0) waiters.splice(index, 1);
        waitReject(new Error(`timed out waiting for remote message; seen=${messages.map((message) => message.type + ':' + (message.requestId || '') + ':' + (message.reason || '')).join(',')}`));
      }, timeoutMs);
      waiters.push({ predicate, resolve: waitResolve, reject: waitReject, timer });
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function runSql(db, sql, params = []) {
  return new Promise((resolve, reject) => db.run(sql, params, (error) => error ? reject(error) : resolve()));
}

function closeDb(db) {
  return new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));
}

async function pairOverHttp(base, code) {
  const response = await fetch(`${base}/remote/pair`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return { status: response.status, body: await response.json() };
}

async function testLiveRemoteBoundary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-remote-test-'));
  const dbPath = path.join(root, 'remote.db');
  const audioPath = path.join(root, 'song.mp3');
  fs.writeFileSync(audioPath, 'fixture');
  const seedDb = new sqlite3.Database(dbPath);
  const library = new SongLibrary(seedDb);
  await library.ready;
  await library.importSong({
    songId: 'local-1', metadata: { title: 'Local Song', artist: 'Singer' },
    audio: { path: audioPath, durationMs: 180000 }, lyrics: { text: '[00:01.00]la' },
  });
  await closeDb(seedDb);

  const adminPort = 5740;
  const remotePort = 5741;
  const admin = `http://localhost:${adminPort}`;
  const remote = `http://localhost:${remotePort}`;
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'web-app'),
    env: {
      ...process.env, PORT: String(adminPort), REMOTE_PORT: String(remotePort), REMOTE_HOST: 'localhost',
      REMOTE_ORIGIN: remote, DB_PATH: dbPath, DATA_DIR: root,
      LYRICS_SETTINGS_PATH: path.join(root, 'settings.json'),
    },
    stdio: 'ignore',
  });
  const clients = [];
  try {
    await Promise.all([waitForHttp(`${admin}/host`), waitForHttp(`${remote}/remote/health`)]);
    assert.match(await (await fetch(`${remote}/mobile/karaoke/`)).text(), /Karaoke Remote/);
    assert.equal((await fetch(`${remote}/api/karaoke/library/scan`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${remote}/api/karaoke/library/scan/unknown/import`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${remote}/api/karaoke/library/search?q=Local`)).status, 404);
    assert.equal((await fetch(`${remote}/api/settings`)).status, 404);
    assert.equal((await fetch(`${remote}/api/db-clear`, { method: 'POST' })).status, 404);
    assert.equal((await fetch(`${admin}/remote/health`)).status, 404);
    assert.equal((await fetch(`${admin}/mobile/karaoke/`)).status, 404);
    const adminSearch = await (await fetch(`${admin}/api/karaoke/library/search?q=Local`)).json();
    assert.deepStrictEqual(adminSearch.items[0], {
      songId: 'local-1', title: 'Local Song', artist: 'Singer', album: null, variant: 'studio',
      lyricsStatus: 'ready',
    });

    const stage = await connect(`ws://localhost:${adminPort}`, admin);
    const host = await connect(`ws://localhost:${adminPort}`, admin);
    clients.push(stage, host);
    stage.send(JSON.stringify({ type: 'karaoke_role', role: 'stage' }));
    host.send(JSON.stringify({ type: 'karaoke_role', role: 'host' }));
    stage.send(JSON.stringify({
      type: 'karaoke_session_transition', sourceState: 'IDLE', targetState: 'PREPARING',
      details: { event: 'start', song: { id: 'local-1', title: 'Local Song', artist: 'Singer', durationMs: 180000 } },
    }));
    const started = await stage.waitFor((message) => message.type === 'karaoke_session_result' && message.accepted);
    const sessionId = started.state.sessionId;

    const unpaired = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(unpaired);
    unpaired.send(JSON.stringify({ type: 'remote_command', command: 'pause', sessionId, requestId: 'unpaired' }));
    assert.equal((await unpaired.waitFor((message) => message.type === 'remote_error')).reason, 'unpaired');
    assert.equal((await pairOverHttp(remote, 'INVALID')).status, 401);

    host.send(JSON.stringify({ type: 'karaoke_remote_pairing_create' }));
    const pairingOne = await host.waitFor((message) => message.type === 'karaoke_remote_pairing' && message.accepted);
    const first = await pairOverHttp(remote, pairingOne.code);
    assert.equal(first.body.accepted, true);
    const secondPairing = (() => {
      host.send(JSON.stringify({ type: 'karaoke_remote_pairing_create' }));
      return host.waitFor((message) => message.type === 'karaoke_remote_pairing' && message.code !== pairingOne.code);
    })();
    const pairingTwo = await secondPairing;
    const second = await pairOverHttp(remote, pairingTwo.code);
    assert.notEqual(first.body.token, second.body.token);

    const remoteOne = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    const remoteTwo = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(remoteOne, remoteTwo);
    remoteOne.send(JSON.stringify({ type: 'remote_auth', token: first.body.token, sessionId, requestId: 'auth-one' }));
    remoteTwo.send(JSON.stringify({ type: 'remote_auth', token: second.body.token, sessionId, requestId: 'auth-two' }));
    await remoteOne.waitFor((message) => message.type === 'remote_state' && message.accepted);
    await remoteTwo.waitFor((message) => message.type === 'remote_state' && message.accepted);

    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'admin-route', command: 'settings' }));
    assert.equal((await remoteOne.waitFor((message) => message.requestId === 'admin-route')).reason, 'remote-command-not-allowed');
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'search', command: 'search', query: 'Local' }));
    const search = await remoteOne.waitFor((message) => message.requestId === 'search');
    assert.equal(search.accepted, true);
    assert.deepStrictEqual(search.result[0], {
      songId: 'local-1', title: 'Local Song', artist: 'Singer', album: null, variant: 'studio',
      lyricsStatus: 'ready',
    });

    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'queue-view', command: 'queue_view' }));
    assert.equal((await remoteOne.waitFor((message) => message.requestId === 'queue-view')).state.queue.revision, 0);
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'stale-reserve', command: 'reserve', expectedQueueRevision: 99, item: { songId: 'local-1' } }));
    assert.equal((await remoteOne.waitFor((message) => message.requestId === 'stale-reserve')).reason, 'stale-queue-revision');
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'reserve', command: 'reserve', expectedQueueRevision: 0, item: { songId: 'local-1', singer: 'mobile' } }));
    const reserved = await remoteOne.waitFor((message) => message.requestId === 'reserve');
    assert.equal(reserved.accepted, true);
    assert.equal(reserved.state.queue.revision, 1);
    assert.equal(reserved.state.queue.currentQueueId, reserved.state.queue.items[0].queueId);
    assert.equal(reserved.state.song.id, reserved.state.queue.items[0].songId);
    assert.equal(reserved.state.state, 'PREPARING');
    assert.equal(reserved.state.queue.items[0].title, 'Local Song');
    assert.equal(reserved.state.queue.items[0].artist, 'Singer');
    assert.equal(reserved.state.queue.items[0].singer, 'mobile');
    assert.equal(reserved.state.queue.items[0].lyricsStatus, 'ready');
    remoteTwo.send(JSON.stringify({ type: 'remote_command', token: second.body.token, sessionId, requestId: 'key', command: 'key', queueId: reserved.state.queue.currentQueueId, key: 2, expectedQueueRevision: 1 }));
    const keyed = await remoteTwo.waitFor((message) => message.requestId === 'key');
    assert.equal(keyed.accepted, true);
    assert.equal(keyed.state.queue.revision, 2);
    assert.equal(keyed.state.queue.items[0].title, 'Local Song');
    assert.equal(keyed.state.queue.items[0].artist, 'Singer');
    assert.equal(keyed.state.queue.items[0].lyricsStatus, 'ready');

    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'pause', command: 'pause' }));
    await stage.waitFor((message) => message.type === 'karaoke_host_command' && message.command === 'pause');
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'restart', command: 'restart' }));
    await stage.waitFor((message) => message.type === 'karaoke_host_command' && message.command === 'restart');
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'skip', command: 'skip' }));
    await stage.waitFor((message) => message.type === 'karaoke_host_command' && message.command === 'next');
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'reconnect', command: 'reconnect' }));
    assert.equal((await remoteOne.waitFor((message) => message.requestId === 'reconnect')).accepted, true);

    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'replay', command: 'state_refresh' }));
    await remoteOne.waitFor((message) => message.requestId === 'replay' && message.accepted);
    remoteOne.send(JSON.stringify({ type: 'remote_command', token: first.body.token, sessionId, requestId: 'replay', command: 'state_refresh' }));
    assert.equal((await remoteOne.waitFor((message) => message.requestId === 'replay' && message.accepted === false)).reason, 'replay');

    host.send(JSON.stringify({ type: 'karaoke_remote_pairing_create' }));
    const stopPairing = await host.waitFor((message) => message.type === 'karaoke_remote_pairing'
      && message.accepted && message.code !== pairingOne.code && message.code !== pairingTwo.code);
    const stopRemote = await pairOverHttp(remote, stopPairing.code);
    assert.equal(stopRemote.body.accepted, true);
    const stopClient = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(stopClient);
    stopClient.send(JSON.stringify({ type: 'remote_auth', token: stopRemote.body.token, sessionId, requestId: 'stop-auth' }));
    await stopClient.waitFor((message) => message.type === 'remote_state' && message.accepted);
    stopClient.send(JSON.stringify({ type: 'remote_command', token: stopRemote.body.token, sessionId, requestId: 'stop', command: 'stop' }));
    await stage.waitFor((message) => message.type === 'karaoke_host_command' && message.command === 'stop');
    const invalidated = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(invalidated);
    invalidated.send(JSON.stringify({ type: 'remote_command', token: stopRemote.body.token, sessionId, requestId: 'after-stop', command: 'pause' }));
    assert.equal((await invalidated.waitFor((message) => message.requestId === 'after-stop')).reason, 'unpaired');

    host.send(JSON.stringify({ type: 'karaoke_remote_pairing_create' }));
    const endPairing = await host.waitFor((message) => message.type === 'karaoke_remote_pairing'
      && message.accepted && message.code !== pairingOne.code && message.code !== pairingTwo.code
      && message.code !== stopPairing.code);
    const endRemote = await pairOverHttp(remote, endPairing.code);
    assert.equal(endRemote.body.accepted, true);
    const endClient = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(endClient);
    endClient.send(JSON.stringify({ type: 'remote_auth', token: endRemote.body.token, sessionId, requestId: 'end-auth' }));
    await endClient.waitFor((message) => message.type === 'remote_state' && message.accepted);

    stage.send(JSON.stringify({ type: 'karaoke_session_transition', sourceState: 'PREPARING', targetState: 'ENDING', details: { event: 'skip' } }));
    await stage.waitFor((message) => message.type === 'karaoke_session_result' && message.accepted && message.state.state === 'ENDING');
    stage.send(JSON.stringify({ type: 'karaoke_session_transition', sourceState: 'ENDING', targetState: 'TRANSITION', details: { event: 'transition', hasNext: false } }));
    await stage.waitFor((message) => message.type === 'karaoke_session_result' && message.accepted && message.state.state === 'TRANSITION');
    stage.send(JSON.stringify({ type: 'karaoke_session_transition', sourceState: 'TRANSITION', targetState: 'IDLE', details: { event: 'idle' } }));
    await stage.waitFor((message) => message.type === 'karaoke_session_result' && message.accepted && message.state.state === 'IDLE');
    const afterEnd = await connect(`ws://localhost:${remotePort}/remote/ws`, remote);
    clients.push(afterEnd);
    afterEnd.send(JSON.stringify({ type: 'remote_command', token: endRemote.body.token, sessionId, requestId: 'after-end', command: 'pause' }));
    assert.equal((await afterEnd.waitFor((message) => message.requestId === 'after-end')).reason, 'unpaired');
    console.log('test_karaoke_remote: live boundary OK');
  } finally {
    clients.forEach((client) => client.close());
    server.kill();
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
}

(async () => {
  run();
  await testLiveRemoteBoundary();
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
