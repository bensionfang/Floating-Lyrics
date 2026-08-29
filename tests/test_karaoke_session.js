'use strict';

const assert = require('node:assert/strict');
const {
    KaraokeSession,
    STATES,
    SESSION_ROLES,
    adaptPlayerEvent,
    projectKaraokeState,
    makeKaraokeMessage,
    makeKaraokeResultMessage,
    handleKaraokeMessage,
} = require('../web-app/karaoke-session.js');

function test(name, fn) {
    fn();
    console.log(`ok - ${name}`);
}

function song(id = 'song-1') {
    return { id, title: 'Song', artist: 'Artist', durationMs: 180000 };
}

function createSession(invalidated = []) {
    let id = 0;
    return new KaraokeSession({
        idFactory: () => `session-${++id}`,
        invalidateSessionCredentials: (sessionId) => invalidated.push(sessionId),
    });
}

function reachPlaying(session) {
    session.start(song());
    session.transition(STATES.PREPARING, STATES.INTRO);
    session.transition(STATES.INTRO, STATES.PLAYING);
}

test('valid transition table accepts only the canonical lifecycle edges', () => {
    const session = createSession();
    assert.equal(session.start(song()).accepted, true);
    assert.equal(session.transition(STATES.PREPARING, STATES.INTRO).accepted, true);
    assert.equal(session.transition(STATES.INTRO, STATES.PLAYING).accepted, true);
    assert.equal(session.transition(STATES.PLAYING, STATES.PAUSED).accepted, true);
    assert.equal(session.transition(STATES.PAUSED, STATES.PLAYING).accepted, true);
    assert.equal(session.transition(STATES.PLAYING, STATES.ENDING).accepted, true);
    assert.equal(session.transition(STATES.ENDING, STATES.RESULT).accepted, true);
    assert.equal(session.transition(STATES.RESULT, STATES.TRANSITION).accepted, true);
    assert.equal(session.advance(song('song-2')).accepted, true);
    assert.equal(session.transition(STATES.PREPARING, STATES.INTRO).accepted, true);
    assert.equal(session.transition(STATES.INTRO, STATES.PLAYING).accepted, true);
    assert.equal(session.transition(STATES.PLAYING, STATES.ENDING).accepted, true);
    assert.equal(session.transition(STATES.ENDING, STATES.TRANSITION).accepted, true);
    assert.equal(session.advance().accepted, true);
    assert.equal(session.snapshot().state, STATES.IDLE);
});

test('invalid source or target is rejected without changing canonical state', () => {
    const session = createSession();
    const before = session.snapshot();
    const result = session.transition(STATES.PLAYING, STATES.PAUSED);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'source-state-mismatch');
    assert.deepEqual(result.state, before);

    assert.equal(session.start(song()).accepted, true);
    const beforeIllegal = session.snapshot();
    const illegal = session.transition(STATES.PREPARING, STATES.PAUSED);
    assert.equal(illegal.accepted, false);
    assert.equal(illegal.reason, 'invalid-transition');
    assert.deepEqual(illegal.state, beforeIllegal);
});

test('skip during PREPARING enters ENDING and duplicate skip is rejected', () => {
    const session = createSession();
    session.start(song());
    assert.equal(session.skip().accepted, true);
    assert.equal(session.snapshot().state, STATES.ENDING);
    const duplicate = session.skip();
    assert.equal(duplicate.accepted, false);
    assert.equal(duplicate.reason, 'invalid-transition');
    assert.equal(duplicate.state.state, STATES.ENDING);
});

test('restart while PAUSED resets position but remains PAUSED', () => {
    const session = createSession();
    reachPlaying(session);
    session.setTransport({ positionMs: 42000 });
    session.pause();
    const result = session.restart();
    assert.equal(result.accepted, true);
    assert.equal(result.state.state, STATES.PAUSED);
    assert.equal(result.state.transport.positionMs, 0);
    assert.equal(result.state.transport.isPlaying, false);
});

test('queue-empty transition ends the session and invalidates credentials', () => {
    const invalidated = [];
    const session = createSession(invalidated);
    reachPlaying(session);
    session.skip();
    session.transition(STATES.ENDING, STATES.TRANSITION);
    const result = session.advance();
    assert.equal(result.accepted, true);
    assert.equal(result.state.state, STATES.IDLE);
    assert.equal(result.state.sessionId, null);
    assert.equal(result.state.remoteCredentials.valid, false);
    assert.deepEqual(invalidated, ['session-1']);
});

test('each new session gets a new identity and revisions never decrease', () => {
    const session = createSession();
    const revisions = [session.snapshot().revision];
    const first = session.start(song());
    revisions.push(first.state.revision);
    session.transition(STATES.PREPARING, STATES.INTRO);
    revisions.push(session.snapshot().revision);
    session.transition(STATES.INTRO, STATES.PLAYING);
    revisions.push(session.snapshot().revision);
    session.skip();
    session.transition(STATES.ENDING, STATES.TRANSITION);
    session.advance();
    revisions.push(session.snapshot().revision);
    const second = session.start(song('song-2'));
    revisions.push(second.state.revision);
    assert.notEqual(second.state.sessionId, first.state.sessionId);
    assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b));
});

test('ERROR is reachable from every non-ERROR lifecycle state', () => {
    const setup = [
        (s) => {},
        (s) => s.start(song()),
        (s) => { s.start(song()); s.transition(STATES.PREPARING, STATES.INTRO); },
        (s) => { reachPlaying(s); },
        (s) => { reachPlaying(s); s.pause(); },
        (s) => { reachPlaying(s); s.skip(); },
        (s) => { reachPlaying(s); s.skip(); s.transition(STATES.ENDING, STATES.RESULT); },
        (s) => { reachPlaying(s); s.skip(); s.transition(STATES.ENDING, STATES.TRANSITION); },
    ];
    const states = [
        STATES.IDLE, STATES.PREPARING, STATES.INTRO, STATES.PLAYING,
        STATES.PAUSED, STATES.ENDING, STATES.RESULT, STATES.TRANSITION,
    ];
    setup.forEach((prepare, index) => {
        const session = createSession();
        prepare(session);
        const result = session.transition(states[index], STATES.ERROR, {
            event: 'error', error: 'player failed',
        });
        assert.equal(result.accepted, true, states[index]);
        assert.equal(result.state.state, STATES.ERROR);
    });
});

test('player crash becomes visible ERROR and stops playback', () => {
    const invalidated = [];
    const session = createSession(invalidated);
    reachPlaying(session);
    const result = session.applyPlayerEvent(adaptPlayerEvent({
        type: 'error',
        revision: 1,
        order: 2,
        positionMs: 1234,
        error: new Error('decoder crashed'),
    }, session.snapshot().sessionId));
    assert.equal(result.accepted, true);
    assert.equal(result.state.state, STATES.ERROR);
    assert.equal(result.state.transport.isPlaying, false);
    assert.deepEqual(result.state.transport.error, {
        domain: 'player',
        code: 'player-error',
        message: 'decoder crashed',
    });
    assert.deepEqual(invalidated, [result.state.sessionId]);
    assert.equal(result.state.remoteCredentials.valid, false);
});

test('stale player event is rejected and cannot move a newer state backward', () => {
    const session = createSession();
    reachPlaying(session);
    const sessionId = session.snapshot().sessionId;
    const accepted = session.applyPlayerEvent(adaptPlayerEvent({
        type: 'pause', revision: 3, order: 4, positionMs: 12000,
    }, sessionId));
    assert.equal(accepted.accepted, true);
    const stale = session.applyPlayerEvent(adaptPlayerEvent({
        type: 'play', revision: 2, order: 99, positionMs: 8000,
    }, sessionId));
    assert.equal(stale.accepted, false);
    assert.equal(stale.reason, 'stale-player-event');
    assert.equal(stale.state.state, STATES.PAUSED);
    assert.equal(stale.state.transport.positionMs, 12000);
});

test('Stage, Host, and test client projections share canonical state and revision', () => {
    const session = createSession();
    reachPlaying(session);
    const canonical = session.snapshot();
    const projections = SESSION_ROLES.map((role) => projectKaraokeState(canonical, role));
    assert.deepEqual(projections.map((projection) => projection.state), [
        STATES.PLAYING, STATES.PLAYING, STATES.PLAYING,
    ]);
    assert.deepEqual(projections.map((projection) => projection.sessionId), [
        canonical.sessionId, canonical.sessionId, canonical.sessionId,
    ]);
    assert.deepEqual(projections.map((projection) => projection.revision), [
        canonical.revision, canonical.revision, canonical.revision,
    ]);
    const withoutRole = ({ role, ...projection }) => projection;
    assert.deepEqual(withoutRole(projections[0]), withoutRole(projections[1]));
    assert.deepEqual(withoutRole(projections[1]), withoutRole(projections[2]));
    const message = makeKaraokeMessage(canonical, 'stage');
    assert.equal(message.type, 'karaoke_session');
    assert.deepEqual(message.state, projections[0]);
    const messages = SESSION_ROLES.map((role) => makeKaraokeMessage(canonical, role));
    assert.deepEqual(messages.map((item) => item.type), [
        'karaoke_session', 'karaoke_session', 'karaoke_session',
    ]);
    assert.deepEqual(messages.map((item) => item.revision), [
        canonical.revision, canonical.revision, canonical.revision,
    ]);
    assert.deepEqual(messages.map((item) => withoutRole(item.state)), [
        withoutRole(messages[0].state), withoutRole(messages[0].state),
        withoutRole(messages[0].state),
    ]);
});

test('protocol result includes accepted/rejected status and canonical projection', () => {
    const session = createSession();
    const rejected = session.transition(STATES.PLAYING, STATES.PAUSED);
    const message = makeKaraokeResultMessage(rejected, 'host');
    assert.equal(message.type, 'karaoke_session_result');
    assert.equal(message.accepted, false);
    assert.equal(message.reason, 'source-state-mismatch');
    assert.equal(message.revision, rejected.state.revision);
    assert.equal(message.state.role, 'host');
    assert.equal(message.state.state, STATES.IDLE);
});

test('only explicit session/player messages can reach the session adapter', () => {
    const session = createSession();
    assert.equal(handleKaraokeMessage(session, {
        type: 'karaoke_active', active: true,
    }), null);
    const started = handleKaraokeMessage(session, {
        type: 'karaoke_session_transition',
        sourceState: STATES.IDLE,
        targetState: STATES.PREPARING,
        details: { song: song() },
    });
    assert.equal(started.accepted, true);
    assert.equal(started.state.state, STATES.PREPARING);
});

test('old karaoke_active is not a session transition API', () => {
    const session = createSession();
    const before = session.snapshot();
    assert.equal(typeof session.handleMessage, 'undefined');
    assert.deepEqual(session.snapshot(), before);
});

console.log('test_karaoke_session: OK');
