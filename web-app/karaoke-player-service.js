'use strict';

const { MpvKaraokePlayer } = require('./mpv-karaoke-player');

const PLAYER_COMMANDS = new Set(['play', 'pause', 'playpause', 'restart', 'stop', 'seek', 'key']);

function serviceError(code, message, details = {}) {
  return Object.assign(new Error(message), { domain: 'player', code, ...details });
}

function validKey(value) {
  return Number.isInteger(value) && value >= -12 && value <= 12;
}

function createKaraokePlayerService({
  library,
  playerFactory = () => new MpvKaraokePlayer(),
  session,
  queue,
} = {}) {
  if (!library || typeof library.loadSong !== 'function') throw new TypeError('library.loadSong is required');
  if (!session || typeof session.snapshot !== 'function') throw new TypeError('session.snapshot is required');
  if (!queue) throw new TypeError('queue is required');

  let player = null;
  let unsubscribe = null;
  let current = null;
  let disposed = false;
  let eventOrder = -1;
  let loadRevision = 0;
  const listeners = new Set();

  const emit = event => {
    listeners.forEach(listener => listener(event));
    return event;
  };

  const assertSession = sessionId => {
    const activeSessionId = session.snapshot().sessionId;
    if (!sessionId || !activeSessionId || sessionId !== activeSessionId) {
      throw serviceError('stale-session', 'player command belongs to a stale session', { sessionId, activeSessionId });
    }
  };

  const ensurePlayer = () => {
    if (disposed) throw serviceError('player-disposed', 'player service is disposed');
    if (player) return player;
    player = playerFactory();
    if (!player || typeof player.on !== 'function') throw new TypeError('playerFactory must return a player');
    unsubscribe = player.on(event => {
      if (event.type === 'output' && current) {
        current.output = { ...current.output, ...(event.output || {}) };
      }
      const output = {
        ...event,
        sessionId: current && current.sessionId,
        songId: current && current.songId,
        revision: Number.isInteger(event.revision) ? event.revision : (current && current.revision),
        order: Number.isInteger(event.order) ? event.order : ++eventOrder,
      };
      if (event.type === 'error') output.error = event.error || serviceError('mpv-error', 'audio playback failed');
      emit(output);
    });
    return player;
  };

  const snapshot = () => {
    const raw = player && typeof player.snapshot === 'function'
      ? player.snapshot()
      : {
        state: player && typeof player.getState === 'function' ? player.getState() : 'idle',
        positionMs: player && typeof player.getPosition === 'function' ? player.getPosition() : 0,
        durationMs: player && typeof player.getDuration === 'function' ? player.getDuration() : 0,
      };
    const state = String(raw.state || 'idle').toUpperCase();
    const output = {
      requested: current && current.output ? current.output.requested : 'auto',
      active: current && current.output ? current.output.active : 'auto',
      verified: current && current.output ? current.output.verified : false,
      degraded: current && current.output ? current.output.degraded : false,
      ...(raw.output || {}),
      ...(current && current.output ? current.output : {}),
    };
    return {
      songId: current && current.songId,
      key: current && current.key,
      sessionId: current && current.sessionId,
      state,
      positionMs: Number.isFinite(raw.positionMs) ? Math.max(0, Math.round(raw.positionMs)) : 0,
      durationMs: Number.isFinite(raw.durationMs) ? Math.max(0, Math.round(raw.durationMs)) : 0,
      output,
    };
  };

  const loadSong = async (songId, { sessionId, key = 0 } = {}) => {
    assertSession(sessionId);
    if (!validKey(key)) throw serviceError('invalid-key', 'key must be an integer between -12 and 12', { key });
    const song = await library.loadSong(songId);
    if (!song) throw serviceError('song-not-found', `song is unavailable: ${songId}`, { songId });
    if (!song.playable || !song.audio || song.audio.status !== 'ready' || !song.audio.path) {
      throw serviceError('song-unplayable', `song audio is unavailable: ${songId}`, { songId });
    }
    const activePlayer = ensurePlayer();
    current = {
      sessionId,
      songId: song.songId,
      key,
      revision: ++loadRevision,
      output: current && current.output ? current.output : { requested: 'auto', active: 'auto', verified: false, degraded: false },
    };
    eventOrder = -1;
    await activePlayer.load({
      id: song.songId,
      src: song.audio.path,
      durationMs: song.audio.durationMs,
      title: song.title,
      artist: song.artist,
    });
    if (typeof activePlayer.setKey === 'function') await activePlayer.setKey(key);
    return { ...snapshot(), song: { ...song } };
  };

  const command = async ({ sessionId, command: name, positionMs, semitones } = {}) => {
    assertSession(sessionId);
    if (!PLAYER_COMMANDS.has(name)) throw serviceError('invalid-command', `unsupported player command: ${name || '(unset)'}`, { command: name });
    const activePlayer = ensurePlayer();
    if (!current) throw serviceError('no-song', 'no song is loaded');
    if (name === 'key') {
      if (!validKey(semitones)) throw serviceError('invalid-key', 'key must be an integer between -12 and 12', { semitones });
      await activePlayer.setKey(semitones);
      current.key = semitones;
    } else if (name === 'seek') await activePlayer.seek(positionMs);
    else if (name === 'playpause') {
      const state = typeof activePlayer.getState === 'function' ? activePlayer.getState() : null;
      await activePlayer[state === 'playing' ? 'pause' : 'play']();
    } else await activePlayer[name]();
    return { accepted: true, command: name, state: snapshot() };
  };

  const listOutputDevices = async () => {
    const activePlayer = ensurePlayer();
    if (typeof activePlayer.getOutputDevices !== 'function') throw serviceError('output-unavailable', 'mpv output device listing is unavailable');
    return activePlayer.getOutputDevices();
  };

  const setOutputDevice = async deviceId => {
    const activePlayer = ensurePlayer();
    if (typeof deviceId !== 'string' || !deviceId) throw serviceError('invalid-output-device', 'deviceId is required');
    if (typeof activePlayer.setOutputDevice !== 'function') throw serviceError('output-unavailable', 'mpv output device selection is unavailable');
    const result = await activePlayer.setOutputDevice(deviceId);
    const verified = result && result.selected === true;
    const active = result && result.readback ? result.readback : deviceId;
    if (!current) current = { sessionId: session.snapshot().sessionId, songId: null, output: null };
    current.output = { requested: deviceId, active, verified, degraded: !verified };
    return snapshot().output;
  };

  return {
    loadSong,
    command,
    listOutputDevices,
    setOutputDevice,
    snapshot,
    on(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      if (unsubscribe) unsubscribe();
      if (player && typeof player.dispose === 'function') await player.dispose();
      player = null;
      current = null;
    },
  };
}

module.exports = { createKaraokePlayerService, serviceError };
