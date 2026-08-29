'use strict';

const crypto = require('node:crypto');

const STATES = Object.freeze({
    IDLE: 'IDLE',
    PREPARING: 'PREPARING',
    INTRO: 'INTRO',
    PLAYING: 'PLAYING',
    PAUSED: 'PAUSED',
    ENDING: 'ENDING',
    RESULT: 'RESULT',
    TRANSITION: 'TRANSITION',
    ERROR: 'ERROR',
});

const SESSION_ROLES = Object.freeze(['stage', 'host', 'test-client']);

const TRANSITIONS = Object.freeze({
    [STATES.IDLE]: { [STATES.PREPARING]: ['start'] },
    [STATES.PREPARING]: {
        [STATES.INTRO]: ['ready'],
        [STATES.ENDING]: ['skip'],
        [STATES.IDLE]: ['cancel'],
    },
    [STATES.INTRO]: {
        [STATES.PLAYING]: ['play'],
        [STATES.ENDING]: ['skip'],
        [STATES.INTRO]: ['seek'],
    },
    [STATES.PLAYING]: {
        [STATES.PAUSED]: ['pause'],
        [STATES.PLAYING]: ['restart', 'seek'],
        [STATES.ENDING]: ['end', 'skip'],
    },
    [STATES.PAUSED]: {
        [STATES.PLAYING]: ['resume'],
        [STATES.PAUSED]: ['restart', 'seek'],
        [STATES.ENDING]: ['end', 'skip'],
    },
    [STATES.ENDING]: {
        [STATES.RESULT]: ['result'],
        [STATES.TRANSITION]: ['transition'],
    },
    [STATES.RESULT]: { [STATES.TRANSITION]: ['transition'] },
    [STATES.TRANSITION]: {
        [STATES.PREPARING]: ['next'],
        [STATES.IDLE]: ['idle'],
    },
    [STATES.ERROR]: { [STATES.IDLE]: ['reset'] },
});

function integerMs(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function normalizeSong(song) {
    if (!song || typeof song !== 'object' || !song.id) return null;
    return {
        id: String(song.id),
        title: typeof song.title === 'string' ? song.title : '',
        artist: typeof song.artist === 'string' ? song.artist : '',
        durationMs: integerMs(song.durationMs),
    };
}

function normalizeQueue(queue) {
    const items = Array.isArray(queue && queue.items) ? queue.items.map((item) => ({ ...item })) : [];
    return {
        revision: Number.isInteger(queue && queue.revision) ? queue.revision : 0,
        currentQueueId: queue && queue.currentQueueId ? String(queue.currentQueueId) : (items[0] ? items[0].queueId : null),
        hasNext: queue && queue.hasNext === undefined ? items.length > 1 : !!queue.hasNext,
        items,
    };
}

function normalizePlayerError(error) {
    if (error && typeof error === 'object' && typeof error.code === 'string') {
        return {
            domain: 'player',
            code: error.code,
            message: typeof error.message === 'string' && error.message
                ? error.message : 'audio playback failed',
        };
    }
    if (error instanceof Error) {
        return { domain: 'player', code: 'player-error', message: error.message || 'audio playback failed' };
    }
    if (typeof error === 'string' && error) {
        return { domain: 'player', code: 'player-error', message: error };
    }
    return { domain: 'player', code: 'player-error', message: 'audio playback failed' };
}

function adaptPlayerEvent(event, sessionId) {
    if (!event || typeof event !== 'object') throw new TypeError('player event is required');
    return {
        ...event,
        sessionId,
        positionMs: integerMs(event.positionMs),
        durationMs: integerMs(event.durationMs),
        error: event.error === undefined ? undefined : normalizePlayerError(event.error),
    };
}

function projectKaraokeState(canonical, role = 'test-client') {
    if (!SESSION_ROLES.includes(role)) throw new TypeError(`unknown Karaoke role: ${role}`);
    return {
        role,
        sessionId: canonical.sessionId,
        revision: canonical.revision,
        state: canonical.state,
        song: clone(canonical.song),
        transport: clone(canonical.transport),
        queue: clone(canonical.queue),
        remoteCredentials: clone(canonical.remoteCredentials),
    };
}

function makeKaraokeMessage(canonical, role = 'test-client') {
    const state = projectKaraokeState(canonical, role);
    return {
        type: 'karaoke_session',
        sessionId: state.sessionId,
        revision: state.revision,
        state,
    };
}

function makeKaraokeResultMessage(result, role = 'test-client') {
    const message = makeKaraokeMessage(result.state, role);
    message.type = 'karaoke_session_result';
    message.accepted = !!result.accepted;
    if (result.reason) message.reason = result.reason;
    return message;
}

function handleKaraokeMessage(session, message, queue) {
    if (!message || typeof message !== 'object') return null;
    if (message.type && message.type.startsWith('karaoke_queue_')) {
        return queue ? queue.handleMessage(message) : null;
    }
    if (message.type === 'karaoke_session_transition') {
        return session.transition(message.sourceState, message.targetState, message.details || {});
    }
    if (message.type === 'karaoke_player_event') {
        try {
            const event = message.event;
            return session.applyPlayerEvent(adaptPlayerEvent(
                event, message.sessionId || (event && event.sessionId),
            ));
        } catch (e) {
            return { accepted: false, reason: 'invalid-player-event', state: session.snapshot() };
        }
    }
    return null;
}

class KaraokeSession {
    constructor(options = {}) {
        this._idFactory = options.idFactory || (() => crypto.randomUUID());
        this._invalidateSessionCredentials = options.invalidateSessionCredentials || (() => {});
        this._playerCursor = { revision: -1, order: -1 };
        this._state = {
            sessionId: null,
            revision: 0,
            state: STATES.IDLE,
            song: null,
            transport: { positionMs: 0, durationMs: 0, isPlaying: false, error: null },
            queue: { hasNext: false },
            remoteCredentials: { valid: false, epoch: 0 },
        };
    }

    snapshot() { return clone(this._state); }

    _result(accepted, reason) {
        const result = { accepted, state: this.snapshot() };
        if (reason) result.reason = reason;
        return result;
    }

    _invalidateCredentials(sessionId) {
        if (!sessionId || !this._state.remoteCredentials.valid) return;
        this._state.remoteCredentials = {
            valid: false,
            epoch: this._state.remoteCredentials.epoch + 1,
        };
        try { this._invalidateSessionCredentials(sessionId); } catch (e) { /* boundary is best effort */ }
    }

    _resetPlayerCursor() { this._playerCursor = { revision: -1, order: -1 }; }

    _transportForState(state, details = {}) {
        const current = this._state.transport;
        const patch = details.transport || {};
        const playing = state === STATES.PLAYING;
        const transport = {
            positionMs: integerMs(patch.positionMs === undefined ? current.positionMs : patch.positionMs),
            durationMs: integerMs(patch.durationMs === undefined ? current.durationMs : patch.durationMs),
            isPlaying: playing,
            error: patch.error === undefined ? (state === STATES.ERROR ? current.error : null) : patch.error,
        };
        if (transport.durationMs > 0) transport.positionMs = Math.min(transport.positionMs, transport.durationMs);
        return transport;
    }

    transition(sourceState, targetState, details = {}) {
        if (this._state.state !== sourceState) return this._result(false, 'source-state-mismatch');
        const expectedEvents = targetState === STATES.ERROR && sourceState !== STATES.ERROR
            ? ['error']
            : TRANSITIONS[sourceState] && TRANSITIONS[sourceState][targetState];
        const valid = expectedEvents
            && (!details.event || expectedEvents.includes(details.event));
        if (!valid) return this._result(false, 'invalid-transition');
        if (targetState === STATES.PREPARING && !normalizeSong(details.song || this._state.song)) {
            return this._result(false, 'song-required');
        }

        const previousSessionId = this._state.sessionId;
        const nextSong = details.song === undefined ? this._state.song : normalizeSong(details.song);
        if (targetState === STATES.ERROR) {
            this._invalidateCredentials(previousSessionId);
        }
        if (targetState === STATES.IDLE) {
            this._invalidateCredentials(previousSessionId);
        }

        if (sourceState === STATES.IDLE && targetState === STATES.PREPARING) {
            this._state.sessionId = this._idFactory();
            this._state.remoteCredentials = {
                valid: true,
                epoch: this._state.remoteCredentials.epoch,
            };
            this._resetPlayerCursor();
        }
        if (sourceState === STATES.TRANSITION && targetState === STATES.PREPARING) this._resetPlayerCursor();

        this._state.state = targetState;
        this._state.revision += 1;
        this._state.song = targetState === STATES.IDLE ? null : nextSong;
        this._state.transport = this._transportForState(targetState, details);
        if (targetState === STATES.PREPARING && details.song) {
            this._state.song = normalizeSong(details.song);
            this._state.transport = {
                positionMs: 0,
                durationMs: this._state.song.durationMs,
                isPlaying: false,
                error: null,
            };
        }
        if (targetState === STATES.ERROR) {
            this._state.transport.error = normalizePlayerError(details.error);
        }
        if (targetState === STATES.IDLE) {
            this._state.sessionId = null;
            this._state.queue = {
                ...this._state.queue,
                currentQueueId: null,
                hasNext: false,
                items: Array.isArray(this._state.queue.items) ? this._state.queue.items : [],
            };
            this._state.remoteCredentials.valid = false;
        }
        if (targetState === STATES.TRANSITION) {
            this._state.queue = { ...this._state.queue, hasNext: !!details.hasNext };
        }
        return this._result(true);
    }

    start(songData, options = {}) {
        return this.transition(STATES.IDLE, STATES.PREPARING, {
            event: 'start', song: songData, hasNext: !!options.hasNext,
        });
    }

    pause(positionMs) {
        return this.transition(STATES.PLAYING, STATES.PAUSED, {
            event: 'pause', transport: { positionMs },
        });
    }

    restart() {
        const state = this._state.state;
        if (state !== STATES.PLAYING && state !== STATES.PAUSED) return this._result(false, 'invalid-transition');
        return this.transition(state, state, { event: 'restart', transport: { positionMs: 0 } });
    }

    skip() {
        const state = this._state.state;
        if (![STATES.PREPARING, STATES.INTRO, STATES.PLAYING, STATES.PAUSED].includes(state)) {
            return this._result(false, 'invalid-transition');
        }
        return this.transition(state, STATES.ENDING, { event: 'skip' });
    }

    setTransport(patch = {}) {
        if (!this._state.sessionId) return this._result(false, 'no-active-session');
        this._state.revision += 1;
        this._state.transport = this._transportForState(this._state.state, { transport: patch });
        return this._result(true);
    }

    reconcileQueue(queue, currentSong) {
        const nextQueue = normalizeQueue(queue);
        const previousQueueId = this._state.queue.currentQueueId || null;
        const nextQueueId = nextQueue.currentQueueId;
        const nextSong = currentSong ? normalizeSong(currentSong) : null;
        this._state.queue = nextQueue;

        if (previousQueueId === nextQueueId) {
            if (this._state.state === STATES.IDLE) this._state.song = nextSong;
            this._state.revision += 1;
            return this._result(true);
        }

        if (!nextQueueId || !nextSong) {
            if (this._state.state === STATES.IDLE) {
                this._state.song = null;
                this._state.revision += 1;
                return this._result(true);
            }
            if ([STATES.PREPARING, STATES.INTRO, STATES.PLAYING, STATES.PAUSED].includes(this._state.state)) {
                this.skip();
            }
            if (this._state.state === STATES.ENDING) this.transition(STATES.ENDING, STATES.TRANSITION, { event: 'transition', hasNext: false });
            if (this._state.state === STATES.TRANSITION) return this.advance();
            return this._result(false, 'queue-song-required');
        }

        if (this._state.state === STATES.IDLE) {
            this._state.song = nextSong;
            this._state.transport = {
                positionMs: 0,
                durationMs: nextSong.durationMs,
                isPlaying: false,
                error: null,
            };
            this._state.revision += 1;
            return this._result(true);
        }

        if ([STATES.PREPARING, STATES.INTRO, STATES.PLAYING, STATES.PAUSED].includes(this._state.state)) {
            this.skip();
        }
        if (this._state.state === STATES.ENDING) {
            this.transition(STATES.ENDING, STATES.TRANSITION, {
                event: 'transition', hasNext: true,
            });
        }
        if (this._state.state === STATES.TRANSITION) return this.advance(nextSong);
        return this._result(false, 'queue-transition-required');
    }

    advance(nextSong) {
        if (this._state.state !== STATES.TRANSITION) return this._result(false, 'source-state-mismatch');
        if (nextSong) return this.transition(STATES.TRANSITION, STATES.PREPARING, { event: 'next', song: nextSong });
        return this.transition(STATES.TRANSITION, STATES.IDLE, { event: 'idle' });
    }

    applyPlayerEvent(event) {
        if (!event || event.sessionId !== this._state.sessionId) return this._result(false, 'stale-player-event');
        const revision = Number.isInteger(event.revision) ? event.revision : -1;
        const order = Number.isInteger(event.order) ? event.order : -1;
        if (revision < this._playerCursor.revision
            || (revision === this._playerCursor.revision && order <= this._playerCursor.order)) {
            return this._result(false, 'stale-player-event');
        }
        this._playerCursor = { revision, order };
        const transport = {
            positionMs: integerMs(event.positionMs),
            durationMs: integerMs(event.durationMs || this._state.transport.durationMs),
        };
        const state = this._state.state;
        switch (event.type) {
            case 'load':
                return this.transition(state, STATES.INTRO, { event: 'ready', transport, song: event.song });
            case 'play':
                if (state === STATES.PAUSED) return this.transition(state, STATES.PLAYING, { event: 'resume', transport });
                return this.transition(state, STATES.PLAYING, { event: 'play', transport });
            case 'pause':
                return this.transition(state, STATES.PAUSED, { event: 'pause', transport });
            case 'seek':
                return this.transition(state, state, { event: 'seek', transport });
            case 'restart':
                return this.transition(state, state, { event: 'restart', transport: { ...transport, positionMs: 0 } });
            case 'stop':
                return this.transition(state, STATES.ENDING, { event: 'end', transport });
            case 'ended':
                return this.transition(state, STATES.ENDING, { event: 'end', transport });
            case 'error':
                return this.transition(state, STATES.ERROR, { error: event.error, transport });
            default:
                return this._result(false, 'unknown-player-event');
        }
    }
}

module.exports = {
    KaraokeSession,
    STATES,
    SESSION_ROLES,
    TRANSITIONS,
    adaptPlayerEvent,
    normalizePlayerError,
    projectKaraokeState,
    makeKaraokeMessage,
    makeKaraokeResultMessage,
    handleKaraokeMessage,
};
