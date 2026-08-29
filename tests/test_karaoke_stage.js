'use strict';

const assert = require('node:assert/strict');
const { KaraokeClock, sessionStateToEvent } = require('../web-app/public/js/karaoke-clock.js');
const { karaokeHasWordTiming } = require('../web-app/public/js/karaoke-slots.js');

let nowMs = 0;
const clock = new KaraokeClock({ now: () => nowMs });

function session(revision, state, positionMs, isPlaying) {
    return {
        sessionId: 'session-1',
        revision,
        state,
        song: { id: 'song-1', title: 'Song', artist: 'Artist', durationMs: 60000 },
        transport: { positionMs, durationMs: 60000, isPlaying, error: null },
    };
}

assert.equal(clock.apply(sessionStateToEvent(session(1, 'PREPARING', 0, false))).accepted, true);
assert.equal(clock.apply(sessionStateToEvent(session(2, 'PLAYING', 1000, true))).accepted, true);
nowMs = 4000;
assert.equal(clock.positionMs(), 5000, 'Stage position must interpolate from canonical player position');

assert.equal(clock.apply(sessionStateToEvent(session(3, 'PAUSED', 5000, false))).accepted, true);
nowMs = 35000;
assert.equal(clock.positionMs(), 5000, 'pause must freeze the Stage timeline');

assert.equal(clock.apply(sessionStateToEvent(session(4, 'PAUSED', 12000, false))).accepted, true);
nowMs = 36000;
assert.equal(clock.positionMs(), 12000, 'seek must re-anchor the Stage timeline');

assert.equal(clock.apply(sessionStateToEvent(session(3, 'PLAYING', 0, true))).accepted, false,
    'stale session revisions must not rewind the Stage');
assert.equal(clock.positionMs(), 12000);

assert.equal(karaokeHasWordTiming({ text: 'line' }), false,
    'missing #WORDS# must use whole-line active rendering');
assert.equal(karaokeHasWordTiming({ text: 'line', words: [[0, 0]] }), false,
    'incomplete word timing must use whole-line active rendering');
assert.equal(karaokeHasWordTiming({ text: 'line', words: [[0, 0], [4, 1000]] }), true);

assert.deepEqual(sessionStateToEvent(session(5, 'ERROR', 12000, false)).error, {
    domain: 'player',
    code: 'player-error',
    message: 'audio playback failed',
});

console.log('test_karaoke_stage: OK');
