'use strict';

const assert = require('node:assert/strict');
const {
    KaraokeClock,
    mediaStateToEvent,
} = require('../web-app/public/js/karaoke-clock.js');

class FakeClock {
    constructor() { this.now = 0; }
    advance(ms) { this.now += ms; }
}

function test(name, fn) {
    fn();
    console.log(`ok - ${name}`);
}

test('media snapshots become integer-ms contract events', () => {
    assert.deepStrictEqual(mediaStateToEvent({
        title: 'Song',
        artist: 'Artist',
        position: 12.345,
        duration: 180.5,
        is_playing: true,
        timing_event: 'play',
        timing_revision: 4,
        timing_order: 9,
    }), {
        type: 'play',
        revision: 4,
        order: 9,
        trackId: 'Artist|||Song',
        positionMs: 12345,
        durationMs: 180500,
    });
});

test('clock projects playback from one monotonic anchor and rejects stale events', () => {
    const time = new FakeClock();
    const clock = new KaraokeClock({ now: () => time.now });

    assert.equal(clock.apply({
        type: 'load', revision: 1, order: 0, trackId: 'Artist|||Song',
        positionMs: 1000, durationMs: 180000, playing: true,
    }).accepted, true);
    time.advance(1250);
    assert.equal(clock.positionMs(), 2250);

    const stale = clock.apply({
        type: 'pause', revision: 1, order: 0,
    });
    assert.equal(stale.accepted, false);
    assert.equal(clock.snapshot().isPlaying, true);
    assert.equal(clock.positionMs(), 2250);
});

test('authoritative correction re-anchors without cumulative drift', () => {
    const time = new FakeClock();
    const clock = new KaraokeClock({ now: () => time.now });

    clock.apply({
        type: 'load', revision: 1, order: 0, trackId: 'Artist|||Song',
        positionMs: 0, durationMs: 0, playing: true,
    });
    time.advance(10000);
    clock.apply({
        type: 'play', revision: 2, order: 0, trackId: 'Artist|||Song',
        positionMs: 10080,
    });
    assert.equal(clock.lastCorrectionMs, 80);
    assert.equal(clock.positionMs(), 10080);
    time.advance(300000);
    assert.equal(clock.positionMs(), 310080);
});

test('ended uses duration from the authoritative event when needed', () => {
    const time = new FakeClock();
    const clock = new KaraokeClock({ now: () => time.now });

    clock.apply({
        type: 'load', revision: 1, order: 0, trackId: 'Artist|||Song',
        positionMs: 0, durationMs: 0, playing: true,
    });
    clock.apply({
        type: 'ended', revision: 1, order: 1, trackId: 'Artist|||Song',
        positionMs: 0, durationMs: 180000,
    });
    assert.equal(clock.positionMs(), 180000);
});

test('SSR seed and local restart do not consume authoritative ordering', () => {
    const time = new FakeClock();
    const clock = new KaraokeClock({ now: () => time.now });

    clock.seed({ trackId: 'Artist|||Song', positionMs: 5000, durationMs: 180000, isPlaying: true });
    time.advance(1000);
    assert.equal(clock.positionMs(), 6000);
    assert.equal(clock.apply({
        type: 'load', revision: 3, order: 7, trackId: 'Artist|||Song',
        positionMs: 5000, durationMs: 180000, playing: true,
    }).accepted, true);

    clock.reanchor(0, true);
    time.advance(250);
    assert.equal(clock.positionMs(), 250);
    assert.equal(clock.snapshot().revision, 3);
    assert.equal(clock.snapshot().order, 7);
});

test('media errors keep system and lyric-source diagnostics typed', () => {
    assert.deepStrictEqual(mediaStateToEvent({
        timing_event: 'error',
        error: 'device lost',
    }).error, {
        domain: 'system',
        code: 'media-monitor',
        message: 'device lost',
    });
    const sourceError = { domain: 'lyric-source', code: 'unavailable' };
    assert.deepStrictEqual(mediaStateToEvent({
        timing_event: 'error',
        error: sourceError,
    }).error, sourceError);
});

console.log('test_karaoke_clock: OK');
