const fs = require('fs');
const path = require('path');
const { randomBytes: defaultRandomBytes, timingSafeEqual } = require('crypto');

const TOKEN_FILE = 'youtube-karaoke-token';
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const TOKEN_RE = /^[A-Za-z0-9_-]+$/;
const STATES = new Set(['idle', 'loading', 'playing', 'paused', 'buffering', 'ad', 'ended', 'error']);
const COMMANDS = new Set(['load', 'play', 'pause', 'seek', 'set_key']);

function isSafeNonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function normalizeVideoId(value) {
  return typeof value === 'string' && VIDEO_ID_RE.test(value) ? value : null;
}

function normalizeText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function normalizeError(value) {
  if (value === null || value === undefined) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const code = normalizeText(value.code, 100);
  const message = normalizeText(value.message, 500);
  return code && message ? { code, message } : null;
}

function normalizeExtensionState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const allowed = new Set([
    'revision', 'videoId', 'title', 'channel', 'state', 'positionMs', 'durationMs',
    'keySemitones', 'error', 'commandId',
  ]);
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  if (!isSafeNonNegativeInteger(raw.revision)) return null;
  if (!normalizeVideoId(raw.videoId)) return null;
  if (!STATES.has(raw.state)) return null;
  if (!isSafeNonNegativeInteger(raw.positionMs) || !isSafeNonNegativeInteger(raw.durationMs)) return null;
  if (!Number.isSafeInteger(raw.keySemitones) || raw.keySemitones < -6 || raw.keySemitones > 6) return null;
  const title = normalizeText(raw.title ?? '', 200);
  const channel = normalizeText(raw.channel ?? '', 200);
  if (title === null || channel === null) return null;
  const error = normalizeError(raw.error);
  if (raw.error !== null && raw.error !== undefined && error === null) return null;
  if (raw.commandId !== undefined && !isSafeNonNegativeInteger(raw.commandId)) return null;
  const state = {
    revision: raw.revision,
    videoId: raw.videoId,
    title,
    channel,
    state: raw.state,
    positionMs: raw.positionMs,
    durationMs: raw.durationMs,
    keySemitones: raw.keySemitones,
    error,
  };
  if (raw.commandId !== undefined) state.commandId = raw.commandId;
  return state;
}

function normalizeKaraokeCommand(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (!COMMANDS.has(raw.action) || !isSafeNonNegativeInteger(raw.commandId)) return null;
  const allowed = {
    load: new Set(['commandId', 'action', 'videoId', 'positionMs']),
    play: new Set(['commandId', 'action']),
    pause: new Set(['commandId', 'action']),
    seek: new Set(['commandId', 'action', 'positionMs']),
    set_key: new Set(['commandId', 'action', 'semitones']),
  }[raw.action];
  if (Object.keys(raw).some((key) => !allowed.has(key))) return null;
  const command = { commandId: raw.commandId, action: raw.action };
  if (raw.action === 'load') {
    command.videoId = normalizeVideoId(raw.videoId);
    if (!command.videoId) return null;
    command.positionMs = raw.positionMs === undefined ? 0 : raw.positionMs;
    if (!isSafeNonNegativeInteger(command.positionMs)) return null;
  } else if (raw.action === 'seek') {
    if (!isSafeNonNegativeInteger(raw.positionMs)) return null;
    command.positionMs = raw.positionMs;
  } else if (raw.action === 'set_key') {
    if (!Number.isSafeInteger(raw.semitones) || raw.semitones < -6 || raw.semitones > 6) return null;
    command.semitones = raw.semitones;
  }
  return command;
}

function toBase64Url(buffer) {
  return Buffer.from(buffer).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function readOrCreateExtensionToken({ dataDir, randomBytes = defaultRandomBytes }) {
  const file = path.join(dataDir, TOKEN_FILE);
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (!TOKEN_RE.test(existing)) throw new Error('Invalid YouTube extension token file');
    return existing;
  }
  const token = toBase64Url(randomBytes(32));
  if (!TOKEN_RE.test(token)) throw new Error('Generated invalid YouTube extension token');
  fs.writeFileSync(file, token, { encoding: 'utf8', flag: 'wx' });
  return token;
}

function tokenMatches(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string' || !TOKEN_RE.test(actual) || !TOKEN_RE.test(expected)) return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = {
  normalizeExtensionState,
  normalizeKaraokeCommand,
  readOrCreateExtensionToken,
  tokenMatches,
  TOKEN_FILE,
};
