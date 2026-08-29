'use strict';

(function (root, factory) {
    if (typeof module !== 'undefined' && module.exports) module.exports = factory();
    else root.KanaricKaraokeClock = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const EVENT_TYPES = Object.freeze([
        'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error',
    ]);

    function boundedPosition(positionMs, durationMs) {
        const value = Number(positionMs);
        if (!Number.isFinite(value) || value < 0) throw new TypeError('positionMs must be non-negative');
        return durationMs > 0 ? Math.min(value, durationMs) : value;
    }

    function secondsToMs(value) {
        const seconds = Number(value);
        return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
    }

    function typedError(value) {
        if (value && typeof value === 'object'
            && typeof value.domain === 'string' && typeof value.code === 'string') {
            return value;
        }
        return {
            domain: 'system',
            code: 'media-monitor',
            message: String(value || 'unknown'),
        };
    }

    function mediaStateToEvent(state = {}) {
        const type = EVENT_TYPES.includes(state.timing_event) ? state.timing_event : 'load';
        const event = {
            type,
            revision: Number.isInteger(state.timing_revision) ? state.timing_revision : 0,
            order: Number.isInteger(state.timing_order) ? state.timing_order : 0,
            trackId: `${state.artist || ''}|||${state.title || ''}`,
            positionMs: secondsToMs(state.position),
            durationMs: secondsToMs(state.duration),
        };
        if (type === 'load' || type === 'restart') event.playing = !!state.is_playing;
        if (type === 'error') event.error = typedError(state.error);
        return event;
    }

    function sessionStateToEvent(session = {}) {
        const transport = session.transport || {};
        const song = session.song || {};
        const durationMs = Math.max(0, Math.round(Number(transport.durationMs) || 0));
        const positionMs = Math.min(
            Math.max(0, Math.round(Number(transport.positionMs) || 0)),
            durationMs || Infinity,
        );
        const state = session.state;
        let type = 'stop';
        if (state === 'PREPARING' || state === 'INTRO') type = 'load';
        else if (state === 'PLAYING') type = 'play';
        else if (state === 'PAUSED') type = 'pause';
        else if (state === 'ERROR') type = 'error';
        else if (state === 'ENDING' && durationMs > 0 && positionMs >= durationMs) type = 'ended';

        const event = {
            type,
            revision: Number.isInteger(session.revision) ? session.revision : 0,
            order: 0,
            trackId: song.id || `${song.artist || ''}|||${song.title || ''}`,
            positionMs,
            durationMs,
        };
        if (type === 'load' || type === 'play') event.playing = !!transport.isPlaying;
        if (type === 'error') {
            event.error = transport.error || {
                domain: 'player',
                code: 'player-error',
                message: 'audio playback failed',
            };
        }
        return event;
    }

    class KaraokeClock {
        constructor({ now = () => performance.now() } = {}) {
            if (typeof now !== 'function') throw new TypeError('now must be a function');
            this.now = now;
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
            this.anchorAtMs = this.now();
            this.lastCorrectionMs = 0;
            this.rejectedEvents = [];
        }

        seed({ trackId = null, positionMs = 0, durationMs = 0, isPlaying = false } = {}) {
            this.state.trackId = trackId;
            this.state.durationMs = boundedPosition(durationMs, 0);
            this.state.isPlaying = !!isPlaying;
            this.state.status = this.state.isPlaying ? 'playing' : 'paused';
            this.state.error = null;
            this._setPosition(positionMs);
        }

        reanchor(positionMs, isPlaying = this.state.isPlaying) {
            this.state.isPlaying = !!isPlaying;
            this.state.status = this.state.isPlaying ? 'playing' : 'paused';
            this.state.error = null;
            this._setPosition(positionMs);
        }

        _sync() {
            const nowMs = this.now();
            const elapsedMs = this.state.isPlaying ? Math.max(0, nowMs - this.anchorAtMs) : 0;
            const projectedMs = boundedPosition(
                this.anchorPositionMs + elapsedMs,
                this.state.durationMs,
            );
            this.anchorPositionMs = projectedMs;
            this.anchorAtMs = nowMs;
            this.state.positionMs = projectedMs;
            return projectedMs;
        }

        _setPosition(positionMs) {
            this.anchorPositionMs = boundedPosition(positionMs, this.state.durationMs);
            this.anchorAtMs = this.now();
            this.state.positionMs = this.anchorPositionMs;
        }

        _accept(event) {
            if (!event || !EVENT_TYPES.includes(event.type)) throw new TypeError('unknown event type');
            if (!Number.isInteger(event.revision) || event.revision < 0) throw new TypeError('revision must be non-negative integer');
            if (!Number.isInteger(event.order) || event.order < 0) throw new TypeError('order must be non-negative integer');

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
            if (!this._accept(event)) return { accepted: false, state: this.snapshot() };

            const beforeMs = this._sync();
            this.state.revision = event.revision;
            this.state.order = event.order;

            switch (event.type) {
            case 'load':
                this.state.status = event.playing ? 'playing' : 'paused';
                this.state.trackId = event.trackId || null;
                this.state.durationMs = event.durationMs || 0;
                this.state.isPlaying = !!event.playing;
                this.state.error = null;
                this._setPosition(event.positionMs || 0);
                break;
            case 'play': {
                if (event.trackId) this.state.trackId = event.trackId;
                if (event.durationMs !== undefined) this.state.durationMs = event.durationMs || 0;
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
                this._setPosition(event.positionMs === undefined ? beforeMs : event.positionMs);
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
                if (event.durationMs > 0) this.state.durationMs = event.durationMs;
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

    return { EVENT_TYPES, KaraokeClock, mediaStateToEvent, sessionStateToEvent };
}));
