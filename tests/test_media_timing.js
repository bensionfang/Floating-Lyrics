'use strict';

const assert = require('node:assert/strict');
const { MediaTimingSequencer } = require('../web-app/media-timing.js');

function test(name, fn) {
    fn();
    console.log(`ok - ${name}`);
}

function update(sequencer, patch) {
    return sequencer.update({
        title: 'Song',
        artist: 'Artist',
        position: 10,
        duration: 180,
        is_playing: true,
        ...patch,
    });
}

test('media snapshots receive ordered lifecycle metadata', () => {
    const sequencer = new MediaTimingSequencer();

    assert.deepStrictEqual(update(sequencer, { position: 0 }), {
        title: 'Song', artist: 'Artist', position: 0, duration: 180, is_playing: true,
        timing_event: 'load', timing_revision: 0, timing_order: 0,
    });
    assert.equal(update(sequencer, { position: 0.1 }).timing_event, 'play');
    assert.equal(update(sequencer, { position: 0.1, is_playing: false }).timing_event, 'pause');
    assert.equal(update(sequencer, { position: 40, is_playing: false }).timing_event, 'seek');
    assert.equal(update(sequencer, { position: 0, is_playing: true }).timing_event, 'restart');
    assert.equal(update(sequencer, { title: '', artist: '', position: 0, duration: 0, is_playing: false }).timing_event, 'stop');
    assert.equal(update(sequencer, { position: 0, duration: 180, is_playing: false, error: 'device lost' }).timing_event, 'error');
    assert.equal(update(sequencer, { position: 180, duration: 180, is_playing: false, error: null }).timing_event, 'ended');

    const nextTrack = update(sequencer, {
        title: 'Next', artist: 'Artist', position: 0, duration: 200, is_playing: false, error: null,
    });
    assert.equal(nextTrack.timing_event, 'load');
    assert.equal(nextTrack.timing_revision, 3);
    assert.equal(nextTrack.timing_order, 0);
});

test('revision increments only when the track identity changes', () => {
    const sequencer = new MediaTimingSequencer();
    const first = update(sequencer, { position: 0 });
    const sameTrack = update(sequencer, { artist: 'Artist', position: 1 });
    const changedArtist = update(sequencer, { artist: 'Other', position: 1 });

    assert.equal(first.timing_revision, 0);
    assert.equal(sameTrack.timing_revision, 0);
    assert.equal(changedArtist.timing_revision, 1);
    assert.equal(changedArtist.timing_order, 0);
});

test('resume with a position jump remains a play event', () => {
    const sequencer = new MediaTimingSequencer();
    update(sequencer, { position: 10, is_playing: true });
    update(sequencer, { position: 10, is_playing: false });

    const resumed = update(sequencer, { position: 40, is_playing: true });
    assert.equal(resumed.timing_event, 'play');
});

console.log('test_media_timing: OK');
