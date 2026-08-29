'use strict';

const crypto = require('crypto');

const REMOTE_COMMANDS = Object.freeze([
  'search', 'reserve', 'queue_view', 'key', 'pause', 'restart', 'skip', 'stop',
  'reconnect', 'state_refresh',
]);
const REMOTE_COMMAND_SET = new Set(REMOTE_COMMANDS);

function activeSession(snapshot) {
  return !!(snapshot && snapshot.sessionId
    && snapshot.state !== 'ERROR'
    && (!snapshot.remoteCredentials || snapshot.remoteCredentials.valid !== false));
}

class KaraokeRemoteGateway {
  constructor(options = {}) {
    this.now = options.now || (() => Date.now());
    this.random = options.random || ((size) => crypto.randomBytes(size));
    this.pairingTtlMs = options.pairingTtlMs || 2 * 60 * 1000;
    this.tokenTtlMs = options.tokenTtlMs || 30 * 60 * 1000;
    this.getSession = options.getSession || (() => null);
    this.pairings = new Map();
    this.tokens = new Map();
  }

  _randomText(bytes) {
    return this.random(bytes).toString('base64url');
  }

  _pairingCode() {
    return this.random(5).toString('hex').slice(0, 6).toUpperCase();
  }

  _session() {
    const snapshot = this.getSession();
    return activeSession(snapshot) ? snapshot : null;
  }

  createPairing() {
    const session = this._session();
    if (!session) return null;
    const code = this._pairingCode();
    const expiresAt = this.now() + this.pairingTtlMs;
    this.pairings.set(code, { sessionId: session.sessionId, expiresAt });
    return { code, sessionId: session.sessionId, expiresAt };
  }

  pair(inputCode) {
    const code = String(inputCode || '').trim().toUpperCase();
    const pairing = this.pairings.get(code);
    if (!pairing) return null;
    this.pairings.delete(code);
    if (pairing.expiresAt <= this.now()) return null;
    const session = this._session();
    if (!session || session.sessionId !== pairing.sessionId) return null;

    const token = this._randomText(32);
    const remoteId = this._randomText(12);
    const expiresAt = this.now() + this.tokenTtlMs;
    this.tokens.set(token, {
      remoteId, sessionId: session.sessionId, expiresAt, seen: new Set(),
    });
    return { accepted: true, token, remoteId, sessionId: session.sessionId, expiresAt };
  }

  authorize(input = {}) {
    const token = String(input.token || '');
    const record = this.tokens.get(token);
    if (!record) return { accepted: false, reason: 'unpaired' };
    if (record.expiresAt <= this.now()) {
      this.tokens.delete(token);
      return { accepted: false, reason: 'token-expired' };
    }

    const session = this._session();
    if (!session || session.sessionId !== record.sessionId || input.sessionId !== record.sessionId) {
      this.tokens.delete(token);
      return { accepted: false, reason: 'stale-session' };
    }
    if (!REMOTE_COMMAND_SET.has(input.command)) {
      return { accepted: false, reason: 'remote-command-not-allowed' };
    }
    if (typeof input.requestId !== 'string' || !input.requestId.trim()) {
      return { accepted: false, reason: 'request-id-required' };
    }
    if (record.seen.has(input.requestId)) {
      this.tokens.delete(token);
      return { accepted: false, reason: 'replay' };
    }
    if (Number.isInteger(input.expectedRevision) && input.expectedRevision !== session.revision) {
      return {
        accepted: false,
        reason: 'stale-session-revision',
        revision: session.revision,
      };
    }

    record.seen.add(input.requestId);
    return {
      accepted: true,
      remoteId: record.remoteId,
      sessionId: record.sessionId,
      revision: session.revision,
    };
  }

  invalidateSession(sessionId) {
    for (const [code, pairing] of this.pairings) {
      if (pairing.sessionId === sessionId) this.pairings.delete(code);
    }
    for (const [token, record] of this.tokens) {
      if (record.sessionId === sessionId) this.tokens.delete(token);
    }
  }

  invalidateToken(token) {
    this.tokens.delete(String(token || ''));
  }

  get activeTokenCount() {
    return this.tokens.size;
  }
}

module.exports = {
  REMOTE_COMMANDS,
  activeSession,
  KaraokeRemoteGateway,
};
