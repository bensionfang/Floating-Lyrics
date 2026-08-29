'use strict';

// P0.2 only: deterministic contract test. This module is deliberately not
// imported by production code and must not replace any live clock path.
const assert = require('node:assert/strict');

const EVENT_TYPES = Object.freeze([
    'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error',
]);

class FakeClock {
    constructor(startMs = 0) {
        assert.ok(Number.isInteger(startMs) && startMs >= 0, 'fake clock starts at a non-negative integer');
        this._nowMs = startMs;
    }

    nowMs() {
        return this._nowMs;
    }

    advance(deltaMs) {
        assert.ok(Number.isInteger(deltaMs) && deltaMs >= 0, 'fake clock only advances by integer milliseconds');
        this._nowMs += deltaMs;
        return this._nowMs;
    }
}

function boundedPosition(positionMs, durationMs) {
    assert.ok(Number.isInteger(positionMs) && positionMs >= 0, 'positionMs must be a non-negative integer');
    if (!durationMs) return positionMs;
    return Math.min(positionMs, durationMs);
}

class TimingHarness {
    constructor(clock = new FakeClock()) {
        this.clock = clock;
        this.state = {
            status: 'idle',
            trackId: null,
            positionMs: 0,
            durationMs: 0,
            isPlaying: false,
            revision: -1,
            order: -1,
            error: null,
        };
        this.anchorPositionMs = 0;
        this.anchorAtMs = clock.nowMs();
        this.lastCorrectionMs = 0;
        this.rejectedEvents = [];
    }

    _sync() {
        const nowMs = this.clock.nowMs();
        const elapsedMs = this.state.isPlaying ? Math.max(0, nowMs - this.anchorAtMs) : 0;
        const projectedMs = boundedPosition(this.anchorPositionMs + elapsedMs, this.state.durationMs);
        this.anchorPositionMs = projectedMs;
        this.anchorAtMs = nowMs;
        this.state.positionMs = projectedMs;
        return projectedMs;
    }

    _setPosition(positionMs) {
        this.anchorPositionMs = boundedPosition(positionMs, this.state.durationMs);
        this.anchorAtMs = this.clock.nowMs();
        this.state.positionMs = this.anchorPositionMs;
    }

    _accept(event) {
        assert.ok(event && EVENT_TYPES.includes(event.type), `unknown event type: ${event && event.type}`);
        assert.ok(Number.isInteger(event.revision) && event.revision >= 0, 'revision must be an integer');
        assert.ok(Number.isInteger(event.order) && event.order >= 0, 'order must be an integer');

        const staleRevision = event.revision < this.state.revision;
        const staleOrder = event.revision === this.state.revision && event.order <= this.state.order;
        if (staleRevision || staleOrder) {
            this.rejectedEvents.push({
                event,
                reason: staleRevision ? 'stale-revision' : 'stale-order',
            });
            return false;
        }
        return true;
    }

    apply(event) {
        if (!this._accept(event)) {
            return { accepted: false, state: this.snapshot() };
        }

        const beforeMs = this._sync();
        this.state.revision = event.revision;
        this.state.order = event.order;

        switch (event.type) {
        case 'load':
            assert.ok(Number.isInteger(event.durationMs || 0) && (event.durationMs || 0) >= 0,
                'durationMs must be a non-negative integer');
            this.state.status = event.playing ? 'playing' : 'paused';
            this.state.trackId = event.trackId || null;
            this.state.durationMs = event.durationMs || 0;
            this.state.isPlaying = !!event.playing;
            this.state.error = null;
            this._setPosition(event.positionMs || 0);
            break;
        case 'play': {
            const targetMs = event.positionMs === undefined ? beforeMs : event.positionMs;
            this.lastCorrectionMs = targetMs - beforeMs;
            this.state.status = 'playing';
            this.state.isPlaying = true;
            this.state.error = null;
            this._setPosition(targetMs);
            break;
        }
        case 'pause':
            this.state.status = 'paused';
            this.state.isPlaying = false;
            this.state.error = null;
            this._setPosition(beforeMs);
            break;
        case 'seek':
            this.state.status = this.state.isPlaying ? 'playing' : 'paused';
            this.state.error = null;
            this._setPosition(event.positionMs);
            break;
        case 'restart':
            this.state.isPlaying = event.playing === undefined ? this.state.isPlaying : !!event.playing;
            this.state.status = this.state.isPlaying ? 'playing' : 'paused';
            this.state.error = null;
            this._setPosition(0);
            break;
        case 'stop':
            this.state.status = 'stopped';
            this.state.isPlaying = false;
            this.state.error = null;
            this._setPosition(0);
            break;
        case 'ended':
            this.state.status = 'ended';
            this.state.isPlaying = false;
            this.state.error = null;
            this._setPosition(this.state.durationMs || event.positionMs || beforeMs);
            break;
        case 'error':
            this.state.status = 'error';
            this.state.isPlaying = false;
            this.state.error = event.error || { domain: 'system', code: 'unknown' };
            this._setPosition(beforeMs);
            break;
        default:
            throw new Error(`unhandled event type: ${event.type}`);
        }

        return { accepted: true, state: this.snapshot() };
    }

    positionMs() {
        return this._sync();
    }

    snapshot() {
        const positionMs = this._sync();
        return { ...this.state, positionMs };
    }
}

function classifyTimingIssue({
    playerPositionMs,
    renderedPositionMs,
    expectedLyricMs,
    receivedLyricMs,
    thresholdMs = 100,
}) {
    const values = [playerPositionMs, renderedPositionMs, expectedLyricMs, receivedLyricMs, thresholdMs];
    assert.ok(values.every(Number.isFinite), 'timing classification needs finite values');
    if (Math.abs(playerPositionMs - renderedPositionMs) > thresholdMs) return 'system-drift';
    if (Math.abs(expectedLyricMs - receivedLyricMs) > thresholdMs) return 'lyric-source-error';
    return null;
}

function event(type, revision, order, extra = {}) {
    return { type, revision, order, ...extra };
}

function assertPosition(harness, expectedMs, message) {
    assert.strictEqual(harness.positionMs(), expectedMs, message);
}

function test(name, fn) {
    try {
        fn();
        console.log(`ok - ${name}`);
    } catch (error) {
        error.message = `${name}: ${error.message}`;
        throw error;
    }
}

test('event model includes every P0.2 lifecycle event', () => {
    assert.deepStrictEqual(EVENT_TYPES, [
        'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error',
    ]);
});

test('load, play, pause, and 30-second pause/resume preserve position', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 1, 1, { trackId: 'song-a', durationMs: 600000 }));
    harness.apply(event('play', 2, 2));
    clock.advance(5000);
    harness.apply(event('pause', 3, 3));
    assertPosition(harness, 5000, 'pause boundary must capture the current position');
    clock.advance(30000);
    assertPosition(harness, 5000, 'paused position must not advance during 30 seconds');
    harness.apply(event('play', 4, 4));
    clock.advance(7000);
    assertPosition(harness, 12000, 'resume must continue from the paused position');
});

test('seek and deterministic random seeks re-anchor without cumulative error', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 1, 1, { trackId: 'song-b', durationMs: 600000 }));
    harness.apply(event('play', 2, 2));

    let seed = 0x5eed;
    for (let i = 0; i < 12; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        const targetMs = seed % 180000;
        harness.apply(event('seek', 3 + i, 3 + i, { positionMs: targetMs }));
        assertPosition(harness, targetMs, `seek boundary ${i} must be exact`);
        clock.advance(375);
        assertPosition(harness, targetMs + 375, `seek boundary ${i} must interpolate from its own anchor`);
    }

    clock.advance(500);
    harness.apply(event('restart', 20, 20));
    assertPosition(harness, 0, 'restart must reset the anchor to zero');
    clock.advance(250);
    assertPosition(harness, 250, 'restart must resume from zero without stale position');
});

test('stop, ended, and error freeze the correct lifecycle state', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 1, 1, { trackId: 'song-c', durationMs: 120000 }));
    harness.apply(event('play', 2, 2));
    clock.advance(1000);
    harness.apply(event('stop', 3, 3));
    assert.strictEqual(harness.snapshot().status, 'stopped');
    assertPosition(harness, 0, 'stop must clear the position');
    clock.advance(5000);
    assertPosition(harness, 0, 'stopped position must remain frozen');

    harness.apply(event('load', 4, 4, { trackId: 'song-d', durationMs: 120000 }));
    harness.apply(event('play', 5, 5));
    clock.advance(4321);
    harness.apply(event('ended', 6, 6));
    assert.strictEqual(harness.snapshot().status, 'ended');
    assertPosition(harness, 120000, 'ended must land at known duration');

    harness.apply(event('load', 7, 7, { trackId: 'song-e' }));
    harness.apply(event('play', 8, 8));
    clock.advance(1500);
    harness.apply(event('error', 9, 9, {
        error: { domain: 'lyric-source', code: 'unavailable' },
    }));
    assert.strictEqual(harness.snapshot().status, 'error');
    assert.deepStrictEqual(harness.snapshot().error, { domain: 'lyric-source', code: 'unavailable' });
    assertPosition(harness, 1500, 'error must preserve the last valid position');
    clock.advance(5000);
    assertPosition(harness, 1500, 'error state must not keep interpolating');
});

test('stale revision and same-revision order cannot move a newer state backward', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 10, 100, { trackId: 'newer', durationMs: 600000 }));
    harness.apply(event('play', 11, 110));
    clock.advance(100);

    const oldRevision = harness.apply(event('pause', 10, 999));
    assert.strictEqual(oldRevision.accepted, false);
    assert.strictEqual(harness.rejectedEvents.at(-1).reason, 'stale-revision');
    assert.strictEqual(harness.snapshot().isPlaying, true);
    assertPosition(harness, 100, 'late old revision must not pause or rewind playback');

    const oldOrder = harness.apply(event('seek', 11, 109, { positionMs: 0 }));
    assert.strictEqual(oldOrder.accepted, false);
    assert.strictEqual(harness.rejectedEvents.at(-1).reason, 'stale-order');
    assertPosition(harness, 100, 'same-revision old order must not apply a stale seek');

    const accepted = harness.apply(event('pause', 12, 1));
    assert.strictEqual(accepted.accepted, true);
    assert.strictEqual(harness.snapshot().status, 'paused');
});

test('authoritative drift correction re-anchors instead of accumulating frame error', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 1, 1, { trackId: 'song-f', durationMs: 0 }));
    harness.apply(event('play', 2, 2));
    clock.advance(10000);
    harness.apply(event('play', 3, 3, { positionMs: 10080 }));
    assert.strictEqual(harness.lastCorrectionMs, 80, 'drift correction must be observable at the re-anchor');
    assertPosition(harness, 10080, 'authoritative position must win at correction');
    clock.advance(300000);
    assertPosition(harness, 310080, 'five minutes after correction must have zero cumulative error');
});

test('lyric source error is distinct from system drift', () => {
    assert.strictEqual(classifyTimingIssue({
        playerPositionMs: 20000,
        renderedPositionMs: 20000,
        expectedLyricMs: 20000,
        receivedLyricMs: 18000,
    }), 'lyric-source-error');
    assert.strictEqual(classifyTimingIssue({
        playerPositionMs: 20000,
        renderedPositionMs: 20600,
        expectedLyricMs: 20000,
        receivedLyricMs: 20000,
    }), 'system-drift');
    assert.strictEqual(classifyTimingIssue({
        playerPositionMs: 20000,
        renderedPositionMs: 20040,
        expectedLyricMs: 20000,
        receivedLyricMs: 20050,
    }), null);
});

test('five-minute simulated run stays anchored to the injected clock', () => {
    const clock = new FakeClock();
    const harness = new TimingHarness(clock);
    harness.apply(event('load', 1, 1, { trackId: 'long-run' }));
    harness.apply(event('play', 2, 2));
    for (let i = 1; i <= 3000; i += 1) {
        clock.advance(100);
        assertPosition(harness, i * 100, `five-minute sample ${i} must not accumulate position error`);
    }
});

console.log('test_timing_harness: OK');

module.exports = {
    EVENT_TYPES,
    FakeClock,
    TimingHarness,
    classifyTimingIssue,
};
