'use strict';

const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PLAYER_EVENT_TYPES = Object.freeze([
    'load', 'play', 'pause', 'seek', 'restart', 'stop', 'ended', 'error', 'output',
]);

function integerMs(value) {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number) : 0;
}

function secondsToMs(value) { return integerMs(Number(value) * 1000); }

function keyToPitchFactor(semitones) {
    if (!Number.isInteger(semitones)) throw new TypeError('semitones must be an integer');
    return Math.pow(2, semitones / 12);
}

function normalizeError(error, fallbackCode = 'mpv-error') {
    if (error && typeof error === 'object'
        && typeof error.domain === 'string' && typeof error.code === 'string') return error;
    return {
        domain: 'player',
        code: fallbackCode,
        message: error && typeof error.message === 'string' && error.message
            ? error.message : String(error || 'audio playback failed'),
    };
}

function resolveMpvPath({
    env = process.env,
    resourcesPath = process.resourcesPath,
    isPackaged = !!(process.versions.electron && !process.defaultApp),
} = {}) {
    if (env.KANARIC_MPV_PATH) return env.KANARIC_MPV_PATH;
    if (isPackaged && resourcesPath) return path.join(resourcesPath, 'third_party', 'mpv', 'mpv.exe');
    return path.join(__dirname, '..', 'third_party', 'mpv', 'mpv.exe');
}

function readMpvRuntimeManifest(manifestPath = path.join(__dirname, '..', 'third_party', 'mpv', 'manifest.json')) {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function mpvRuntimeDiagnostic({
    executablePath,
    manifestPath = path.join(path.dirname(executablePath), 'manifest.json'),
    exists = fs.existsSync,
} = {}) {
    if (!executablePath || !exists(executablePath)) {
        return { domain: 'player', code: 'player-unavailable', message: `mpv executable is unavailable: ${executablePath || '(unset)'}` };
    }
    if (!manifestPath || !exists(manifestPath)) {
        return { domain: 'player', code: 'player-unavailable', message: `mpv runtime manifest is unavailable: ${manifestPath || '(unset)'}` };
    }
    try {
        const manifest = readMpvRuntimeManifest(manifestPath);
        if (manifest.architecture !== 'x86_64'
            || typeof manifest.version !== 'string'
            || typeof manifest.sourceUrl !== 'string'
            || !/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))
            || typeof manifest.licenseFile !== 'string') {
            return { domain: 'player', code: 'player-unavailable', message: 'mpv runtime manifest is invalid' };
        }
    } catch (error) {
        return { domain: 'player', code: 'player-unavailable', message: `mpv runtime manifest could not be read: ${error.message}` };
    }
    return null;
}

class MpvIpcClient {
    constructor(ipcPath, { connectTimeoutMs = 8000, retryMs = 100 } = {}) {
        this.ipcPath = ipcPath;
        this.connectTimeoutMs = connectTimeoutMs;
        this.retryMs = retryMs;
        this.socket = null;
        this.buffer = '';
        this.nextRequestId = 1;
        this.pending = new Map();
        this.listeners = new Set();
    }

    onMessage(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    connect() {
        if (this.socket) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const startedAt = Date.now();
            const attempt = () => {
                if (Date.now() - startedAt >= this.connectTimeoutMs) {
                    reject(new Error(`mpv IPC connect timeout: ${this.ipcPath}`));
                    return;
                }
                const socket = net.createConnection(this.ipcPath);
                const retry = () => {
                    socket.destroy();
                    setTimeout(attempt, this.retryMs);
                };
                socket.once('error', retry);
                socket.once('connect', () => {
                    socket.removeListener('error', retry);
                    socket.on('error', (error) => this._failAll(error));
                    socket.on('close', () => {
                        if (this.socket === socket) this.socket = null;
                    });
                    socket.setEncoding('utf8');
                    socket.on('data', (data) => this._receive(data));
                    this.socket = socket;
                    resolve();
                });
            };
            attempt();
        });
    }

    _receive(data) {
        this.buffer += data;
        let newline;
        while ((newline = this.buffer.indexOf('\n')) >= 0) {
            const line = this.buffer.slice(0, newline).trim();
            this.buffer = this.buffer.slice(newline + 1);
            if (!line) continue;
            let message;
            try { message = JSON.parse(line); } catch (error) { continue; }
            if (message.request_id && this.pending.has(message.request_id)) {
                const pending = this.pending.get(message.request_id);
                this.pending.delete(message.request_id);
                if (message.error && message.error !== 'success') pending.reject(new Error(message.error));
                else pending.resolve(message);
            }
            this.listeners.forEach((listener) => listener(message));
        }
    }

    _failAll(error) {
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
    }

    request(command, timeoutMs = 5000) {
        if (!this.socket) return Promise.reject(new Error('mpv IPC is not connected'));
        const requestId = this.nextRequestId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error(`mpv IPC timeout: ${JSON.stringify(command)}`));
            }, timeoutMs);
            this.pending.set(requestId, {
                resolve: (message) => { clearTimeout(timer); resolve(message); },
                reject: (error) => { clearTimeout(timer); reject(error); },
            });
            this.socket.write(JSON.stringify({ command, request_id: requestId }) + '\n');
        });
    }

    close() {
        this._failAll(new Error('mpv IPC closed'));
        if (this.socket) this.socket.destroy();
        this.socket = null;
    }
}

class MpvKaraokePlayer {
    constructor({
        executablePath = resolveMpvPath(),
        spawnProcess = spawn,
        createIpc = (ipcPath) => new MpvIpcClient(ipcPath),
        pipeNameFactory = () => `kanaric-mpv-${process.pid}-${Date.now()}`,
        platform = process.platform,
        loadTimeoutMs = 15000,
        runtimeManifestPath,
        fileExists = fs.existsSync,
    } = {}) {
        this.executablePath = executablePath;
        this.spawnProcess = spawnProcess;
        this.createIpc = createIpc;
        this.pipeNameFactory = pipeNameFactory;
        this.platform = platform;
        this.loadTimeoutMs = loadTimeoutMs;
        this.runtimeManifestPath = runtimeManifestPath || path.join(path.dirname(executablePath), 'manifest.json');
        this.fileExists = fileExists;
        this.child = null;
        this.ipc = null;
        this.unsubscribeIpc = null;
        this.disposed = false;
        this.song = null;
        this.state = 'idle';
        this.positionMs = 0;
        this.durationMs = 0;
        this.pitch = 1;
        this.tempo = 1;
        this.requestedOutput = 'auto';
        this.activeOutput = 'auto';
        this.fallbackPending = false;
        this.revision = -1;
        this.order = -1;
        this.listeners = new Set();
        this.loadWait = null;
    }

    on(listener) {
        if (typeof listener !== 'function') throw new TypeError('listener must be a function');
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _emit(type, extra = {}) {
        const event = {
            type,
            state: this.state,
            positionMs: this.getPosition(),
            durationMs: this.getDuration(),
            ended: type === 'ended',
            revision: this.revision,
            order: ++this.order,
            ...extra,
        };
        this.listeners.forEach((listener) => listener(event));
        return event;
    }

    _ipcPath() {
        const pipeName = this.pipeNameFactory();
        return this.platform === 'win32' ? `\\\\.\\pipe\\${pipeName}` : path.join(os.tmpdir(), pipeName);
    }

    async _ensureStarted() {
        if (this.ipc) return;
        const diagnostic = mpvRuntimeDiagnostic({
            executablePath: this.executablePath,
            manifestPath: this.runtimeManifestPath,
            exists: this.fileExists,
        });
        if (diagnostic) {
            this._fail(diagnostic);
            throw Object.assign(new Error(diagnostic.message), diagnostic);
        }
        const ipcPath = this._ipcPath();
        const args = [
            '--no-config', '--no-video', '--force-window=no', '--audio-display=no',
            '--terminal=no', '--really-quiet', '--idle=yes', '--keep-open=no',
            '--no-input-default-bindings', '--audio-device=auto', '--audio-fallback-to-null=yes',
            `--input-ipc-server=${ipcPath}`,
        ];
        const child = this.spawnProcess(this.executablePath, args, {
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'pipe'],
        });
        if (!child || typeof child.on !== 'function') throw new TypeError('spawnProcess must return a child process');
        this.child = child;
        child.once('error', (error) => this._fail(normalizeError(error, 'mpv-process-error')));
        child.once('exit', (code) => {
            if (!this.disposed && code !== 0 && this.state !== 'error') {
                this._fail({ domain: 'player', code: 'mpv-process-exit', message: `mpv exited with code ${code}` });
            }
        });
        this.ipc = this.createIpc(ipcPath);
        if (!this.ipc || typeof this.ipc.connect !== 'function' || typeof this.ipc.request !== 'function') {
            throw new TypeError('createIpc must return an IPC client');
        }
        this.unsubscribeIpc = typeof this.ipc.onMessage === 'function'
            ? this.ipc.onMessage((message) => this._handleMessage(message)) : null;
        await this.ipc.connect();
        await this.ipc.request(['observe_property', 1, 'time-pos']);
        await this.ipc.request(['observe_property', 2, 'duration']);
        await this.ipc.request(['observe_property', 3, 'pause']);
        await this.ipc.request(['observe_property', 4, 'current-ao']);
    }

    async load(song) {
        if (!song || typeof song.src !== 'string' || !song.src) throw new TypeError('song.src is required');
        if (this.loadWait) this.loadWait.reject(new Error('previous mpv load superseded'));
        this.song = { ...song };
        this.revision += 1;
        this.order = -1;
        this.state = 'loading';
        this.positionMs = 0;
        this.durationMs = integerMs(song.durationMs);
        const loaded = new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.loadWait = null;
                const error = normalizeError(new Error('mpv load timeout'), 'mpv-load-timeout');
                this._fail(error);
                reject(error);
            }, this.loadTimeoutMs);
            this.loadWait = {
                resolve: (event) => { clearTimeout(timer); this.loadWait = null; resolve(event); },
                reject: (error) => { clearTimeout(timer); this.loadWait = null; reject(error); },
            };
        });
        try {
            if (!this.ipc) await this._ensureStarted();
            await this.ipc.request(['loadfile', song.src, 'replace']);
        } catch (error) {
            const normalized = normalizeError(error, 'mpv-load-error');
            if (this.loadWait) this.loadWait.reject(normalized);
            this._fail(normalized);
        }
        return loaded;
    }

    async play() {
        this._assertLoaded();
        if (this.state === 'ended') {
            await this.ipc.request(['set_property', 'time-pos', 0]);
            this.positionMs = 0;
        }
        await this.ipc.request(['set_property', 'pause', false]);
        this.state = 'playing';
        return this._emit('play');
    }

    async pause() {
        this._assertLoaded();
        await this.ipc.request(['set_property', 'pause', true]);
        this.state = 'paused';
        return this._emit('pause');
    }

    async seek(positionMs) {
        this._assertLoaded();
        if (!Number.isFinite(positionMs) || positionMs < 0) throw new TypeError('positionMs must be non-negative');
        const targetMs = this.durationMs > 0 ? Math.min(Math.round(positionMs), this.durationMs) : Math.round(positionMs);
        await this.ipc.request(['set_property', 'time-pos', targetMs / 1000]);
        this.positionMs = targetMs;
        if (this.state === 'ended') this.state = 'paused';
        return this._emit('seek');
    }

    async restart() {
        this._assertLoaded();
        if (this.state === 'ended') {
            await this.load({ ...this.song });
            return this._emit('restart');
        }
        await this.ipc.request(['set_property', 'time-pos', 0]);
        this.positionMs = 0;
        if (this.state !== 'playing') this.state = 'paused';
        return this._emit('restart');
    }

    async stop() {
        this._assertLoaded();
        await this.ipc.request(['set_property', 'pause', true]);
        await this.ipc.request(['set_property', 'time-pos', 0]);
        this.positionMs = 0;
        this.state = 'stopped';
        return this._emit('stop');
    }

    async setKey(semitones) {
        this._assertLoaded();
        const factor = keyToPitchFactor(semitones);
        await this.ipc.request(['set_property', 'pitch', factor]);
        this.pitch = factor;
        return { supported: true, semitones, factor };
    }

    async setTempo(rate) {
        this._assertLoaded();
        if (!Number.isFinite(rate) || rate <= 0) throw new TypeError('rate must be positive');
        await this.ipc.request(['set_property', 'speed', rate]);
        this.tempo = rate;
        return rate;
    }

    async getOutputDevices() {
        this._assertStarted();
        const response = await this.ipc.request(['get_property', 'audio-device-list']);
        return Array.isArray(response.data) ? response.data : [];
    }

    async setOutputDevice(deviceId) {
        this._assertLoaded();
        if (typeof deviceId !== 'string' || !deviceId) throw new TypeError('deviceId is required');
        await this.ipc.request(['set_property', 'audio-device', deviceId]);
        const readback = (await this.ipc.request(['get_property', 'audio-device'])).data;
        this.requestedOutput = deviceId;
        this.activeOutput = String(readback || 'null');
        return { supported: true, deviceId, readback, selected: readback === deviceId };
    }

    _fallbackOutput() {
        if (this.fallbackPending || this.requestedOutput === 'auto' || !this.ipc) return;
        this.fallbackPending = true;
        this.requestedOutput = 'auto';
        let request;
        try { request = this.ipc.request(['set_property', 'audio-device', 'auto']); }
        catch (error) { request = Promise.reject(error); }
        Promise.resolve(request)
            .then(() => this._emit('output', {
                output: { requested: 'auto', active: this.activeOutput, verified: false, degraded: true },
            }))
            .catch(() => {})
            .finally(() => { this.fallbackPending = false; });
    }

    getPosition() { return this.durationMs > 0 ? Math.min(this.positionMs, this.durationMs) : this.positionMs; }
    getDuration() { return this.durationMs; }
    getState() { return this.state; }

    async dispose() {
        this.disposed = true;
        if (this.loadWait) this.loadWait.reject(new Error('mpv player disposed'));
        try { if (this.ipc) await this.ipc.request(['quit'], 1000); } catch (error) {}
        if (this.unsubscribeIpc) this.unsubscribeIpc();
        if (this.ipc && typeof this.ipc.close === 'function') this.ipc.close();
        if (this.child && !this.child.killed && typeof this.child.kill === 'function') this.child.kill();
        this.ipc = null;
        this.child = null;
    }

    _assertStarted() {
        if (!this.ipc) throw new Error('mpv player is not started');
    }

    _assertLoaded() {
        this._assertStarted();
        if (!this.song) throw new Error('no song is loaded');
    }

    async _completeLoad() {
        if (!this.loadWait || !this.ipc) return;
        try {
            const duration = (await this.ipc.request(['get_property', 'duration'])).data;
            const position = (await this.ipc.request(['get_property', 'time-pos'])).data;
            if (Number.isFinite(duration) && duration > 0) this.durationMs = secondsToMs(duration);
            this.positionMs = integerMs(Number(position) * 1000);
            this.state = 'paused';
            this.loadWait.resolve(this._emit('load', { song: { ...this.song } }));
        } catch (error) {
            const normalized = normalizeError(error, 'mpv-load-error');
            this.loadWait.reject(normalized);
            this._fail(normalized);
        }
    }

    _handleMessage(message) {
        if (!message || typeof message !== 'object') return;
        if (message.event === 'file-loaded') {
            this._completeLoad();
            return;
        }
        if (message.event === 'property-change') {
            if (message.name === 'time-pos' && Number.isFinite(message.data)) this.positionMs = secondsToMs(message.data);
            if (message.name === 'duration' && Number.isFinite(message.data) && message.data > 0) this.durationMs = secondsToMs(message.data);
            if (message.name === 'pause' && this.state === 'playing' && message.data === true) this.state = 'paused';
            if (message.name === 'current-ao') {
                this.activeOutput = String(message.data || 'null');
                this._emit('output', {
                    output: {
                        requested: this.requestedOutput,
                        active: this.activeOutput,
                        verified: this.activeOutput !== 'null' && this.activeOutput === this.requestedOutput,
                        degraded: this.activeOutput === 'null' || this.activeOutput !== this.requestedOutput,
                    },
                });
                if (this.activeOutput === 'null') this._fallbackOutput();
            }
            return;
        }
        if (message.event === 'end-file') {
            if (message.reason === 'eof') {
                this.positionMs = this.durationMs;
                this.state = 'ended';
                this._emit('ended');
            } else if (message.reason === 'error') {
                this._fail({ domain: 'player', code: 'mpv-end-file', message: 'mpv failed while ending playback' });
            }
        }
    }

    _fail(error) {
        if (this.state === 'error') return;
        this.state = 'error';
        const normalized = normalizeError(error);
        if (this.loadWait) this.loadWait.reject(normalized);
        this._emit('error', { error: normalized });
    }
}

module.exports = {
    MpvIpcClient,
    MpvKaraokePlayer,
    PLAYER_EVENT_TYPES,
    integerMs,
    keyToPitchFactor,
    normalizeError,
    readMpvRuntimeManifest,
    mpvRuntimeDiagnostic,
    resolveMpvPath,
    secondsToMs,
};
