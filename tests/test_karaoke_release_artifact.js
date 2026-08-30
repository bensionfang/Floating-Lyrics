const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const asar = require('../web-app/node_modules/@electron/asar');

const root = path.join(__dirname, '..');
const releaseDir = process.env.KANARIC_RELEASE_DIR
  ? path.resolve(process.env.KANARIC_RELEASE_DIR)
  : path.join(root, 'web-app', 'release-final-2');
const exeName = 'Kanaric-Setup-1.1.0.exe';
const exePath = path.join(releaseDir, exeName);
const blockmapPath = `${exePath}.blockmap`;
const latestPath = path.join(releaseDir, 'latest.yml');
const asarPath = path.join(releaseDir, 'win-unpacked', 'resources', 'app.asar');
const mpvDir = path.join(releaseDir, 'win-unpacked', 'resources', 'third_party', 'mpv');

assert.ok(fs.existsSync(exePath));
assert.ok(fs.existsSync(blockmapPath));
assert.ok(fs.existsSync(latestPath));
assert.ok(fs.existsSync(asarPath));
assert.ok(fs.existsSync(path.join(mpvDir, 'mpv.exe')));
assert.ok(fs.existsSync(path.join(mpvDir, 'manifest.json')));

const latest = fs.readFileSync(latestPath, 'utf8');
const version = /^version:\s*(\S+)/m.exec(latest);
const url = /^\s*- url:\s*(\S+)/m.exec(latest);
const hash = /^\s*sha512:\s*(\S+)/m.exec(latest);
const size = /^\s*size:\s*(\d+)/m.exec(latest);
assert.strictEqual(version && version[1], '1.1.0');
assert.strictEqual(url && url[1], exeName);
assert.strictEqual(Number(size && size[1]), fs.statSync(exePath).size);
assert.strictEqual(hash && hash[1], crypto.createHash('sha512').update(fs.readFileSync(exePath)).digest('base64'));

const entries = asar.listPackage(asarPath).map((entry) => entry.replace(/^\\/, ''));
for (const required of ['karaoke-catalog.js', 'media-timing.js', 'karaoke-library-scan.js',
  'karaoke-player-service.js', 'karaoke-stage-controller.js', 'mpv-karaoke-player.js']) {
  assert.ok(entries.includes(required), `app.asar missing ${required}`);
}

console.log(JSON.stringify({ artifact: exePath, version: version[1], size: fs.statSync(exePath).size, latestYml: latestPath }));
