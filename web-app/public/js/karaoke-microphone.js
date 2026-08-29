'use strict';

(function expose(root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.KanaricKaraokeMicrophone = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function createMicrophoneModule() {
    const STATES = Object.freeze([
        'supported', 'unsupported', 'requesting', 'running',
        'denied', 'disconnected', 'stopped', 'error',
    ]);

    function finite(value) {
        if (value === null || value === undefined || value === '') return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function clamp(value, min = 0, max = 1) {
        const number = finite(value);
        return number === null ? min : Math.min(max, Math.max(min, number));
    }

    function classifyLatency(roundTripMs) {
        const measuredMs = finite(roundTripMs);
        if (measuredMs === null || measuredMs < 0) return { status: 'unknown', evidence: 'none' };
        if (measuredMs < 30) return { status: 'target', evidence: 'measured' };
        if (measuredMs <= 50) return { status: 'acceptable', evidence: 'measured' };
        return { status: 'warning', evidence: 'measured' };
    }

    function normalizeError(error) {
        const name = error && typeof error.name === 'string' ? error.name : '';
        const code = error && typeof error.code === 'string' ? error.code : '';
        if (code && error.domain === 'microphone') return error;
        const known = {
            NotFoundError: ['microphone-missing', 'microphone device not found'],
            PermissionDeniedError: ['microphone-permission-denied', 'microphone permission denied'],
            NotAllowedError: ['microphone-permission-denied', 'microphone permission denied'],
            OverconstrainedError: ['unsupported-format', 'microphone format is unsupported'],
            NotReadableError: ['microphone-unavailable', 'microphone device is unavailable'],
        };
        const [knownCode, knownMessage] = known[name] || [];
        return {
            domain: 'microphone',
            code: knownCode || code || 'microphone-error',
            message: knownMessage || (error && error.message) || 'microphone unavailable',
        };
    }

    function runtimeLatency(context) {
        const baseLatency = finite(context && context.baseLatency);
        const outputLatency = finite(context && context.outputLatency);
        const baseLatencyMs = baseLatency === null ? null : baseLatency * 1000;
        const outputLatencyMs = outputLatency === null ? null : outputLatency * 1000;
        const reportedMs = baseLatencyMs === null && outputLatencyMs === null
            ? null : (baseLatencyMs || 0) + (outputLatencyMs || 0);
        return {
            status: reportedMs === null ? 'unknown' : 'unverified',
            evidence: reportedMs === null ? 'none' : 'runtime-reported',
            baseLatencyMs,
            outputLatencyMs,
            reportedMs,
            measuredMs: null,
        };
    }

    function formatMismatch(actual, expected) {
        if (!actual || !expected) return null;
        if (expected.sampleRate && actual.sampleRate && Number(actual.sampleRate) !== Number(expected.sampleRate)) {
            return { field: 'sampleRate', actual: actual.sampleRate, expected: expected.sampleRate };
        }
        if (expected.channelCount && actual.channelCount && Number(actual.channelCount) !== Number(expected.channelCount)) {
            return { field: 'channelCount', actual: actual.channelCount, expected: expected.channelCount };
        }
        if (expected.sampleFormat && actual.sampleFormat && actual.sampleFormat !== expected.sampleFormat) {
            return { field: 'sampleFormat', actual: actual.sampleFormat, expected: expected.sampleFormat };
        }
        return null;
    }

    function makeReverbBuffer(context) {
        if (!context || typeof context.createBuffer !== 'function') return null;
        const sampleRate = Number(context.sampleRate) || 48000;
        const length = Math.max(1, Math.round(sampleRate * 0.25));
        const buffer = context.createBuffer(2, length, sampleRate);
        if (!buffer || typeof buffer.getChannelData !== 'function') return buffer;
        for (let channel = 0; channel < 2; channel += 1) {
            const data = buffer.getChannelData(channel);
            for (let index = 0; index < data.length; index += 1) {
                const noise = ((index * 17 + channel * 31) % 101) / 100 - 0.5;
                data[index] = noise * Math.exp(-4 * index / data.length);
            }
        }
        return buffer;
    }

    class BrowserMicrophoneEngine {
        constructor(options = {}) {
            const browser = typeof globalThis !== 'undefined' ? globalThis : {};
            this.mediaDevices = options.mediaDevices
                || (browser.navigator && browser.navigator.mediaDevices);
            this.AudioContext = options.AudioContext
                || browser.AudioContext || browser.webkitAudioContext;
            this.outputElement = options.outputElement || null;
            this.now = typeof options.now === 'function' ? options.now : () => Date.now();
            this.listeners = new Set();
            this.state = this.mediaDevices
                && typeof this.mediaDevices.getUserMedia === 'function'
                && typeof this.AudioContext === 'function'
                ? 'supported' : 'unsupported';
            this.health = 'ok';
            this.error = null;
            this.stream = null;
            this.track = null;
            this.context = null;
            this.graph = null;
            this.lastOptions = {};
            this.inputDeviceId = '';
            this.outputDeviceId = '';
            this.outputSupported = null;
            this.outputError = null;
            this.gain = 1;
            this.muted = false;
            this.monitoring = true;
            this.effects = { echo: 0, reverb: 0 };
            this.format = null;
            this.buffer = { requestedFrames: null, underruns: 0, lastUnderrunAtMs: null };
            this.latency = classifyLatency(null);
            this.latency = {
                ...this.latency,
                measuredMs: null,
                baseLatencyMs: null,
                outputLatencyMs: null,
                reportedMs: null,
            };
        }

        on(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        _emit(type, extra = {}) {
            const event = { type, ...this.snapshot(), ...extra };
            this.listeners.forEach((listener) => listener(event));
            return event;
        }

        snapshot() {
            return {
                state: this.state,
                health: this.health,
                enabled: this.state === 'running',
                inputDeviceId: this.inputDeviceId,
                outputDeviceId: this.outputDeviceId,
                output: {
                    deviceId: this.outputDeviceId,
                    supported: this.outputSupported,
                    verified: false,
                    error: this.outputError,
                },
                gain: this.gain,
                muted: this.muted,
                monitoring: this.monitoring,
                effects: { ...this.effects },
                format: this.format ? { ...this.format } : null,
                buffer: { ...this.buffer },
                latency: { ...this.latency },
                error: this.error,
                paths: {
                    dryAnalysisId: this.graph && this.graph.dryDestination
                        ? this.graph.dryDestination.stream.id : null,
                    processedMonitoringId: this.graph && this.graph.monitorDestination
                        ? this.graph.monitorDestination.stream.id : null,
                },
            };
        }

        getStreams() {
            return {
                dryAnalysis: this.graph ? this.graph.dryDestination.stream : null,
                processedMonitoring: this.graph ? this.graph.monitorDestination.stream : null,
            };
        }

        getTrack() { return this.track; }

        async listDevices() {
            if (!this.mediaDevices || typeof this.mediaDevices.enumerateDevices !== 'function') return [];
            try { return await this.mediaDevices.enumerateDevices(); } catch (error) { return []; }
        }

        async start(options = {}) {
            this.lastOptions = {
                ...options,
                format: options.format ? { ...options.format } : options.format,
            };
            this.inputDeviceId = options.inputDeviceId ? String(options.inputDeviceId) : '';
            this.outputDeviceId = options.outputDeviceId ? String(options.outputDeviceId) : '';
            this.buffer = {
                requestedFrames: Number.isInteger(options.bufferSize) && options.bufferSize > 0
                    ? options.bufferSize : null,
                underruns: 0,
                lastUnderrunAtMs: null,
            };
            this.error = null;
            this.health = 'ok';
            this.state = 'requesting';
            this._emit('requesting');
            this._teardown();

            if (!this.mediaDevices || typeof this.mediaDevices.getUserMedia !== 'function') {
                return this._fail({ domain: 'microphone', code: 'microphone-unsupported', message: 'microphone input is unsupported' }, 'unsupported');
            }

            const audio = this.inputDeviceId
                ? { deviceId: { exact: this.inputDeviceId } }
                : true;
            let stream;
            try {
                stream = await this.mediaDevices.getUserMedia({ audio, video: false });
            } catch (error) {
                const normalized = normalizeError(error);
                const state = normalized.code === 'microphone-missing' ? 'disconnected'
                    : normalized.code === 'microphone-permission-denied' ? 'denied' : 'error';
                return this._fail(normalized, state);
            }

            const track = stream && typeof stream.getAudioTracks === 'function'
                ? stream.getAudioTracks()[0] : null;
            if (!track) {
                this._stopStream(stream);
                return this._fail({ domain: 'microphone', code: 'microphone-missing', message: 'microphone audio track is missing' }, 'disconnected');
            }
            this.stream = stream;
            this.track = track;
            const actualFormat = typeof track.getSettings === 'function' ? track.getSettings() : {};
            const mismatch = formatMismatch(actualFormat, options.format);
            if (mismatch) {
                this._stopStream();
                return this._fail({
                    domain: 'microphone',
                    code: 'unsupported-format',
                    message: `microphone ${mismatch.field} ${mismatch.actual} is not ${mismatch.expected}`,
                }, 'unsupported');
            }
            this.format = Object.keys(actualFormat).length ? { ...actualFormat } : null;
            if (typeof track.addEventListener === 'function') {
                track.addEventListener('ended', () => {
                    if (this.track !== track || this.state !== 'running') return;
                    this._teardown();
                    this.error = { domain: 'microphone', code: 'device-disconnected', message: 'microphone device disconnected' };
                    this.health = 'degraded';
                    this.state = 'disconnected';
                    this._emit('device-disconnected');
                });
            }

            try {
                this._buildGraph(stream);
            } catch (error) {
                this._stopStream();
                return this._fail(normalizeError(error), 'unsupported');
            }
            this.latency = runtimeLatency(this.context);
            this.state = 'running';
            this._applyGraphSettings();
            this.outputSupported = !!((this.context && typeof this.context.setSinkId === 'function')
                || (this.outputElement && typeof this.outputElement.setSinkId === 'function'));
            this._emit('running');
            if (this.outputDeviceId) await this.setOutputDevice(this.outputDeviceId);
            return this.snapshot();
        }

        async reconnect() { return this.start(this.lastOptions); }

        async setInputDevice(deviceId) {
            return this.start({ ...this.lastOptions, inputDeviceId: deviceId || '' });
        }

        async setOutputDevice(deviceId) {
            const id = deviceId == null ? '' : String(deviceId);
            this.outputDeviceId = id;
            this.outputError = null;
            const setter = this.context && typeof this.context.setSinkId === 'function'
                ? this.context.setSinkId.bind(this.context)
                : this.outputElement && typeof this.outputElement.setSinkId === 'function'
                    ? this.outputElement.setSinkId.bind(this.outputElement) : null;
            this.outputSupported = !!setter;
            if (!setter) {
                this.outputError = { domain: 'microphone', code: 'output-device-unsupported', message: 'output device selection is unsupported' };
                this._emit('output-device');
                return { ...this.snapshot(), supported: false, error: this.outputError };
            }
            try {
                await setter(id);
                this._emit('output-device');
                return { ...this.snapshot(), supported: true, deviceId: id };
            } catch (error) {
                this.outputError = normalizeError(error);
                this._emit('output-device');
                return { ...this.snapshot(), supported: false, deviceId: id, error: this.outputError };
            }
        }

        setGain(value) {
            this.gain = clamp(value);
            this._applyGraphSettings();
            return this._emit('settings');
        }

        setMuted(value) {
            this.muted = !!value;
            this._applyGraphSettings();
            return this._emit('settings');
        }

        setMonitoring(value) {
            this.monitoring = !!value;
            this._applyGraphSettings();
            return this._emit('settings');
        }

        setEffects(effects = {}) {
            this.effects = {
                echo: clamp(effects.echo ?? this.effects.echo),
                reverb: clamp(effects.reverb ?? this.effects.reverb),
            };
            this._applyGraphSettings();
            return this._emit('settings');
        }

        recordLatency(inputTimeMs, outputTimeMs) {
            const input = finite(inputTimeMs);
            const output = finite(outputTimeMs);
            const measuredMs = input === null || output === null || output < input ? null : output - input;
            this.latency = { ...this.latency, ...classifyLatency(measuredMs), measuredMs, measuredAtMs: this.now() };
            return this._emit('latency');
        }

        reportUnderrun(details = {}) {
            this.buffer.underruns += 1;
            this.buffer.lastUnderrunAtMs = this.now();
            this.health = 'degraded';
            return this._emit('underrun', { details });
        }

        stop() {
            this._teardown();
            this.error = null;
            this.health = 'ok';
            this.state = 'stopped';
            return this._emit('stopped');
        }

        _buildGraph(stream) {
            if (typeof this.AudioContext !== 'function') throw new Error('Web Audio is unsupported');
            this.context = new this.AudioContext();
            const source = this.context.createMediaStreamSource(stream);
            const dryAnalyser = this.context.createAnalyser();
            const dryDestination = this.context.createMediaStreamDestination();
            const inputGain = this.context.createGain();
            const monitorLevel = this.context.createGain();
            const muteGain = this.context.createGain();
            const monitorMix = this.context.createGain();
            const echoDelay = this.context.createDelay(1);
            const echoFeedback = this.context.createGain();
            const echoWet = this.context.createGain();
            const reverb = this.context.createConvolver();
            const reverbWet = this.context.createGain();
            const monitorDestination = this.context.createMediaStreamDestination();

            source.connect(dryAnalyser);
            dryAnalyser.connect(dryDestination);
            source.connect(inputGain);
            inputGain.connect(monitorLevel);
            monitorLevel.connect(muteGain);
            muteGain.connect(monitorMix);
            muteGain.connect(echoDelay);
            echoDelay.connect(echoWet);
            echoWet.connect(monitorMix);
            echoDelay.connect(echoFeedback);
            echoFeedback.connect(echoDelay);
            muteGain.connect(reverb);
            reverb.connect(reverbWet);
            reverbWet.connect(monitorMix);
            monitorMix.connect(monitorDestination);
            if (this.outputElement) {
                this.outputElement.srcObject = monitorDestination.stream;
                this.outputElement.autoplay = true;
                this.outputElement.muted = false;
                if (typeof this.outputElement.play === 'function') {
                    const playResult = this.outputElement.play();
                    if (playResult && typeof playResult.catch === 'function') playResult.catch(() => {});
                }
            } else {
                monitorMix.connect(this.context.destination);
            }
            reverb.buffer = makeReverbBuffer(this.context);
            this.graph = {
                dryAnalyser, dryDestination, inputGain, monitorLevel, muteGain,
                monitorMix, echoDelay, echoFeedback, echoWet, reverb, reverbWet,
                monitorDestination,
            };
        }

        _applyGraphSettings() {
            if (!this.graph) return;
            this.graph.inputGain.gain.value = this.gain;
            this.graph.monitorLevel.gain.value = this.monitoring ? 1 : 0;
            this.graph.muteGain.gain.value = this.muted ? 0 : 1;
            this.graph.echoWet.gain.value = this.effects.echo;
            this.graph.echoFeedback.gain.value = this.effects.echo * 0.35;
            this.graph.reverbWet.gain.value = this.effects.reverb;
            this.graph.echoDelay.delayTime.value = 0.18;
        }

        _fail(error, state = 'error') {
            this.error = error;
            this.health = 'degraded';
            this.state = STATES.includes(state) ? state : 'error';
            return this._emit('error');
        }

        _stopStream(stream = this.stream) {
            if (!stream || typeof stream.getAudioTracks !== 'function') return;
            for (const track of stream.getAudioTracks()) {
                try { track.stop(); } catch (error) {}
            }
            if (stream === this.stream) {
                this.stream = null;
                this.track = null;
            }
        }

        _teardown() {
            this._stopStream();
            if (this.outputElement) this.outputElement.srcObject = null;
            if (this.graph) {
                Object.values(this.graph).forEach((node) => {
                    if (node && typeof node.disconnect === 'function') {
                        try { node.disconnect(); } catch (error) {}
                    }
                });
            }
            if (this.context && typeof this.context.close === 'function') {
                try { this.context.close(); } catch (error) {}
            }
            this.context = null;
            this.graph = null;
        }
    }

    return { BrowserMicrophoneEngine, STATES, classifyLatency, normalizeError };
}));
