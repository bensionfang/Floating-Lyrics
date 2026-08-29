'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
    MpvKaraokePlayer,
    keyToPitchFactor,
} = require('../web-app/mpv-karaoke-player.js');

class FakeProcess extends EventEmitter {
    kill() { this.killed = true; }
}

class FakeIpc {
    constructor() {
        this.commands = [];
        this.listener = null;
        this.duration = 180;
        this.position = 0;
        this.audioDevice = 'auto';
    }

    onMessage(listener) {
        this.listener = listener;
        return () => { this.listener = null; };
    }

    async connect() {}

    async request(command) {
        this.commands.push(command);
        if (command[0] === 'get_property' && command[1] === 'duration') return { error: 'success', data: this.duration };
        if (command[0] === 'get_property' && command[1] === 'time-pos') return { error: 'success', data: this.position };
        if (command[0] === 'get_property' && command[1] === 'audio-device') return { error: 'success', data: this.audioDevice };
        if (command[0] === 'get_property' && command[1] === 'audio-device-list') {
            return { error: 'success', data: [
                { name: 'auto', description: 'Autoselect device' },
                { name: 'wasapi/{speaker}', description: 'Speakers' },
            ] };
        }
        if (command[0] === 'set_property' && command[1] === 'time-pos') this.position = command[2];
        if (command[0] === 'set_property' && command[1] === 'audio-device') this.audioDevice = command[2];
        return { error: 'success' };
    }

    emitMessage(message) {
        if (this.listener) this.listener(message);
    }

    close() { this.closed = true; }
}

async function test(name, fn) {
    await fn();
    console.log(`ok - ${name}`);
}

(async () => {
    const process = new FakeProcess();
    const ipc = new FakeIpc();
    const player = new MpvKaraokePlayer({
        executablePath: 'C:\\mpv\\mpv.exe',
        spawnProcess: (executable, args) => {
            process.executable = executable;
            process.args = args;
            return process;
        },
        createIpc: () => ipc,
        pipeNameFactory: () => 'test-mpv-pipe',
    });

    await test('loads a local file and exposes mpv transport commands', async () => {
        const events = [];
        player.on((event) => events.push(event));
        const loading = player.load({ id: 'fixture', src: 'C:\\fixture.m4a', durationMs: 180000 });
        ipc.emitMessage({ event: 'file-loaded' });
        await loading;

        assert.equal(events[0].type, 'load');
        assert.equal(player.getDuration(), 180000);
        assert.ok(process.args.includes('--idle=yes'));
        assert.ok(process.args.includes('--keep-open=no'));
        assert.deepEqual(ipc.commands.find((command) => command[0] === 'loadfile'), [
            'loadfile', 'C:\\fixture.m4a', 'replace',
        ]);

        ipc.emitMessage({ event: 'property-change', name: 'time-pos', data: 12.345 });
        assert.equal(player.getPosition(), 12345);
        await player.play();
        await player.pause();
        await player.seek(42000);
        await player.restart();
        await player.stop();
        assert.equal(player.getPosition(), 0);
        assert.deepEqual(ipc.commands.filter((command) => command[0] === 'set_property').map((command) => command.slice(1, 3)), [
            ['pause', false], ['pause', true], ['time-pos', 42], ['time-pos', 0],
            ['pause', true], ['time-pos', 0],
        ]);
    });

    await test('key shift changes pitch only and output selection is read back', async () => {
        const result = await player.setKey(-2);
        assert.equal(result.supported, true);
        assert.equal(result.semitones, -2);
        assert.equal(result.factor, keyToPitchFactor(-2));
        assert.equal(player.getPosition(), 0);
        assert.equal(player.getDuration(), 180000);

        assert.equal(await player.setTempo(1.25), 1.25);
        const devices = await player.getOutputDevices();
        assert.equal(devices[1].name, 'wasapi/{speaker}');
        assert.deepEqual(await player.setOutputDevice('wasapi/{speaker}'), {
            supported: true,
            deviceId: 'wasapi/{speaker}',
            readback: 'wasapi/{speaker}',
            selected: true,
        });
        assert.equal(player.getPosition(), 0);
    });

    await test('EOF and process errors become truthful lifecycle events', async () => {
        const events = [];
        player.on((event) => events.push(event));
        ipc.emitMessage({ event: 'property-change', name: 'time-pos', data: 179.5 });
        ipc.emitMessage({ event: 'end-file', reason: 'eof' });
        assert.equal(player.getState(), 'ended');
        assert.equal(player.getPosition(), 180000);
        assert.equal(events.at(-1).type, 'ended');

        const loadsBeforeRestart = ipc.commands.filter((command) => command[0] === 'loadfile').length;
        const restarting = player.restart();
        assert.equal(ipc.commands.filter((command) => command[0] === 'loadfile').length, loadsBeforeRestart + 1,
            'restart after EOF must reload the file');
        ipc.emitMessage({ event: 'file-loaded' });
        await restarting;
        assert.equal(player.getState(), 'paused');
        assert.equal(player.getPosition(), 0);

        process.emit('error', new Error('mpv crashed'));
        assert.equal(player.getState(), 'error');
        assert.deepEqual(events.at(-1).error, {
            domain: 'player',
            code: 'mpv-process-error',
            message: 'mpv crashed',
        });
    });

    console.log('test_mpv_karaoke_player: OK');
})().catch((error) => {
    console.error(error.stack || error);
    process.exitCode = 1;
});
