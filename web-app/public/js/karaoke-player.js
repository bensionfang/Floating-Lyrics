'use strict';

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.KanaricKaraokePlayer = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const PLAYER_EVENT_TYPES = Object.freeze([
        'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error',
    ]);

    function integerMs(value) {
        const number = Number(value);
        return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
    }

    function normalizeError(error) {
        if (error && typeof error === 'object'
            && typeof error.domain === 'string' && typeof error.code === 'string') {
            return error;
        }
        const name = error && typeof error.name === 'string' ? error.name.toLowerCase() : '';
        const mediaCode = error && Number.isInteger(error.code) && error.code > 0
            ? `media-error-${error.code}` : '';
        return {
            domain: 'player',
            code: mediaCode || (name ? `audio-${name}` : 'audio-error'),
            message: (error && typeof error.message === 'string' && error.message)
                || 'audio playback failed',
        };
    }

    class BrowserAudioKaraokePlayer {
        constructor(audio) {
            if (!audio || typeof audio.addEventListener !== 'function') {
                throw new TypeError('audio element is required');
            }
            this.audio = audio;
            this.song = null;
            this.state = 'idle';
            this.revision = -1;
            this.order = -1;
            this.listeners = new Set();
            this._ignorePauseEvent = false;
            this._ignorePauseTimer = null;
            this._bindAudioEvents();
        }

        _suppressNativePause() {
            this._ignorePauseEvent = true;
            clearTimeout(this._ignorePauseTimer);
            this._ignorePauseTimer = setTimeout(() => {
                this._ignorePauseEvent = false;
                this._ignorePauseTimer = null;
            }, 250);
        }

        _bindAudioEvents() {
            this.audio.addEventListener('loadedmetadata', () => {
                if (this.state === 'error') return;
                this.state = 'paused';
                this._emit('load');
            });
            this.audio.addEventListener('play', () => {
                this.state = 'playing';
                this._emit('play');
            });
            this.audio.addEventListener('pause', () => {
                if (this._ignorePauseEvent || ['stopped', 'ended', 'error'].includes(this.state)) return;
                this.state = 'paused';
                this._emit('pause');
            });
            this.audio.addEventListener('ended', () => {
                this.state = 'ended';
                this._emit('ended');
            });
            this.audio.addEventListener('error', () => {
                this.state = 'error';
                this._emit('error', { error: normalizeError(this.audio.error) });
            });
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
            this.listeners.forEach((listener) => listener(event));
            return event;
        }

        on(listener) {
            if (typeof listener !== 'function') throw new TypeError('listener must be a function');
            this.listeners.add(listener);
            return () => this.listeners.delete(listener);
        }

        load(song) {
            if (!song || typeof song.src !== 'string' || !song.src) {
                throw new TypeError('song.src is required');
            }
            this._suppressNativePause();
            this.audio.pause();
            this.song = { ...song };
            this.revision += 1;
            this.order = -1;
            this.state = 'paused';
            this.audio.src = song.src;
            this.audio.load();
            return this._emit('load');
        }

        play() {
            if (this.state === 'ended') this.seek(0);
            const result = this.audio.play();
            if (result && typeof result.catch === 'function') {
                return result.catch((error) => this._fail(error));
            }
            return result;
        }

        pause() {
            this._suppressNativePause();
            this.audio.pause();
            this.state = 'paused';
            return this._emit('pause');
        }

        seek(positionMs) {
            if (!Number.isFinite(positionMs) || positionMs < 0) {
                throw new TypeError('positionMs must be non-negative');
            }
            const durationMs = this.getDuration();
            const targetMs = durationMs > 0 ? Math.min(Math.round(positionMs), durationMs) : Math.round(positionMs);
            this.audio.currentTime = targetMs / 1000;
            if (this.state === 'ended') this.state = 'paused';
            return this._emit('seek');
        }

        restart() {
            const wasPlaying = this.state === 'playing';
            this.seek(0);
            this.state = wasPlaying ? 'playing' : 'paused';
            return this._emit('restart');
        }

        stop() {
            this._ignorePauseEvent = true;
            try { this.audio.pause(); } finally { this._ignorePauseEvent = false; }
            this.audio.currentTime = 0;
            this.state = 'stopped';
            return this._emit('stop');
        }

        setKey(semitones) {
            if (!Number.isInteger(semitones)) throw new TypeError('semitones must be an integer');
            return {
                supported: false,
                semitones,
                error: {
                    domain: 'player',
                    code: 'key-shift-unsupported',
                    message: 'Browser audio does not provide pitch-preserving key shift',
                },
            };
        }

        setTempo(rate) {
            if (!Number.isFinite(rate) || rate <= 0) throw new TypeError('rate must be positive');
            this.audio.playbackRate = rate;
            return rate;
        }

        async setOutputDevice(deviceId) {
            if (typeof this.audio.setSinkId !== 'function') {
                return { supported: false, error: { domain: 'player', code: 'output-device-unsupported' } };
            }
            await this.audio.setSinkId(String(deviceId));
            return { supported: true, deviceId: String(deviceId) };
        }

        getPosition() {
            const positionMs = integerMs(Number(this.audio.currentTime) * 1000);
            const durationMs = this.getDuration();
            return durationMs > 0 ? Math.min(positionMs, durationMs) : positionMs;
        }

        getDuration() { return integerMs(Number(this.audio.duration) * 1000); }
        getState() { return this.state; }

        _fail(error) {
            this.state = 'error';
            return this._emit('error', { error: normalizeError(error) });
        }
    }

    return { BrowserAudioKaraokePlayer, PLAYER_EVENT_TYPES, normalizeError };
}));
