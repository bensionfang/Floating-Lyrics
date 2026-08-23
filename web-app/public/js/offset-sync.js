function offsetSongKey(title, artist) {
    return `${artist || ''}|||${title || ''}`;
}

function offsetFromMessage(currentKey, message) {
    if (!message || message.type !== 'sync_offset_updated') return null;
    return offsetSongKey(message.title, message.artist) === currentKey
        ? message.offset || 0 : null;
}

function createOffsetSaver(send, delayMs = 500) {
    const timers = new Map();
    return function save(title, artist, offset) {
        if (!title) return;
        const key = offsetSongKey(title, artist);
        clearTimeout(timers.get(key));
        const payload = { title, artist: artist || '', offset };
        timers.set(key, setTimeout(() => {
            timers.delete(key);
            send(payload);
        }, delayMs));
    };
}

if (typeof module !== 'undefined' && module.exports) module.exports = {
    offsetSongKey, offsetFromMessage, createOffsetSaver,
};
