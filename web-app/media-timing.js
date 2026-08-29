'use strict';

const MEDIA_SEEK_THRESHOLD_SEC = 1.5;
const MEDIA_EDGE_EPSILON_SEC = 0.05;

function trackId(state) {
    return `${state.artist || ''}|||${state.title || ''}`;
}

function finitePosition(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

function lifecycleEvent(previous, next) {
    if (next.error) return 'error';
    if (!next.title) return 'stop';
    if (!previous) return next.title ? 'load' : 'stop';
    if (trackId(previous) !== trackId(next)) return 'load';

    const positionJump = Math.abs(next.position - previous.position);
    if (next.is_playing && next.position <= MEDIA_EDGE_EPSILON_SEC && previous.position > 0.5) {
        return 'restart';
    }
    if (!next.is_playing && next.duration > 0
        && next.position >= next.duration - MEDIA_EDGE_EPSILON_SEC) {
        return 'ended';
    }
    if (next.is_playing !== previous.is_playing) return next.is_playing ? 'play' : 'pause';
    if (positionJump > MEDIA_SEEK_THRESHOLD_SEC) return 'seek';
    return next.is_playing ? 'play' : 'pause';
}

class MediaTimingSequencer {
    constructor() {
        this.previous = null;
        this.revision = -1;
        this.order = -1;
    }

    update(state = {}) {
        const next = {
            title: state.title || '',
            artist: state.artist || '',
            position: finitePosition(state.position),
            duration: finitePosition(state.duration),
            is_playing: !!state.is_playing,
            error: state.error || null,
        };
        const event = lifecycleEvent(this.previous, next);
        if (!this.previous || trackId(this.previous) !== trackId(next)) {
            this.revision += 1;
            this.order = 0;
        } else {
            this.order += 1;
        }
        this.previous = next;
        return {
            ...state,
            timing_event: event,
            timing_revision: this.revision,
            timing_order: this.order,
        };
    }
}

module.exports = {
    MEDIA_SEEK_THRESHOLD_SEC,
    MediaTimingSequencer,
    lifecycleEvent,
};
