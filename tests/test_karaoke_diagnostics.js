'use strict';

const assert = require('node:assert/strict');
const { buildKaraokeDiagnostics } = require('../web-app/karaoke-diagnostics.js');

function core(overrides = {}) {
    return {
        libraryReady: true,
        stageConnections: 1,
        hostSocketAlive: true,
        session: {
            state: 'PLAYING',
            transport: { error: null },
        },
        output: { supported: true, verified: true },
        ...overrides,
    };
}

const healthy = buildKaraokeDiagnostics(core());
assert.equal(healthy.overall, 'ok');
assert.deepEqual(healthy.items.map((item) => [item.id, item.severity]), [
    ['library', 'ok'],
    ['player', 'ok'],
    ['output', 'ok'],
    ['stage', 'ok'],
    ['websocket', 'ok'],
    ['remote', 'info'],
    ['microphone', 'info'],
    ['video', 'info'],
]);

const playerFailure = buildKaraokeDiagnostics(core({
    session: {
        state: 'ERROR',
        transport: { error: { code: 'decoder-crashed', message: 'decoder crashed' } },
    },
}));
assert.equal(playerFailure.overall, 'error');
assert.deepEqual(playerFailure.items.find((item) => item.id === 'player'), {
    id: 'player',
    label: '播放器',
    severity: 'error',
    message: 'decoder crashed',
});

const optionalMissing = buildKaraokeDiagnostics(core({
    microphone: { enabled: false },
    video: { enabled: false },
}));
assert.equal(optionalMissing.overall, 'ok', 'optional capabilities must not block a playable session');
assert.equal(optionalMissing.items.find((item) => item.id === 'microphone').severity, 'info');
assert.equal(optionalMissing.items.find((item) => item.id === 'video').severity, 'info');

const startup = buildKaraokeDiagnostics(core({
    stageConnections: 0,
    hostSocketAlive: false,
    session: { state: 'IDLE', transport: { error: null } },
    output: { supported: false, verified: false },
}));
assert.equal(startup.overall, 'warn');
assert.equal(startup.items.find((item) => item.id === 'stage').severity, 'warn');
assert.equal(startup.items.find((item) => item.id === 'websocket').severity, 'warn');
assert.equal(startup.items.find((item) => item.id === 'output').severity, 'warn');

console.log('test_karaoke_diagnostics: OK');
