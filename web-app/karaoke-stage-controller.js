'use strict';

function currentItem(queueState) {
  return queueState && Array.isArray(queueState.items)
    ? queueState.items.find(item => item.queueId === queueState.currentQueueId) || null
    : null;
}

function createKaraokeStageController({ session, queue, library, playerService, onState = () => {} } = {}) {
  if (!session || typeof session.snapshot !== 'function' || typeof session.reconcileQueue !== 'function') {
    throw new TypeError('session reconciliation is required');
  }
  if (!queue || typeof queue.skip !== 'function') throw new TypeError('queue.skip is required');
  if (!library || typeof library.loadSong !== 'function') throw new TypeError('library.loadSong is required');
  if (!playerService || typeof playerService.loadSong !== 'function' || typeof playerService.command !== 'function') {
    throw new TypeError('playerService is required');
  }

  const unsubscribe = typeof playerService.on === 'function'
    ? playerService.on(event => { playerEvent(event).catch(onState); }) : null;

  async function reconcile(queueState) {
    const item = currentItem(queueState);
    const song = item ? await library.loadSong(item.songId) : null;
    const playableSong = song && song.playable && song.audio && song.audio.status === 'ready' ? song : null;
    const before = session.snapshot();
    const result = session.reconcileQueue(queueState, playableSong && {
      id: song.songId,
      title: song.title,
      artist: song.artist,
      durationMs: Number(song.audio && song.audio.durationMs) || Number(song.lyrics && song.lyrics.durationMs) || 0,
    });
    if (!result.accepted) return result;
    let canonical = session.snapshot();
    if (!item || !playableSong) {
      if (before.sessionId && typeof playerService.command === 'function') {
        try { await playerService.command({ sessionId: before.sessionId, command: 'stop' }); } catch (error) {}
      }
      onState(canonical);
      return { accepted: true, state: canonical };
    }
    if (canonical.state === 'IDLE') {
      const started = session.start({
        id: song.songId,
        title: song.title,
        artist: song.artist,
        durationMs: Number(song.audio && song.audio.durationMs) || Number(song.lyrics && song.lyrics.durationMs) || 0,
      }, { hasNext: !!queueState.hasNext });
      if (!started.accepted) return started;
      canonical = started.state;
    }
    const playerState = typeof playerService.snapshot === 'function' ? playerService.snapshot() : null;
    if (canonical.state === 'PREPARING' && (!playerState || playerState.songId !== playableSong.songId)) {
      await playerService.loadSong(playableSong.songId, {
        sessionId: canonical.sessionId,
        key: Number.isInteger(item.key) ? item.key : 0,
      });
      canonical = session.snapshot();
    } else if (canonical.sessionId && playerState && playerState.songId === playableSong.songId
      && Number.isInteger(item.key) && playerState.key !== item.key) {
      await playerService.command({ sessionId: canonical.sessionId, command: 'key', semitones: item.key });
    }
    onState(canonical);
    return { accepted: true, state: canonical };
  }

  async function playerEvent(event) {
    if (event.type === 'output') {
      onState(session.snapshot());
      return { accepted: true, state: session.snapshot() };
    }
    const result = session.applyPlayerEvent(event);
    if (!result.accepted || event.type !== 'ended') {
      if (result.accepted) onState(result.state);
      return result;
    }
    const state = typeof queue.snapshot === 'function' ? await queue.snapshot() : queue.state;
    const skipped = await queue.skip(state.revision);
    if (!skipped.accepted) return { accepted: false, reason: skipped.reason, state: session.snapshot() };
    const next = await reconcile(skipped.state);
    return { accepted: true, state: next.state };
  }

  async function command({ sessionId, command: name, positionMs, semitones } = {}) {
    const canonical = session.snapshot();
    if (!sessionId || sessionId !== canonical.sessionId) {
      return { accepted: false, reason: 'stale-session', state: canonical };
    }
    if (name === 'next') {
      const state = typeof queue.snapshot === 'function' ? await queue.snapshot() : queue.state;
      const skipped = await queue.skip(state.revision);
      if (!skipped.accepted) return { accepted: false, reason: skipped.reason, state: session.snapshot() };
      return reconcile(skipped.state);
    }
    try {
      const result = await playerService.command({ sessionId, command: name, positionMs, semitones });
      return { ...result, state: session.snapshot() };
    } catch (error) {
      return { accepted: false, reason: error.code || 'player-command-failed', state: session.snapshot() };
    }
  }

  return { reconcile, playerEvent, command, dispose() { if (unsubscribe) unsubscribe(); } };
}

module.exports = { createKaraokeStageController };
