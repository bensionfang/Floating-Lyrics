const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packagePath = path.join(root, 'web-app', 'package.json');
const lockPath = path.join(root, 'web-app', 'package-lock.json');
const electronPath = path.join(root, 'web-app', 'electron.js');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
const electron = fs.readFileSync(electronPath, 'utf8');
const files = pkg.build.files || [];
const extraResources = pkg.build.extraResources || [];

assert.strictEqual(pkg.version, '1.1.0');
assert.strictEqual(lock.version, '1.1.0');
assert.strictEqual(lock.packages[''].version, '1.1.0');
assert.match(pkg.scripts['build:py'], /if exist .*venv/);
assert.strictEqual(pkg.build.npmRebuild, false);
assert.ok(files.includes('karaoke-player-service.js'));
assert.ok(files.includes('karaoke-stage-controller.js'));
assert.ok(files.includes('media-timing.js'));
assert.ok(files.includes('karaoke-library-scan.js'));
assert.ok(files.includes('karaoke-catalog.js'));
assert.ok(extraResources.some((item) => item.from === '../third_party' && item.to === 'third_party'));
assert.deepStrictEqual(pkg.build.publish[0], {
  provider: 'github',
  owner: 'bensionfang',
  repo: 'Kanaric',
});
assert.strictEqual(pkg.build.win.signAndEditExecutable, false);
assert.match(electron, /function setupAutoUpdate\(\)/);
assert.match(electron, /if \(!app\.isPackaged\) return/);
assert.match(electron, /autoUpdater\.autoDownload = true/);
assert.match(electron, /autoUpdater\.autoInstallOnAppQuit = true/);
assert.ok(fs.existsSync(path.join(root, 'third_party', 'mpv', 'manifest.json')));

console.log('test_karaoke_packaging: PASS');
