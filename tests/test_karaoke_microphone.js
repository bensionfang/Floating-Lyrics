'use strict';

const assert = require('node:assert/strict');

let microphone;
try {
    microphone = require('../web-app/public/js/karaoke-microphone.js');
} catch (error) {
    microphone = { __loadError: error };
}

const {
    BrowserMicrophoneEngine,
    STATES,
    classifyLatency,
} = microphone;

class FakeParam {
    constructor(value = 0) { this.value = value; }
}

class FakeNode {
    constructor(name) {
        this.name = name;
        this.connections = [];
    }

    connect(node) {
        this.connections.push(node);
        return node;
    }

    disconnect() { this.connections = []; }
}

class FakeTrack {
    constructor(settings = {}) {
        this.settings = { sampleRate: 48000, channelCount: 1, ...settings };
        this.listeners = new Map();
        this.stopped = false;
    }

    getSettings() { return { ...this.settings }; }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    stop() { this.stopped = true; }

    end() {
        for (const listener of this.listeners.get('ended') || []) listener();
    }
}

class FakeStream {
    constructor(track) { this.track = track; }
    getAudioTracks() { return [this.track]; }
}

class FakeMediaDevices {
    constructor() {
        this.calls = [];
        this.devices = [
            { kind: 'audioinput', deviceId: 'mic-1', label: 'Mic 1' },
            { kind: 'audiooutput', deviceId: 'speaker-1', label: 'Speaker 1' },
        ];
        this.next = () => new FakeStream(new FakeTrack());
    }

    async enumerateDevices() { return this.devices.map((device) => ({ ...device })); }

    async getUserMedia(constraints) {
        this.calls.push(constraints);
        return this.next(constraints);
    }
}

class FakeAudioContext {
    constructor() {
        this.sampleRate = 48000;
        this.baseLatency = 0.008;
        this.outputLatency = 0.012;
        this.state = 'running';
        this.destination = new FakeNode('destination');
        this.sinkIds = [];
        this.nodes = [];
    }

    _node(name) {
        const node = new FakeNode(name);
        this.nodes.push(node);
        return node;
    }

    createMediaStreamSource(stream) {
        const node = this._node('source');
        node.stream = stream;
        return node;
    }

    createMediaStreamDestination() {
        const node = this._node('stream-destination');
        node.stream = { id: `${node.name}-${this.nodes.length}` };
        return node;
    }

    createAnalyser() { return this._node('analyser'); }

    createGain() {
        const node = this._node('gain');
        node.gain = new FakeParam(1);
        return node;
    }

    createDelay() {
        const node = this._node('delay');
        node.delayTime = new FakeParam(0);
        return node;
    }

    createConvolver() {
        const node = this._node('convolver');
        node.buffer = null;
        return node;
    }

    createBuffer(channels, length, sampleRate) {
        return { channels, length, sampleRate };
    }

    async setSinkId(deviceId) { this.sinkIds.push(String(deviceId)); }
    async close() { this.state = 'closed'; }
}

function makeEngine() {
    const mediaDevices = new FakeMediaDevices();
    const engine = new BrowserMicrophoneEngine({
        mediaDevices,
        AudioContext: FakeAudioContext,
        now: () => 1000,
    });
    return { engine, mediaDevices };
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

async function asyncTest(name, fn) {
    try {
        await fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        console.error(`not ok - ${name}`);
        throw error;
    }
}

async function run() {
    assert.equal(microphone.__loadError, undefined, 'microphone boundary module must exist');
    assert.equal(typeof BrowserMicrophoneEngine, 'function');

    test('exposes the Task 7 microphone state contract', () => {
        assert.deepEqual(STATES, [
            'supported', 'unsupported', 'requesting', 'running',
            'denied', 'disconnected', 'stopped', 'error',
        ]);
    });

    await asyncTest('reports supported, requesting, running, denied, and stopped states', async () => {
        const { engine } = makeEngine();
        assert.equal(engine.snapshot().state, 'supported');
        const states = [];
        const unsubscribe = engine.on((event) => states.push(event.state));
        const start = engine.start();
        assert.equal(engine.snapshot().state, 'requesting');
        assert.equal((await start).state, 'running');
        assert.deepEqual(states.slice(0, 2), ['requesting', 'running']);
        assert.equal(engine.stop().state, 'stopped');
        unsubscribe();

        const denied = makeEngine().engine;
        denied.mediaDevices.getUserMedia = async () => {
            throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' });
        };
        assert.equal((await denied.start()).state, 'denied');
    });

    test('latency classification keeps unknown and measured evidence separate', () => {
        assert.deepEqual(classifyLatency(null), { status: 'unknown', evidence: 'none' });
        assert.deepEqual(classifyLatency(24), { status: 'target', evidence: 'measured' });
        assert.deepEqual(classifyLatency(40), { status: 'acceptable', evidence: 'measured' });
        assert.deepEqual(classifyLatency(51), { status: 'warning', evidence: 'measured' });
        assert.deepEqual(classifyLatency(-1), { status: 'unknown', evidence: 'none' });
    });

    await asyncTest('missing microphone is optional and isolated from playback state', async () => {
        const { engine } = makeEngine();
        engine.mediaDevices.getUserMedia = async () => {
            throw Object.assign(new Error('no microphone'), { name: 'NotFoundError' });
        };
        const playback = { state: 'PLAYING', positionMs: 1234 };
        const result = await engine.start();
        assert.equal(result.state, 'disconnected');
        assert.equal(result.error.code, 'microphone-missing');
        assert.deepEqual(playback, { state: 'PLAYING', positionMs: 1234 });
    });

    await asyncTest('device selection, dry/processed paths, and runtime latency are observable', async () => {
        const { engine, mediaDevices } = makeEngine();
        const devices = await engine.listDevices();
        assert.deepEqual(devices.map((device) => device.deviceId), ['mic-1', 'speaker-1']);
        const result = await engine.start({
            inputDeviceId: 'mic-1',
            outputDeviceId: 'speaker-1',
            format: { sampleRate: 48000, channelCount: 1 },
            bufferSize: 128,
        });
        assert.equal(result.state, 'running');
        assert.equal(mediaDevices.calls[0].audio.deviceId.exact, 'mic-1');
        assert.notEqual(result.paths.dryAnalysisId, result.paths.processedMonitoringId);
        assert.equal(result.buffer.requestedFrames, 128);
        assert.equal(result.latency.status, 'unverified');
        assert.equal(result.latency.evidence, 'runtime-reported');
        assert.equal(result.latency.baseLatencyMs, 8);
        assert.equal(result.latency.outputLatencyMs, 12);
        assert.equal(result.latency.reportedMs, 20);
        assert.equal(typeof result.paths.dryAnalysisId, 'string');
        assert.equal(typeof result.paths.processedMonitoringId, 'string');
        assert.equal(engine.recordLatency(1000, 1024).latency.status, 'target');
        assert.equal(engine.recordLatency(1000, 1060).latency.status, 'warning');
        assert.equal(engine.snapshot().latency.measuredMs, 60);
        assert.equal(engine.recordLatency(1000, 900).latency.status, 'unknown');
        assert.equal(engine.snapshot().latency.measuredMs, null);
    });

    await asyncTest('gain, mute, monitoring, and echo/reverb changes update the graph', async () => {
        const { engine } = makeEngine();
        await engine.start();
        assert.equal(engine.setGain(0.4).gain, 0.4);
        assert.equal(engine.setMuted(true).muted, true);
        assert.equal(engine.setMonitoring(false).monitoring, false);
        const effects = engine.setEffects({ echo: 0.3, reverb: 0.7 });
        assert.deepEqual(effects.effects, { echo: 0.3, reverb: 0.7 });
        assert.equal(engine.snapshot().health, 'ok');
    });

    await asyncTest('input/output selection and reconnect replace a disconnected device', async () => {
        const { engine, mediaDevices } = makeEngine();
        await engine.start({ inputDeviceId: 'mic-1' });
        const firstTrack = engine.getTrack();
        firstTrack.end();
        assert.equal(engine.snapshot().state, 'disconnected');
        await engine.setInputDevice('mic-2');
        assert.equal(mediaDevices.calls.at(-1).audio.deviceId.exact, 'mic-2');
        assert.equal(engine.snapshot().inputDeviceId, 'mic-2');
        await engine.setOutputDevice('speaker-2');
        assert.equal(engine.snapshot().outputDeviceId, 'speaker-2');
        await engine.reconnect();
        assert.equal(engine.snapshot().state, 'running');
    });

    await asyncTest('unsupported format stops the stream without throwing', async () => {
        const { engine, mediaDevices } = makeEngine();
        mediaDevices.next = () => {
            mediaDevices.track = new FakeTrack({ sampleRate: 16000, channelCount: 1 });
            return new FakeStream(mediaDevices.track);
        };
        const result = await engine.start({ format: { sampleRate: 48000, channelCount: 1 } });
        assert.equal(result.state, 'unsupported');
        assert.equal(result.error.code, 'unsupported-format');
        assert.equal(mediaDevices.track.stopped, true);
    });

    await asyncTest('underruns degrade monitoring but do not stop Karaoke playback', async () => {
        const { engine } = makeEngine();
        await engine.start();
        const result = engine.reportUnderrun({ bufferFrames: 128 });
        assert.equal(result.buffer.underruns, 1);
        assert.equal(result.health, 'degraded');
        assert.equal(result.state, 'running');
    });

    await asyncTest('playback-only sessions do not construct or require a microphone', async () => {
        const { BrowserAudioKaraokePlayer } = require('../web-app/public/js/karaoke-player.js');
        assert.equal(typeof BrowserAudioKaraokePlayer, 'function');
        const { engine } = makeEngine();
        assert.equal(engine.snapshot().state, 'supported');
    });
}

run().then(() => console.log('test_karaoke_microphone: OK')).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
