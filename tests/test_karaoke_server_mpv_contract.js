'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = fs.readFileSync(path.join(root, 'web-app/server.js'), 'utf8');
const stage = fs.readFileSync(path.join(root, 'web-app/public/js/karaoke-mode.js'), 'utf8');
const host = fs.readFileSync(path.join(root, 'web-app/public/js/karaoke-host.js'), 'utf8');
const hostView = fs.readFileSync(path.join(root, 'web-app/views/host.ejs'), 'utf8');
const player = fs.readFileSync(path.join(root, 'web-app/mpv-karaoke-player.js'), 'utf8');

assert.match(server, /createKaraokePlayerService/);
assert.match(server, /createKaraokeStageController/);
assert.match(server, /karaoke_player_command/);
assert.match(server, /karaoke_player_output_devices/);
assert.match(server, /karaoke_player_output_device/);
assert.match(player, /current-ao/);
assert.match(server, /player=mpv|playerMode/);
assert.match(stage, /query\.get\('player'\) === 'mpv'/);
assert.match(stage, /karaoke_player_command/);
assert.match(host, /karaoke_player_output_devices/);
assert.match(hostView, /host-output-device/);
assert.doesNotMatch(server, /remote_admin/);
console.log('test_karaoke_server_mpv_contract: OK');
