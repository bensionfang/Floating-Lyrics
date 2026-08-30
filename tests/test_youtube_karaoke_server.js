const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('C:/Users/USER/Desktop/project/Kanaric/web-app/node_modules/ws');
const { readOrCreateExtensionToken } = require('../web-app/youtube-karaoke-protocol.js');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-youtube-server-'));
const EXT_ORIGIN = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
    ws.once('close', () => reject(new Error('socket closed before open')));
  });
}

function waitForMessage(ws, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('timeout'));
    }, timeoutMs);
    const onMessage = (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!predicate(msg)) return;
      cleanup();
      resolve(msg);
    };
    const cleanup = () => {
      clearTimeout(timer);
      ws.off('message', onMessage);
    };
    ws.on('message', onMessage);
  });
}

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(getBase, getLogs) {
  for (let i = 0; i < 60; i++) {
    try {
      const base = getBase();
      if (!base) throw new Error('no base yet');
      const r = await fetch(base + '/api/settings');
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`server did not start\n${getLogs()}`);
}

async function connect(base, origin, protocols) {
  const ws = new WebSocket(base.replace('http', 'ws'), protocols, origin ? { origin } : {});
  ws._messages = [];
  ws.on('message', (raw) => {
    try { ws._messages.push(JSON.parse(raw)); } catch {}
  });
  await waitForOpen(ws);
  return ws;
}

async function waitForClosed(ws) {
  if (ws.readyState === WebSocket.CLOSED) return;
  if (ws.readyState === WebSocket.CLOSING) {
    await new Promise((resolve) => ws.once('close', resolve));
    return;
  }
  await new Promise((resolve) => {
    ws.once('close', resolve);
    ws.once('error', resolve);
  });
}

async function main() {
  let logs = '';
  let base = '';
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'web-app'),
    env: {
      ...process.env,
      NODE_PATH: path.join('C:\\Users\\USER\\Desktop\\project\\Kanaric\\web-app\\node_modules'),
      PORT: '0',
      DATA_DIR: TMP,
      DB_PATH: path.join(TMP, 'lyrics.db'),
      LYRICS_SETTINGS_PATH: path.join(TMP, 'settings.json'),
      MOBILE_TOKEN: 'test-token',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', (d) => { logs += d.toString(); });
  server.stderr.on('data', (d) => { logs += d.toString(); });
  server.stdout.on('data', (d) => {
    const m = d.toString().match(/running on http:\/\/localhost:(\d+)/i);
    if (m) base = `http://127.0.0.1:${m[1]}`;
  });

  try {
    await Promise.race([
      waitForServer(() => base, () => logs),
      new Promise((resolve, reject) => {
        server.once('exit', (code) => reject(new Error(`server exited ${code}\n${logs}`)));
      }),
    ]);
    const token = readOrCreateExtensionToken({ dataDir: TMP, randomBytes: (n) => Buffer.alloc(n, 1) });
    if (!base) base = 'http://127.0.0.1:5720';

    const bad = new WebSocket(base.replace('http', 'ws'), ['kanaric-youtube-v1', 'wrong-token'], { origin: EXT_ORIGIN });
    await assert.rejects(waitForOpen(bad));
    await waitForClosed(bad);

    const ext = await connect(base, EXT_ORIGIN, ['kanaric-youtube-v1', token]);
    const karaoke = await connect(base, null);
    const page = await connect(base, null);
    karaoke.send(JSON.stringify({ type: 'karaoke_active', active: true }));

    await waitMs(500);
    assert.deepStrictEqual(ext._messages, [], 'extension must not receive init');

    page.send(JSON.stringify({ type: 'settings_updated', settings: { show_romaji: true } }));
    await waitMs(200);
    assert.deepStrictEqual(ext._messages, [], 'extension must not receive settings');

    page.send(JSON.stringify({ type: 'media_state', state: { title: 'x' } }));
    await waitMs(200);
    assert.deepStrictEqual(ext._messages, [], 'extension must not receive general broadcast');

    page.send(JSON.stringify({ type: 'youtube_karaoke_command', command: { commandId: 1, action: 'play' } }));
    const forwarded = await waitForMessage(ext, (m) => m.type === 'youtube_karaoke_command');
    assert.deepStrictEqual(forwarded.command, { commandId: 1, action: 'play' });

    page.send(JSON.stringify({ type: 'youtube_karaoke_command', command: { commandId: 2, action: 'set_key', semitones: 7 } }));
    await waitMs(200);
    assert.strictEqual(ext._messages.length, 1, 'invalid command must not forward');

    ext.send(JSON.stringify({
      type: 'youtube_karaoke_state',
      state: {
        revision: 2,
        videoId: 'dQw4w9WgXcQ',
        title: 'Song',
        channel: 'Channel',
        state: 'playing',
        positionMs: 1000,
        durationMs: 10000,
        keySemitones: 0,
        error: null,
      },
    }));
    const karaokeState = await waitForMessage(karaoke, (m) => m.type === 'youtube_karaoke_state');
    assert.deepStrictEqual(karaokeState, {
      type: 'youtube_karaoke_state',
      revision: 2,
      videoId: 'dQw4w9WgXcQ',
      title: 'Song',
      channel: 'Channel',
      state: 'playing',
      positionMs: 1000,
      durationMs: 10000,
      keySemitones: 0,
      error: null,
    });

    ext.close();
    page.close();
    karaoke.close();
    await Promise.allSettled([ext, page, karaoke].map(waitForClosed));
    console.log('test_youtube_karaoke_server: OK');
  } finally {
    server.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exitCode = 1;
});
