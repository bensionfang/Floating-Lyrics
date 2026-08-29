'use strict';

const assert = require('node:assert/strict');
const {
    hzToMidi,
    midiToHz,
    hzToCents,
    detectPitchFrame,
    summarizeRange,
    recommendKey,
    shiftPitchFrames,
} = require('../web-app/public/js/pitch-analysis.js');

function tone(hz, sampleRate = 48000, length = 4096) {
    return Float32Array.from({ length }, (_, index) => Math.sin(2 * Math.PI * hz * index / sampleRate));
}

function frame(midi, confidence = 0.95, voiced = true, timeMs = midi * 10) {
    return { timeMs, midi, hz: midiToHz(midi), cents: 0, confidence, voiced };
}

assert.equal(hzToMidi(220), 57);
assert.equal(hzToMidi(440), 69);
assert.equal(hzToMidi(880), 81);
assert.ok(Math.abs(midiToHz(69) - 440) < 0.0001);
assert.ok(Math.abs(hzToCents(440, 69)) < 0.001);

for (const [hz, midi] of [[220, 57], [440, 69], [880, 81]]) {
    const detected = detectPitchFrame(tone(hz), 48000, 1234);
    assert.equal(detected.timeMs, 1234);
    assert.equal(detected.voiced, true);
    assert.ok(Math.abs(detected.midi - midi) < 0.5, `${hz}Hz detected as MIDI ${detected.midi}`);
    assert.ok(Math.abs(detected.cents) < 50, `${hz}Hz cents=${detected.cents}`);
}

const silent = detectPitchFrame(new Float32Array(4096), 48000, 20);
assert.equal(silent.voiced, false);
assert.equal(silent.midi, null);
assert.equal(silent.hz, null);

const ambiguous = detectPitchFrame(Float32Array.from({ length: 4096 }, (_, index) => (
    Math.sin(2 * Math.PI * 220 * index / 48000)
    + Math.sin(2 * Math.PI * 440 * index / 48000)
)), 48000, 30);
assert.equal(ambiguous.octaveWarning, true);
assert.ok(ambiguous.confidence < 0.85);

const range = summarizeRange([
    frame(40),
    frame(60), frame(60), frame(62), frame(64), frame(66), frame(68), frame(70), frame(70),
    frame(92),
    frame(120, 0.1),
    frame(10, 0.95, false),
]);
assert.equal(range.lowestMidi, 40);
assert.equal(range.highestMidi, 92);
assert.equal(range.comfortableLowMidi, 60);
assert.equal(range.comfortableHighMidi, 70);
assert.equal(range.voicedRatio, 0.833);
assert.equal(range.octaveWarning, false);

const reference = [62, 64, 66, 68, 70].map((midi) => frame(midi));
const recommendation = recommendKey(reference, {
    lowestMidi: 58,
    highestMidi: 72,
    comfortableLowMidi: 60,
    comfortableHighMidi: 68,
    voicedRatio: 0.9,
    octaveWarning: false,
});
assert.equal(recommendation.recommendedSemitones, -2);
assert.deepEqual(recommendation.candidates.map((candidate) => candidate.semitones), [-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6]);
assert.equal(recommendation.candidates.find((candidate) => candidate.semitones === -2).outsideCount, 0);
assert.equal(recommendation.candidates.filter((candidate) => candidate.semitones === -2).length, 1);
assert.ok(recommendation.confidence > 0.5);

const lowPenalty = recommendKey([61, 72, 84].map((midi) => frame(midi)), {
    lowestMidi: 58,
    highestMidi: 86,
    comfortableLowMidi: 60,
    comfortableHighMidi: 80,
    voicedRatio: 1,
    octaveWarning: false,
});
assert.equal(lowPenalty.recommendedSemitones, -1);
assert.ok(lowPenalty.candidates.find((candidate) => candidate.semitones === -1).score
    < lowPenalty.candidates.find((candidate) => candidate.semitones === -3).score);

const tie = recommendKey([69, 69, 69].map((midi) => frame(midi)), {
    lowestMidi: 60,
    highestMidi: 80,
    comfortableLowMidi: 60,
    comfortableHighMidi: 80,
    voicedRatio: 1,
    octaveWarning: false,
});
assert.equal(tie.recommendedSemitones, 0);

const insufficient = recommendKey([
    frame(69, 0.2),
    frame(70, 0.3),
    frame(71, 0.4),
], {
    lowestMidi: 60,
    highestMidi: 80,
    comfortableLowMidi: 60,
    comfortableHighMidi: 72,
    voicedRatio: 0.1,
    octaveWarning: true,
});
assert.equal(insufficient.recommendedSemitones, null);
assert.equal(insufficient.reason, '無法可靠建議');
assert.equal(insufficient.confidence, 0);

const original = [frame(60, 0.9, true, 1000), frame(64, 0.9, true, 2000)];
const shifted = shiftPitchFrames(original, 2);
assert.deepEqual(shifted.map(({ timeMs, midi }) => ({ timeMs, midi })), [
    { timeMs: 1000, midi: 62 },
    { timeMs: 2000, midi: 66 },
]);
assert.deepEqual(original.map(({ timeMs, midi }) => ({ timeMs, midi })), [
    { timeMs: 1000, midi: 60 },
    { timeMs: 2000, midi: 64 },
]);

console.log('test_pitch_analysis: OK');
