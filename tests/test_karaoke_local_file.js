'use strict';

const WebSocket = require('../web-app/node_modules/ws');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
    const fixture = 'C:/Users/USER/Desktop/打包new/bloom各類/bloom_backstage.mp3';
    const targets = await fetch('http://127.0.0.1:9333/json/list').then((response) => response.json());
    const target = targets.find((item) => item.type === 'page');
    if (!target) throw new Error('no Electron page target');

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const pending = new Map();
    let nextId = 0;
    socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString());
        if (!message.id || !pending.has(message.id)) return;
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) resolve(Promise.reject(new Error(JSON.stringify(message.error))));
        else resolve(message.result || {});
    });
    await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
    });

    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
        const id = ++nextId;
        pending.set(id, (result) => {
            if (result && typeof result.then === 'function') result.catch(reject);
            else resolve(result);
        });
        socket.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression, awaitPromise = false) => {
        const result = await cdp('Runtime.evaluate', {
            expression,
            awaitPromise,
            returnByValue: true,
        });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'runtime evaluation failed');
        return result.result && result.result.value;
    };

    await cdp('DOM.enable');
    await cdp('Page.navigate', { url: 'http://localhost:5795/karaoke?player=local' });
    await sleep(1500);
    const document = await cdp('DOM.getDocument');
    const node = await cdp('DOM.querySelector', {
        nodeId: document.root.nodeId,
        selector: '#karaoke-local-file',
    });
    if (!node.nodeId) throw new Error('missing #karaoke-local-file');
    await cdp('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [fixture] });
    await evaluate("document.querySelector('#karaoke-local-file').dispatchEvent(new Event('change', { bubbles: true }))");

    let state = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(500);
        state = await evaluate(`(() => {
            const spike = window.__karaokeSpike;
            return spike ? {
                readout: spike.readout(),
                events: spike.events.map((event) => ({ type: event.type, state: event.state, durationMs: event.durationMs })),
                status: document.querySelector('#karaoke-status p')?.textContent || '',
            } : null;
        })()`);
        if (state && state.events.some((event) => event.type === 'load' && event.durationMs > 0)) break;
    }
    if (!state || !state.events.some((event) => event.type === 'load' && event.durationMs > 0)) {
        throw new Error(`local file did not load: ${JSON.stringify(state)}`);
    }
    if (state.events.some((event) => event.type === 'error')) {
        throw new Error(`local file emitted error: ${JSON.stringify(state)}`);
    }

    await evaluate("document.querySelector('#karaoke-local-audio').muted = true; window.karaokeStart()");
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await sleep(250);
        state.readout = await evaluate('window.__karaokeSpike.readout()');
        if (state.readout.state === 'playing') break;
    }
    if (state.readout.state !== 'playing') throw new Error(`local file did not start: ${JSON.stringify(state)}`);

    await evaluate('window.karaokeTogglePlay()');
    await sleep(500);
    const paused = await evaluate('window.__karaokeSpike.readout()');
    if (paused.state !== 'paused') throw new Error(`local file did not pause: ${JSON.stringify(paused)}`);
    await sleep(30000);
    const pausedAfter = await evaluate('window.__karaokeSpike.readout()');
    if (Math.abs(pausedAfter.positionMs - paused.positionMs) > 250) {
        throw new Error(`paused position advanced: ${JSON.stringify({ paused, pausedAfter })}`);
    }

    await evaluate('window.karaokeTogglePlay()');
    await sleep(500);
    const resumed = await evaluate('window.__karaokeSpike.readout()');
    if (resumed.state !== 'playing' || resumed.positionMs <= pausedAfter.positionMs) {
        throw new Error(`local file did not resume: ${JSON.stringify({ pausedAfter, resumed })}`);
    }

    const seekTargets = [17000, 431000, 82000, 510000, 230000, 9000, 350000, 120000, 570000, 64000,
        292000, 480000, 1500, 210000, 390000, 75000, 545000, 265000, 115000, 455000];
    for (const target of seekTargets) {
        await evaluate(`window.__karaokeSpike.player.seek(${target})`);
        await sleep(50);
        const sought = await evaluate('window.__karaokeSpike.readout()');
        if (Math.abs(sought.positionMs - target) > 250) {
            throw new Error(`seek mismatch: ${JSON.stringify({ target, sought })}`);
        }
    }

    await evaluate('window.karaokeRestart()');
    await sleep(300);
    const restarted = await evaluate('window.__karaokeSpike.readout()');
    if (restarted.positionMs > 1000) throw new Error(`restart did not return near zero: ${JSON.stringify(restarted)}`);
    await evaluate('window.karaokeTogglePlay()');
    await sleep(300);
    const pausedAgain = await evaluate('window.__karaokeSpike.readout()');
    if (pausedAgain.state !== 'paused') throw new Error(`pause after restart failed: ${JSON.stringify(pausedAgain)}`);
    await evaluate('window.__karaokeSpike.player.stop()');
    await sleep(300);
    const stopped = await evaluate('window.__karaokeSpike.readout()');
    if (stopped.state !== 'stopped' || stopped.positionMs !== 0) {
        throw new Error(`stop did not reset player: ${JSON.stringify(stopped)}`);
    }
    const eventTypes = await evaluate('window.__karaokeSpike.events.map((event) => event.type)');
    for (const type of ['load', 'play', 'pause', 'seek', 'restart', 'stop']) {
        if (!eventTypes.includes(type)) throw new Error(`missing local player event: ${type}`);
    }
    console.log(JSON.stringify({ fixture, state }, null, 2));
    socket.close();
}

main().catch((error) => {
    console.error(error.stack || error);
    process.exit(1);
});
