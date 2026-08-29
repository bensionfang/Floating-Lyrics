'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sqlite3 = require('../web-app/node_modules/sqlite3').verbose();
const {
    KaraokeQueue,
} = require('../web-app/karaoke-queue');
const {
    KaraokeSession,
    SESSION_ROLES,
    handleKaraokeMessage,
    makeKaraokeMessage,
    projectKaraokeState,
} = require('../web-app/karaoke-session');

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
        if (error) reject(error); else resolve(this);
    });
});

const get = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

const close = (db) => new Promise((resolve, reject) => db.close((error) => error ? reject(error) : resolve()));

function song(songId) {
    return { id: songId, title: `Title ${songId}`, artist: 'Artist', durationMs: 180000 };
}

function makeResolver() {
    return async (songId) => song(songId);
}

async function makeQueue(db = new sqlite3.Database(':memory:')) {
    let id = 0;
    const queue = new KaraokeQueue(db, {
        idFactory: () => `queue-${++id}`,
        reservationIdFactory: () => `reservation-${++id}`,
        songResolver: makeResolver(),
    });
    await queue.ready;
    return { db, queue };
}

async function testQueueShapeAndOrdering() {
    const { db, queue } = await makeQueue();
    const first = await queue.reserve({ songId: 'song-1', singerId: 'alice', singer: 'Alice', key: -2 });
    assert.equal(first.accepted, true);
    for (let i = 2; i <= 100; i++) {
        assert.equal((await queue.reserve({ songId: `song-${i}`, singerId: `singer-${i}` })).accepted, true);
    }
    const state = await queue.snapshot();
    assert.equal(state.items.length, 100);
    assert.equal(state.items[0].queueId, first.item.queueId);
    assert.equal(state.items[0].status, 'current');
    assert.deepEqual(state.items.map((item) => item.createdOrder), Array.from({ length: 100 }, (_, i) => i + 1));
    assert.equal(state.items[0].key, -2);
    await close(db);
}

async function testDuplicateReservationsAndInsertNext() {
    const { db, queue } = await makeQueue();
    const first = await queue.reserve({ songId: 'same-song', singerId: 'a', key: -1 });
    const second = await queue.reserve({ songId: 'same-song', singerId: 'b', key: 3 });
    assert.notEqual(first.item.queueId, second.item.queueId);
    assert.notEqual(first.item.reservationId, second.item.reservationId);
    assert.equal(first.item.songId, second.item.songId);
    assert.equal(first.item.key, -1);
    assert.equal(second.item.key, 3);

    const inserted = await queue.insertNext({ songId: 'next-song', singerId: 'c', key: 1 });
    const state = await queue.snapshot();
    assert.equal(inserted.accepted, true);
    assert.deepEqual(state.items.map((item) => item.songId), ['same-song', 'next-song', 'same-song']);
    assert.equal(state.items[1].status, 'queued');
    await close(db);
}

async function testConcurrentRevisionGuard() {
    const { db, queue } = await makeQueue();
    const revision = (await queue.snapshot()).revision;
    const results = await Promise.all([
        queue.reserve({ songId: 'song-a', singerId: 'a' }, revision),
        queue.reserve({ songId: 'song-b', singerId: 'b' }, revision),
    ]);
    assert.equal(results.filter((result) => result.accepted).length, 1);
    assert.equal(results.filter((result) => result.reason === 'stale-queue-revision').length, 1);
    await close(db);
}

async function testReorderRemoveRaceAndStaleMutation() {
    const { db, queue } = await makeQueue();
    const one = await queue.reserve({ songId: 'one', singerId: '1' });
    const two = await queue.reserve({ songId: 'two', singerId: '2' });
    const three = await queue.reserve({ songId: 'three', singerId: '3' });
    const revision = (await queue.snapshot()).revision;
    const [reordered, removed] = await Promise.all([
        queue.reorder(three.item.queueId, 1, revision),
        queue.remove(two.item.queueId, revision),
    ]);
    assert.equal(reordered.accepted !== removed.accepted, true);
    const state = await queue.snapshot();
    assert.equal(state.revision, revision + 1);
    assert.equal((await queue.remove(one.item.queueId, revision)).accepted, false);
    assert.equal((await queue.remove(one.item.queueId, state.revision)).accepted, true);
    assert.equal(state.items.some((item) => item.queueId === one.item.queueId), true);
    await close(db);
}

async function testCurrentRemovalSkipAndSessionReconciliation() {
    const { db, queue } = await makeQueue();
    const one = await queue.reserve({ songId: 'one', singerId: '1' });
    const two = await queue.reserve({ songId: 'two', singerId: '2' });
    const three = await queue.reserve({ songId: 'three', singerId: '3' });
    const session = new KaraokeSession({ idFactory: () => 'session-1' });
    const initial = await queue.snapshot();
    assert.equal(session.reconcileQueue(initial, song('one')).accepted, true);
    assert.equal(session.snapshot().song.id, 'one');
    assert.equal(session.start(song('one')).accepted, true);
    assert.equal(session.transition('PREPARING', 'INTRO').accepted, true);
    assert.equal(session.transition('INTRO', 'PLAYING').accepted, true);

    const skipped = await queue.skip(initial.revision);
    assert.equal(skipped.accepted, true);
    assert.equal(skipped.state.currentQueueId, two.item.queueId);
    assert.equal(skipped.state.items.find((item) => item.queueId === two.item.queueId).status, 'current');
    assert.equal(session.reconcileQueue(skipped.state, song('two')).accepted, true);
    assert.equal(session.snapshot().state, 'PREPARING');
    assert.equal(session.snapshot().song.id, 'two');

    const removed = await queue.remove(skipped.state.currentQueueId, skipped.state.revision);
    assert.equal(removed.accepted, true);
    assert.equal(removed.state.currentQueueId, three.item.queueId);
    await close(db);
}

async function testPersistenceAndLegacyCacheReadability() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-queue-'));
    const dbPath = path.join(root, 'queue.db');
    let db = new sqlite3.Database(dbPath);
    await run(db, 'CREATE TABLE cache (artist TEXT, title TEXT, lyrics TEXT, PRIMARY KEY (artist, title))');
    await run(db, 'INSERT INTO cache VALUES (?, ?, ?)', ['artist', 'title', '[00:01.00]lyrics']);
    const first = await makeQueue(db);
    await first.queue.reserve({ songId: 'song-1', singerId: 'singer-1', key: 2 });
    const before = await first.queue.snapshot();
    await close(db);
    db = new sqlite3.Database(dbPath);
    const second = await makeQueue(db);
    const after = await second.queue.snapshot();
    assert.deepEqual(after, before);
    assert.deepEqual(await get(db, 'SELECT lyrics FROM cache WHERE artist=? AND title=?', ['artist', 'title']), {
        lyrics: '[00:01.00]lyrics',
    });
    await close(db);
    fs.rmSync(root, { recursive: true, force: true });
}

async function testProjectionConsistencyAndStaleRejection() {
    const { db, queue } = await makeQueue();
    await queue.reserve({ songId: 'song-1', singerId: 'singer-1' });
    const canonicalQueue = await queue.snapshot();
    const session = new KaraokeSession({ idFactory: () => 'session-1' });
    session.reconcileQueue(canonicalQueue, song('song-1'));
    const canonical = session.snapshot();
    const withoutRole = ({ role, ...state }) => state;
    const projections = SESSION_ROLES.map((role) => projectKaraokeState(canonical, role));
    assert.deepEqual(withoutRole(projections[0]), withoutRole(projections[1]));
    assert.deepEqual(withoutRole(projections[1]), withoutRole(projections[2]));
    const reconnect = makeKaraokeMessage(canonical, 'test-client');
    assert.deepEqual(reconnect.state, projections[2]);
    assert.equal(reconnect.revision, canonical.revision);
    await close(db);
}

async function testQueueProtocolAdapter() {
    const { db, queue } = await makeQueue();
    const session = new KaraokeSession({ idFactory: () => 'session-1' });
    const result = await handleKaraokeMessage(session, {
        type: 'karaoke_queue_reserve',
        item: { songId: 'song-1', singerId: 'singer-1' },
    }, queue);
    assert.equal(result.accepted, true);
    assert.equal(result.state.currentQueueId, result.item.queueId);
    await close(db);
}

async function testKeyRevisionGuard() {
    const { db, queue } = await makeQueue();
    const reserved = await queue.reserve({ songId: 'song-1', singerId: 'singer-1' });
    const changed = await queue.setKey(reserved.item.queueId, 3, reserved.state.revision);
    assert.equal(changed.accepted, true);
    assert.equal(changed.state.items[0].key, 3);
    assert.equal((await queue.setKey(reserved.item.queueId, 4, reserved.state.revision)).reason, 'stale-queue-revision');
    assert.equal((await queue.setKey(reserved.item.queueId, 7, changed.state.revision)).reason, 'invalid-key');
    await close(db);
}

async function waitForHttp(url, deadlineMs = 15000) {
    const until = Date.now() + deadlineMs;
    while (Date.now() < until) {
        try { await fetch(url); return; } catch { await new Promise((resolve) => setTimeout(resolve, 100)); }
    }
    throw new Error(`server did not start: ${url}`);
}

function connectQueueClient(WebSocket, url, origin) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { origin });
        const messages = [];
        const waiters = [];
        ws.on('message', (raw) => {
            const message = JSON.parse(raw.toString());
            messages.push(message);
            for (let i = waiters.length - 1; i >= 0; i--) {
                if (waiters[i].predicate(message)) {
                    const waiter = waiters.splice(i, 1)[0];
                    waiter.resolve(message);
                }
            }
        });
        ws.once('open', () => resolve({
            ws,
            wait: (predicate) => {
                const existing = messages.find(predicate);
                if (existing) return Promise.resolve(existing);
                return new Promise((waitResolve, waitReject) => {
                    const timer = setTimeout(() => {
                        const index = waiters.findIndex((waiter) => waiter.resolve === waitResolve);
                        if (index >= 0) waiters.splice(index, 1);
                        waitReject(new Error('timed out waiting for WebSocket message'));
                    }, 5000);
                    waiters.push({ predicate, resolve: (value) => { clearTimeout(timer); waitResolve(value); }, reject: waitReject });
                });
            },
        }));
        ws.once('error', reject);
    });
}

async function testServerQueueProjection() {
    const WebSocket = require('../web-app/node_modules/ws');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-queue-server-'));
    const dbPath = path.join(root, 'server.db');
    let db = new sqlite3.Database(dbPath);
    await run(db, `CREATE TABLE songs (
        song_id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
        album TEXT, variant TEXT NOT NULL DEFAULT 'studio')`);
    await run(db, `CREATE TABLE song_audio_assets (
        song_id TEXT PRIMARY KEY, path TEXT, fingerprint TEXT, duration_ms INTEGER,
        status TEXT NOT NULL, error TEXT)`);
    await run(db, `CREATE TABLE song_search_index (
        song_id TEXT PRIMARY KEY, title TEXT NOT NULL, artist TEXT NOT NULL,
        aliases TEXT NOT NULL DEFAULT '', kana TEXT NOT NULL DEFAULT '', romaji TEXT NOT NULL DEFAULT '')`);
    await run(db, 'INSERT INTO songs (song_id, title, artist) VALUES (?, ?, ?)', ['local-1', 'Local Song', 'Singer']);
    await run(db, 'INSERT INTO song_audio_assets (song_id, status, duration_ms) VALUES (?, ?, ?)', ['local-1', 'ready', 180000]);
    await run(db, 'INSERT INTO song_search_index (song_id, title, artist) VALUES (?, ?, ?)', ['local-1', 'local song', 'singer']);
    await run(db, 'INSERT INTO songs (song_id, title, artist) VALUES (?, ?, ?)', ['local-2', 'Next Song', 'Singer']);
    await run(db, 'INSERT INTO song_audio_assets (song_id, status, duration_ms) VALUES (?, ?, ?)', ['local-2', 'ready', 181000]);
    await run(db, 'INSERT INTO song_search_index (song_id, title, artist) VALUES (?, ?, ?)', ['local-2', 'next song', 'singer']);
    await close(db);

    const port = 5733;
    const server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..', 'web-app'),
        env: { ...process.env, PORT: String(port), DB_PATH: dbPath, DATA_DIR: root,
            LYRICS_SETTINGS_PATH: path.join(root, 'settings.json') },
        stdio: 'ignore',
    });
    const clients = [];
    try {
        await waitForHttp(`http://localhost:${port}/api/settings`);
        const url = `ws://localhost:${port}`;
        const origin = `http://localhost:${port}`;
        const [stage, host, testClient] = await Promise.all([
            connectQueueClient(WebSocket, url, origin),
            connectQueueClient(WebSocket, url, origin),
            connectQueueClient(WebSocket, url, origin),
        ]);
        clients.push(stage, host, testClient);
        stage.ws.send(JSON.stringify({ type: 'karaoke_role', role: 'stage' }));
        host.ws.send(JSON.stringify({ type: 'karaoke_role', role: 'host' }));
        testClient.ws.send(JSON.stringify({ type: 'karaoke_role', role: 'test-client' }));
        const initial = await stage.wait((message) => message.type === 'karaoke_session'
            && message.state.queue && Number.isInteger(message.state.queue.revision));
        assert.equal(initial.state.queue.revision, 0);
        stage.ws.send(JSON.stringify({ type: 'karaoke_queue_reserve', expectedRevision: 0,
            item: { songId: 'local-1', singerId: 'alice', key: -2 } }));
        const result = await stage.wait((message) => message.type === 'karaoke_queue_result');
        assert.equal(result.accepted, true);
        const queueRevision = result.state.queue.revision;
        const projections = await Promise.all(clients.map((client) => client.wait(
            (message) => message.type === 'karaoke_session' && message.state.queue.revision === queueRevision,
        )));
        const withoutRole = ({ role, ...state }) => state;
        assert.deepEqual(withoutRole(projections[0].state), withoutRole(projections[1].state));
        assert.deepEqual(withoutRole(projections[1].state), withoutRole(projections[2].state));

        host.ws.send(JSON.stringify({ type: 'karaoke_queue_reserve', expectedRevision: 0,
            item: { songId: 'local-1', singerId: 'bob', key: 2 } }));
        const stale = await host.wait((message) => message.type === 'karaoke_queue_result' && message.accepted === false);
        assert.equal(stale.reason, 'stale-queue-revision');

        stage.ws.send(JSON.stringify({ type: 'karaoke_queue_reserve', expectedRevision: queueRevision,
            item: { songId: 'local-2', singerId: 'bob', key: 1 } }));
        const secondReserve = await stage.wait((message) => message.type === 'karaoke_queue_result'
            && message.accepted === true && message.queueRevision === queueRevision + 1);
        assert.equal(secondReserve.state.queue.items.length, 2);
        const start = (sourceState, targetState, details = {}) => stage.ws.send(JSON.stringify({
            type: 'karaoke_session_transition', sourceState, targetState, details,
        }));
        start('IDLE', 'PREPARING', { event: 'start', song: { id: 'local-1', title: 'Local Song', artist: 'Singer', durationMs: 180000 } });
        await stage.wait((message) => message.type === 'karaoke_session_result'
            && message.accepted === true && message.state.state === 'PREPARING');
        start('PREPARING', 'INTRO', { event: 'ready' });
        await stage.wait((message) => message.type === 'karaoke_session_result'
            && message.accepted === true && message.state.state === 'INTRO');
        start('INTRO', 'PLAYING', { event: 'play' });
        await stage.wait((message) => message.type === 'karaoke_session_result'
            && message.accepted === true && message.state.state === 'PLAYING');
        stage.ws.send(JSON.stringify({ type: 'karaoke_queue_skip', expectedRevision: queueRevision + 1 }));
        const skipped = await stage.wait((message) => message.type === 'karaoke_queue_result'
            && message.accepted === true && message.queueRevision === queueRevision + 2);
        assert.equal(skipped.state.queue.currentQueueId, secondReserve.state.queue.items[1].queueId);
        assert.equal(skipped.state.state, 'PREPARING');
        assert.equal(skipped.state.song.id, 'local-2');
        stage.ws.send(JSON.stringify({ type: 'karaoke_queue_remove_current', expectedRevision: queueRevision + 2 }));
        const removedCurrent = await stage.wait((message) => message.type === 'karaoke_queue_result'
            && message.accepted === true && message.queueRevision === queueRevision + 3);
        assert.equal(removedCurrent.state.queue.currentQueueId, null);
        assert.equal(removedCurrent.state.queue.items.length, 0);
        assert.equal(removedCurrent.state.state, 'IDLE');

        const reconnect = await connectQueueClient(WebSocket, url, origin);
        clients.push(reconnect);
        const refreshed = await reconnect.wait((message) => message.type === 'karaoke_session' && message.state.queue);
        assert.deepEqual(withoutRole(refreshed.state), withoutRole(removedCurrent.state));
        reconnect.ws.close();
    } finally {
        for (const client of clients) client.ws.close();
        server.kill();
        try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
    }
}

(async () => {
    await testQueueShapeAndOrdering();
    await testDuplicateReservationsAndInsertNext();
    await testConcurrentRevisionGuard();
    await testReorderRemoveRaceAndStaleMutation();
    await testCurrentRemovalSkipAndSessionReconciliation();
    await testPersistenceAndLegacyCacheReadability();
    await testProjectionConsistencyAndStaleRejection();
    await testQueueProtocolAdapter();
    await testKeyRevisionGuard();
    await testServerQueueProjection();
    console.log('test_karaoke_queue: OK');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
