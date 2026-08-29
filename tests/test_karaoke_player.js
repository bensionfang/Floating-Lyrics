'use strict';

const assert = require('node:assert/strict');
const { parseLrc } = require('../web-app/public/js/lrc-parse.js');
const { karaokeSlots } = require('../web-app/public/js/karaoke-slots.js');
const { KaraokeClock } = require('../web-app/public/js/karaoke-clock.js');
const {
    BrowserAudioKaraokePlayer,
    PLAYER_EVENT_TYPES,
    normalizeError,
} = require('../web-app/public/js/karaoke-player.js');

class FakeClock {
    constructor() { this.nowMs = 0; }
    advance(ms) {
        assert.ok(Number.isInteger(ms) && ms >= 0);
        this.nowMs += ms;
    }
}

class FakeBrowserAudio {
    constructor() {
        this.currentTime = 0;
        this.duration = 600;
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) || [];
        listeners.push(listener);
        this.listeners.set(type, listeners);
    }

    emit(type) {
        for (const listener of this.listeners.get(type) || []) listener();
    }

    pause() {}
    load() {}
}

class FakeKaraokePlayer {
    constructor(clock) {
        this.clock = clock;
        this.listeners = [];
        this.song = null;
        this.state = 'idle';
        this.positionMs = 0;
        this.durationMs = 0;
        this.anchorAtMs = clock.nowMs;
        this.anchorPositionMs = 0;
        this.rate = 1;
        this.key = 0;
        this.revision = -1;
        this.order = -1;
        this.events = [];
    }

    on(listener) {
        this.listeners.push(listener);
        return () => { this.listeners = this.listeners.filter((item) => item !== listener); };
    }

    _sync() {
        if (this.state === 'playing') {
            const elapsed = Math.max(0, this.clock.nowMs - this.anchorAtMs) * this.rate;
            this.positionMs = Math.min(this.durationMs, this.anchorPositionMs + elapsed);
            if (this.durationMs > 0 && this.positionMs >= this.durationMs) this.end();
        }
        return Math.round(this.positionMs);
    }

    _setPosition(ms) {
        assert.ok(Number.isInteger(ms) && ms >= 0);
        this.positionMs = Math.min(ms, this.durationMs || ms);
        this.anchorPositionMs = this.positionMs;
        this.anchorAtMs = this.clock.nowMs;
    }

    _emit(type, extra = {}) {
        const event = {
            type,
            state: this.state,
            positionMs: this.getPosition(),
            durationMs: this.getDuration(),
            ended: type === 'ended',
            revision: this.revision,
            order: ++this.order,
            ...extra,
        };
        this.events.push(event);
        this.listeners.forEach((listener) => listener(event));
        return event;
    }

    load(song) {
        assert.ok(song && Number.isInteger(song.durationMs) && song.durationMs > 0);
        this.song = { ...song };
        this.durationMs = song.durationMs;
        this.revision += 1;
        this.state = 'paused';
        this._setPosition(0);
        this._emit('load');
    }

    play() {
        this._sync();
        if (this.state === 'ended') this._setPosition(0);
        this.state = 'playing';
        this.anchorPositionMs = this.positionMs;
        this.anchorAtMs = this.clock.nowMs;
        return this._emit('play');
    }

    pause() {
        this._sync();
        this.state = 'paused';
        this._setPosition(this.positionMs);
        return this._emit('pause');
    }

    seek(ms) {
        this._sync();
        this._setPosition(ms);
        if (this.state === 'ended') this.state = 'paused';
        return this._emit('seek');
    }

    restart() {
        this._sync();
        this._setPosition(0);
        this.state = 'playing';
        return this._emit('restart');
    }

    stop() {
        this._sync();
        this.state = 'stopped';
        this._setPosition(0);
        return this._emit('stop');
    }

    end() {
        this._sync();
        this.state = 'ended';
        this._setPosition(this.durationMs);
        return this._emit('ended');
    }

    fail(error = { domain: 'player', code: 'unknown' }) {
        this._sync();
        this.state = 'error';
        this._setPosition(this.positionMs);
        return this._emit('error', { error });
    }

    setKey(semitones) {
        assert.ok(Number.isInteger(semitones));
        this.key = semitones;
        return { supported: true, semitones };
    }

    setTempo(rate) {
        assert.ok(Number.isFinite(rate) && rate > 0);
        this._sync();
        this.rate = rate;
        this.anchorPositionMs = this.positionMs;
        this.anchorAtMs = this.clock.nowMs;
        return rate;
    }

    getPosition() { return this._sync(); }
    getDuration() { return Math.round(this.durationMs); }
}

function event(type, revision, order, extra = {}) {
    return { type, revision, order, ...extra };
}

function test(name, fn) {
    fn();
    console.log(`ok - ${name}`);
}

test('player adapter exposes the P1.1 contract and event types', () => {
    assert.equal(typeof BrowserAudioKaraokePlayer, 'function');
    assert.deepEqual(PLAYER_EVENT_TYPES, [
        'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error',
    ]);
    for (const method of ['load', 'play', 'pause', 'seek', 'stop', 'setKey', 'setTempo', 'getPosition', 'getDuration']) {
        assert.equal(typeof BrowserAudioKaraokePlayer.prototype[method], 'function', method);
    }
});

test('browser media errors are normalized without leaking object stringification', () => {
    assert.deepEqual(normalizeError({ code: 4 }), {
        domain: 'player',
        code: 'media-error-4',
        message: 'audio playback failed',
    });
});

test('browser pause ignores the delayed native pause after the command event', () => {
    const audio = new FakeBrowserAudio();
    const player = new BrowserAudioKaraokePlayer(audio);
    const events = [];
    player.on((item) => events.push(item));
    player.pause();
    audio.emit('pause');
    assert.deepEqual(events.map((item) => item.type), ['pause']);
});

test('load, play, pause, resume, and 30-second pause preserve one timeline', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    player.load({ id: 'fixture', durationMs: 600000 });
    player.play();
    time.advance(5000);
    player.pause();
    assert.equal(player.getPosition(), 5000);
    time.advance(30000);
    assert.equal(player.getPosition(), 5000);
    player.play();
    time.advance(7000);
    assert.equal(player.getPosition(), 12000);
});

test('seek, restart, stop, ended, and error keep state and position coherent', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    const events = [];
    player.on((item) => events.push(item));
    player.load({ id: 'fixture', durationMs: 120000 });
    player.play();
    time.advance(4321);
    player.seek(90000);
    assert.equal(player.getPosition(), 90000);
    player.restart();
    assert.equal(player.getPosition(), 0);
    time.advance(250);
    assert.equal(player.getPosition(), 250);
    player.stop();
    assert.equal(player.state, 'stopped');
    assert.equal(player.getPosition(), 0);
    player.play();
    time.advance(1000);
    player.end();
    assert.equal(player.state, 'ended');
    assert.equal(player.getPosition(), 120000);
    player.load({ id: 'fixture-2', durationMs: 120000 });
    player.play();
    time.advance(1500);
    player.fail({ domain: 'player', code: 'device-lost' });
    assert.equal(player.state, 'error');
    assert.equal(player.getPosition(), 1500);
    assert.equal(events.at(-1).error.code, 'device-lost');
    assert.equal(events.at(-1).ended, false);
});

test('twenty deterministic seeks re-anchor without cumulative position error', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    player.load({ id: 'fixture', durationMs: 600000 });
    player.play();
    let seed = 0x51a7;
    for (let i = 0; i < 20; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const target = seed % 540000;
        player.seek(target);
        assert.equal(player.getPosition(), target);
        time.advance(375);
        assert.equal(player.getPosition(), target + 375);
    }
});

test('five-minute run reads an anchored player position, not accumulated frame deltas', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    player.load({ id: 'fixture', durationMs: 600000 });
    player.play();
    for (let i = 1; i <= 3000; i += 1) {
        time.advance(100);
        assert.equal(player.getPosition(), i * 100);
    }
});

test('key and tempo changes never rewrite the millisecond timeline contract', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    player.load({ id: 'fixture', durationMs: 600000 });
    player.play();
    time.advance(12345);
    const before = { positionMs: player.getPosition(), durationMs: player.getDuration() };
    player.setKey(-2);
    assert.deepEqual({ positionMs: player.getPosition(), durationMs: player.getDuration() }, before);
    player.setTempo(1.25);
    assert.equal(player.getPosition(), before.positionMs);
    assert.equal(player.getDuration(), before.durationMs);
    time.advance(1000);
    assert.equal(player.getPosition(), before.positionMs + 1250);
});

test('stale player events cannot move a newer track back in time', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    const clock = new KaraokeClock({ now: () => time.nowMs });
    player.load({ id: 'old', durationMs: 600000 });
    player.play();
    clock.apply(event('load', 1, 0, { trackId: 'old', positionMs: 0, durationMs: 600000, playing: true }));
    time.advance(1000);
    player.load({ id: 'new', durationMs: 600000 });
    player.play();
    clock.apply(event('load', 2, 0, { trackId: 'new', positionMs: 0, durationMs: 600000, playing: true }));
    time.advance(1000);
    assert.equal(clock.apply(event('seek', 1, 99, { positionMs: 0 })).accepted, false);
    assert.equal(clock.snapshot().trackId, 'new');
    assert.equal(clock.positionMs(), 1000);
    assert.equal(clock.apply(event('seek', 2, 0, { positionMs: 0 })).accepted, false);
    assert.equal(clock.positionMs(), 1000);
});

test('stage, lyric slots, and #WORDS# consume the same authoritative player position', () => {
    const time = new FakeClock();
    const player = new FakeKaraokePlayer(time);
    const lines = parseLrc([
        '[00:00.000]first lyric',
        '[00:00.000]#WORDS#0:0,11:3000',
        '[00:10.000]second lyric',
        '[00:10.000]#WORDS#0:0,12:3000',
        '[00:20.000]third lyric',
        '[00:20.000]#WORDS#0:0,11:3000',
    ].join('\n')).lines;
    player.load({ id: 'fixture', durationMs: 600000 });
    player.play();
    let seed = 0x4242;
    for (let i = 0; i < 20; i += 1) {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
        const target = seed % 30000;
        player.seek(target);
        const authoritativeMs = player.getPosition();
        const stage = karaokeSlots(lines, authoritativeMs / 1000);
        const wordPositionMs = Math.max(0, authoritativeMs - Math.round(lines[stage.index].time * 1000));
        const samePositionRender = karaokeSlots(lines, player.getPosition() / 1000);
        assert.deepEqual(stage, samePositionRender, 'Stage and lyric slots must read the same player position');
        assert.equal(wordPositionMs, Math.max(0, player.getPosition() - Math.round(lines[stage.index].time * 1000)),
            'word position must be derived from that same player position');
        assert.ok(Number.isInteger(authoritativeMs));
    }
});

console.log('test_karaoke_player: OK');
