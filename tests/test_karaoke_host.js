'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('../web-app/node_modules/ws');

const PORT = 5732;
const BASE = `http://localhost:${PORT}`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-host-test-'));

function waitForServer(deadlineMs = 20000) {
    const until = Date.now() + deadlineMs;
    return (async () => {
        while (Date.now() < until) {
            try {
                const response = await fetch(`${BASE}/host`);
                if (response.ok) return;
            } catch {}
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        throw new Error('server did not start');
    })();
}

function connect() {
    const ws = new WebSocket(BASE.replace('http', 'ws'));
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
    ws.waitFor = (predicate, timeoutMs = 5000) => new Promise((resolve, reject) => {
        const existing = messages.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => {
            const index = waiters.findIndex((waiter) => waiter.timer === timer);
            if (index >= 0) waiters.splice(index, 1);
            reject(new Error('timed out waiting for WebSocket message'));
        }, timeoutMs);
        waiters.push({ predicate, resolve, reject, timer });
    });
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

async function run() {
    const server = spawn(process.execPath, ['server.js'], {
        cwd: path.join(__dirname, '..', 'web-app'),
        env: {
            ...process.env,
            PORT: String(PORT),
            DB_PATH: path.join(TMP, 'test.db'),
            DATA_DIR: TMP,
            LYRICS_SETTINGS_PATH: path.join(TMP, 'settings.json'),
        },
        stdio: 'ignore',
    });
    let stage;
    let host;
    try {
        await waitForServer();
        const page = await fetch(`${BASE}/host`);
        const hostHtml = await page.text();
        assert.match(hostHtml, /Karaoke Host/);
        assert.match(hostHtml, /data-host-command="stop"/);
        for (const id of [
            'host-library-add', 'host-library-preview', 'host-library-import',
            'host-song-search', 'host-search-results',
        ]) assert.match(hostHtml, new RegExp(`id=["']${id}["']`));

        const hostJs = await (await fetch(`${BASE}/js/karaoke-host.js`)).text();
        assert.match(hostJs, /\/api\/karaoke\/library\/scan/);
        assert.match(hostJs, /\/api\/karaoke\/library\/search/);
        assert.match(hostJs, /karaoke_queue_reserve/);
        assert.match(hostJs, /expectedRevision:\s*session\.queue\.revision/);
        assert.match(hostJs, /singer:\s*['"]Host['"]/);
        assert.match(hostJs, /key:\s*0/);
        assert.match(hostJs, /Queue 已更新，請再點一次/);
        assert.doesNotMatch(hostJs, /\/api\/media-control|\/api\/seek/);

        stage = await connect();
        host = await connect();
        stage.send(JSON.stringify({ type: 'karaoke_role', role: 'stage' }));
        host.send(JSON.stringify({ type: 'karaoke_role', role: 'host' }));

        await host.waitFor((message) => message.type === 'karaoke_diagnostics'
            && message.diagnostics.items.find((item) => item.id === 'stage')?.severity === 'ok');

        host.send(JSON.stringify({ type: 'karaoke_host_command', command: 'stop' }));
        await stage.waitFor((message) => message.type === 'karaoke_host_command'
            && message.command === 'stop');

        host.send(JSON.stringify({ type: 'karaoke_host_command', command: 'pause' }));
        await stage.waitFor((message) => message.type === 'karaoke_host_command'
            && message.command === 'pause');

        stage.close();
        await host.waitFor((message) => message.type === 'karaoke_diagnostics'
            && message.diagnostics.items.find((item) => item.id === 'stage')?.severity === 'warn');

        host.send(JSON.stringify({ type: 'karaoke_host_command', command: 'play' }));
        const rejected = await host.waitFor((message) => message.type === 'karaoke_host_command_result'
            && message.accepted === false);
        assert.equal(rejected.reason, 'stage-not-connected');
        console.log('test_karaoke_host: OK');
    } finally {
        stage?.close();
        host?.close();
        server.kill();
        try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
    }
}

run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
