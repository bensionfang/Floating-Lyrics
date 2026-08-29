'use strict';

(function expose(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KanaricPitchAnalysis = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createPitchAnalysis() {
    const MIN_CONFIDENCE = 0.6;
    const MIN_RMS = 0.01;
    const MIN_HZ = 50;
    const MAX_HZ = 1000;

    function finite(value) {
        return Number.isFinite(Number(value)) ? Number(value) : null;
    }

    function round(value, places = 3) {
        const factor = 10 ** places;
        return Math.round(value * factor) / factor;
    }

    function hzToMidi(hz) {
        const value = finite(hz);
        return value === null || value <= 0 ? null : 69 + 12 * Math.log2(value / 440);
    }

    function midiToHz(midi) {
        const value = finite(midi);
        return value === null ? null : 440 * (2 ** ((value - 69) / 12));
    }

    function hzToCents(hz, midi) {
        const frequency = finite(hz);
        const note = finite(midi);
        const target = midiToHz(note);
        return frequency === null || target === null || frequency <= 0 || target <= 0
            ? null : 1200 * Math.log2(frequency / target);
    }

    function asSamples(audioFrame) {
        if (!audioFrame || typeof audioFrame.length !== 'number') return null;
        return audioFrame;
    }

    function rms(samples) {
        let sum = 0;
        for (let index = 0; index < samples.length; index += 1) sum += samples[index] ** 2;
        return samples.length ? Math.sqrt(sum / samples.length) : 0;
    }

    function energyAt(samples, sampleRate, frequency) {
        if (frequency <= 0 || frequency >= sampleRate / 2) return 0;
        let sine = 0;
        let cosine = 0;
        for (let index = 0; index < samples.length; index += 1) {
            const angle = 2 * Math.PI * frequency * index / sampleRate;
            sine += samples[index] * Math.sin(angle);
            cosine += samples[index] * Math.cos(angle);
        }
        return Math.sqrt(sine ** 2 + cosine ** 2) / samples.length;
    }

    function autocorrelation(samples, sampleRate) {
        const minLag = Math.max(2, Math.floor(sampleRate / MAX_HZ));
        const maxLag = Math.min(samples.length - 2, Math.ceil(sampleRate / MIN_HZ));
        let bestLag = 0;
        let best = -1;
        const correlations = [];
        const peaks = [];
        for (let lag = minLag; lag <= maxLag; lag += 1) {
            let xy = 0;
            let xx = 0;
            let yy = 0;
            for (let index = lag; index < samples.length; index += 1) {
                const left = samples[index];
                const right = samples[index - lag];
                xy += left * right;
                xx += left * left;
                yy += right * right;
            }
            const correlation = xx && yy ? xy / Math.sqrt(xx * yy) : 0;
            correlations.push({ lag, correlation });
            if (correlation > best) {
                best = correlation;
                bestLag = lag;
            }
            if (correlation > 0.35) peaks.push({ lag, correlation });
        }
        const strongPeak = correlations.find((item, index) => (
            item.correlation >= best * 0.98
            && item.correlation >= (correlations[index - 1]?.correlation ?? -1)
            && item.correlation >= (correlations[index + 1]?.correlation ?? -1)
        ));
        return { bestLag: strongPeak ? strongPeak.lag : bestLag, best, peaks };
    }

    function detectPitchFrame(audioFrame, sampleRate, timeMs = 0) {
        const samples = asSamples(audioFrame);
        const rate = finite(sampleRate);
        const time = finite(timeMs) ?? 0;
        if (!samples || !rate || rate <= 0 || samples.length < 32) {
            return { timeMs: time, hz: null, midi: null, cents: null, confidence: 0, voiced: false, octaveWarning: false };
        }

        let mean = 0;
        for (let index = 0; index < samples.length; index += 1) mean += samples[index];
        mean /= samples.length;
        const centered = Float32Array.from(samples, (value) => value - mean);
        const level = rms(centered);
        if (level < MIN_RMS) {
            return { timeMs: time, hz: null, midi: null, cents: null, confidence: 0, voiced: false, octaveWarning: false };
        }

        const result = autocorrelation(centered, rate);
        if (!result.bestLag || result.best <= 0) {
            return { timeMs: time, hz: null, midi: null, cents: null, confidence: 0, voiced: false, octaveWarning: false };
        }
        const frequency = rate / result.bestLag;
        const midi = hzToMidi(frequency);
        const secondHarmonicRatio = energyAt(centered, rate, frequency * 2)
            / Math.max(energyAt(centered, rate, frequency), 0.000001);
        // ponytail: harmonic ambiguity heuristic; replace with a calibrated detector when voice fixtures exist.
        const octaveWarning = secondHarmonicRatio > 0.45;
        const confidence = round(Math.max(0, Math.min(1, result.best * (octaveWarning ? 0.75 : 1))), 3);
        const nearestMidi = Math.round(midi);
        return {
            timeMs: time,
            hz: round(frequency, 3),
            midi: round(midi, 3),
            cents: round(hzToCents(frequency, nearestMidi), 2),
            confidence,
            voiced: confidence >= MIN_CONFIDENCE,
            octaveWarning,
        };
    }

    function usableFrames(frames) {
        return (Array.isArray(frames) ? frames : []).filter((item) => item
            && item.voiced === true
            && finite(item.midi) !== null
            && finite(item.confidence) !== null
            && item.confidence >= MIN_CONFIDENCE
            && item.octaveWarning !== true);
    }

    function percentile(values, ratio) {
        const index = Math.max(0, Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1));
        return values[index];
    }

    function summarizeRange(frames) {
        const all = Array.isArray(frames) ? frames : [];
        const usable = usableFrames(all);
        const values = usable.map((item) => item.midi).sort((left, right) => left - right);
        const warnings = all.some((item) => item && item.octaveWarning === true);
        if (!values.length) {
            return {
                lowestMidi: null,
                highestMidi: null,
                comfortableLowMidi: null,
                comfortableHighMidi: null,
                voicedRatio: 0,
                octaveWarning: warnings,
            };
        }
        return {
            lowestMidi: values[0],
            highestMidi: values[values.length - 1],
            // ponytail: middle-60% percentile band; use a labelled voice sample before making it adaptive.
            comfortableLowMidi: percentile(values, 0.2),
            comfortableHighMidi: percentile(values, 0.8),
            voicedRatio: round(usable.length / Math.max(1, all.length), 3),
            octaveWarning: warnings,
        };
    }

    function noRecommendation(reason = '無法可靠建議') {
        return { recommendedSemitones: null, candidates: [], alternatives: [], reason, confidence: 0 };
    }

    function candidateScore(values, range, semitones) {
        const low = range.comfortableLowMidi;
        const high = range.comfortableHighMidi;
        const absoluteLow = range.lowestMidi;
        const absoluteHigh = range.highestMidi;
        const shifted = values.map((value) => value + semitones);
        let outsideCount = 0;
        let outsideLowCount = 0;
        let outsideHighCount = 0;
        shifted.forEach((value) => {
            if (value < low) { outsideCount += 1; outsideLowCount += 1; }
            else if (value > high) { outsideCount += 1; outsideHighCount += 1; }
        });
        const absoluteOutsideCount = shifted.filter((value) => value < absoluteLow || value > absoluteHigh).length;
        const outsideLow = Math.max(0, low - Math.min(...shifted));
        const outsideHigh = Math.max(0, Math.max(...shifted) - high);
        const absoluteOutsideLow = Math.max(0, absoluteLow - Math.min(...shifted));
        const absoluteOutsideHigh = Math.max(0, Math.max(...shifted) - absoluteHigh);
        const outsideRatio = outsideCount / values.length;
        const absoluteOutsideRatio = absoluteOutsideCount / values.length;
        const score = round(
            outsideCount * 100
            + outsideLow * 2
            + outsideHigh
            + absoluteOutsideRatio * 10
            + absoluteOutsideLow * 0.5
            + absoluteOutsideHigh * 0.5,
            3,
        );
        return {
            semitones,
            outsideCount,
            outsideRatio: round(outsideRatio),
            absoluteOutsideCount,
            absoluteOutsideRatio: round(absoluteOutsideRatio),
            outsideLowCount,
            outsideHighCount,
            shiftedLowestMidi: Math.min(...shifted),
            shiftedHighestMidi: Math.max(...shifted),
            score,
        };
    }

    function recommendKey(referenceFrames, range, options = {}) {
        const usable = usableFrames(referenceFrames);
        const minFrames = Number.isInteger(options.minUsableFrames) ? options.minUsableFrames : 3;
        if (usable.length < minFrames
            || !range
            || finite(range.comfortableLowMidi) === null
            || finite(range.comfortableHighMidi) === null
            || range.octaveWarning === true) return noRecommendation();

        const values = usable.map((item) => item.midi);
        const candidates = [];
        for (let semitones = -6; semitones <= 6; semitones += 1) {
            candidates.push(candidateScore(values, range, semitones));
        }
        const ranked = candidates.slice().sort((left, right) => (
            left.score - right.score
            || Math.abs(left.semitones) - Math.abs(right.semitones)
            || left.semitones - right.semitones
        ));
        const best = ranked[0];
        const alternatives = ranked.filter((item) => item.semitones !== best.semitones).slice(0, 2);
        const confidence = round((usable.reduce((sum, item) => sum + item.confidence, 0) / usable.length)
            * Math.min(1, usable.length / 5), 3);
        return {
            recommendedSemitones: best.semitones,
            candidates,
            alternatives,
            reason: `${best.semitones > 0 ? '+' : ''}${best.semitones} Key 可減少舒適音域外的音符`,
            confidence,
        };
    }

    function shiftPitchFrames(frames, semitones) {
        const shift = finite(semitones) ?? 0;
        return (Array.isArray(frames) ? frames : []).map((item) => {
            const midi = finite(item && item.midi);
            if (midi === null) return { ...item };
            const shiftedMidi = midi + shift;
            const shiftedHz = midiToHz(shiftedMidi);
            return {
                ...item,
                midi: round(shiftedMidi, 3),
                hz: round(shiftedHz, 3),
                cents: round(hzToCents(shiftedHz, Math.round(shiftedMidi)), 2),
            };
        });
    }

    return {
        MIN_CONFIDENCE,
        hzToMidi,
        midiToHz,
        hzToCents,
        detectPitchFrame,
        summarizeRange,
        recommendKey,
        shiftPitchFrames,
    };
}));
