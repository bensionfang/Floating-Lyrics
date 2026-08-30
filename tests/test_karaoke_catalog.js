const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Module = require('module');

const { createKaraokeCatalog } = require('../web-app/karaoke-catalog');

function writeFile(filePath, content = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

async function waitFor(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status > 0) return response;
    } catch (error) {
      // Keep polling until the child server is ready.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start: ${url}`);
}

function stopChild(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  });
}

async function testElectronFolderChooser() {
  const electronPath = require.resolve('../web-app/electron.js');
  const originalLoad = Module._load;
  const previousChooser = global.selectKaraokeLibraryFolder;
  const dialogCalls = [];
  let beforeQuit;
  let dialogResult = { canceled: false, filePaths: ['C:\\Music'] };
  const fakeElectron = {
    app: {
      isPackaged: false,
      requestSingleInstanceLock: () => true,
      whenReady: () => ({ then: () => {} }),
      on: (event, handler) => { if (event === 'before-quit') beforeQuit = handler; },
      exit: () => {},
      quit: () => {},
      relaunch: () => {},
    },
    BrowserWindow: class {},
    Tray: class {},
    Menu: { buildFromTemplate: () => ({}) },
    nativeImage: { createFromDataURL: () => ({ toDataURL: () => 'data:image/png;base64,' }) },
    dialog: {
      showOpenDialog: async (parent, options) => {
        dialogCalls.push({ parent, options });
        return dialogResult;
      },
    },
  };
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') return fakeElectron;
    return originalLoad.call(this, request, parent, isMain);
  };
  delete require.cache[electronPath];
  try {
    require(electronPath);
    assert.strictEqual(typeof global.selectKaraokeLibraryFolder, 'function');
    assert.strictEqual(await global.selectKaraokeLibraryFolder(), 'C:\\Music');
    dialogResult = { canceled: true, filePaths: [] };
    assert.strictEqual(await global.selectKaraokeLibraryFolder(), null);
    assert.strictEqual(dialogCalls.length, 2);
    assert.strictEqual(dialogCalls[0].parent, null);
    assert.deepStrictEqual(dialogCalls[0].options, {
      title: '加入卡拉OK歌曲資料夾',
      properties: ['openDirectory'],
    });
    beforeQuit();
    assert.strictEqual(await global.selectKaraokeLibraryFolder(), null);
    assert.strictEqual(dialogCalls.length, 2);
  } finally {
    Module._load = originalLoad;
    delete require.cache[electronPath];
    if (previousChooser === undefined) delete global.selectKaraokeLibraryFolder;
    else global.selectKaraokeLibraryFolder = previousChooser;
  }
}

async function testCatalogService(root) {
  const audioPath = path.join(root, 'Aimer - 殘響散歌.mp3');
  const lyricPath = path.join(root, 'Aimer - 殘響散歌.lrc');
  const videoPath = path.join(root, 'Aimer - 殘響散歌.mp4');
  const coverPath = path.join(root, 'Aimer - 殘響散歌.jpg');
  writeFile(audioPath, 'audio');
  writeFile(lyricPath, '[00:01.00]殘響散歌\n[00:02.00]絆');
  writeFile(videoPath, 'video');
  writeFile(coverPath, 'cover');

  writeFile(path.join(root, 'Conflict - Choice.mp3'), 'audio-1');
  writeFile(path.join(root, 'Conflict - Choice.flac'), 'audio-2');

  const importedInputs = [];
  const searchQueries = [];
  const library = {
    async importSong(input) {
      importedInputs.push(input);
      return {
        songId: input.songId,
        title: input.metadata.title,
        artist: input.metadata.artist,
        audio: { path: input.audio.path },
      };
    },
    async searchSongs(query) {
      searchQueries.push(query);
      return [{
        songId: 'local-aimer',
        title: '殘響散歌',
        artist: 'Aimer',
        album: null,
        variant: 'studio',
        lyricsStatus: 'ready',
        audio: { path: path.join(root, 'secret.mp3') },
      }];
    },
  };

  let currentTime = 1_000_000;
  let chooserCalls = 0;
  const catalog = createKaraokeCatalog({
    library,
    chooseFolder: async () => { chooserCalls += 1; return root; },
    now: () => currentTime,
    idFactory: () => 'scan-1',
  });

  const scan = await catalog.createScan();
  assert.strictEqual(chooserCalls, 1);
  assert.strictEqual(scan.scanId, 'scan-1');
  assert.strictEqual(scan.expiresAt, 1_600_000);
  const candidate = scan.candidates.find((item) => item.basename === 'Aimer - 殘響散歌');
  assert.ok(candidate);
  assert.strictEqual(scan.candidates.find((item) => item.basename === 'Conflict - Choice').issues.includes('asset-conflict'), true);

  const imported = await catalog.importScan(scan.scanId, [{
    candidateId: candidate.candidateId,
    include: true,
    artist: 'Aimer',
    title: '殘響散歌',
    audioIndex: 0,
    lyricIndex: 0,
    videoIndex: 0,
    coverIndex: 0,
    audioPath: path.join(root, 'attacker.mp3'),
  }]);
  assert.strictEqual(imported.imported, 1);
  assert.strictEqual(imported.items[0].title, '殘響散歌');
  assert.strictEqual(importedInputs.length, 1);
  assert.strictEqual(importedInputs[0].audio.path, audioPath);
  assert.strictEqual(importedInputs[0].lyrics, '[00:01.00]殘響散歌\n[00:02.00]絆');
  assert.strictEqual(importedInputs[0].video.path, videoPath);
  assert.strictEqual(importedInputs[0].cover.path, coverPath);
  const expectedDigest = crypto.createHash('sha256')
    .update(path.resolve(audioPath).toLocaleLowerCase('en-US'))
    .digest('hex');
  assert.strictEqual(importedInputs[0].songId, `local:${expectedDigest}`);
  await assert.rejects(
    () => catalog.importScan(scan.scanId, []),
    (error) => error.code === 'karaoke-scan-expired',
  );

  const search = await catalog.search('  Aimer  ');
  assert.deepStrictEqual(search, [{
    songId: 'local-aimer', title: '殘響散歌', artist: 'Aimer', album: null, variant: 'studio',
    lyricsStatus: 'ready',
  }]);
  assert.deepStrictEqual(searchQueries, ['Aimer']);
  await catalog.search(`${'😀'.repeat(100)}tail`);
  assert.strictEqual([...searchQueries[1]].length, 100);

  const conflictScan = await catalog.createScan();
  const conflict = conflictScan.candidates.find((item) => item.basename === 'Conflict - Choice');
  const rejected = await catalog.importScan(conflictScan.scanId, [{
    candidateId: conflict.candidateId,
    include: true,
    artist: 'Conflict',
    title: 'Choice',
  }]);
  assert.strictEqual(rejected.imported, 0);
  assert.deepStrictEqual(rejected.rejected, [{
    candidateId: conflict.candidateId,
    code: 'karaoke-asset-selection-required',
  }]);

  const staleScan = await catalog.createScan();
  currentTime = staleScan.expiresAt;
  await assert.rejects(
    () => catalog.importScan(staleScan.scanId, []),
    (error) => error.code === 'karaoke-scan-expired',
  );

  const cancelledCatalog = createKaraokeCatalog({ library, chooseFolder: async () => null });
  assert.strictEqual(await cancelledCatalog.createScan(), null);
}

async function testAdminRoutes(root) {
  const port = 5737;
  const remotePort = 5738;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'web-app'),
    env: {
      ...process.env,
      PORT: String(port),
      REMOTE_PORT: String(remotePort),
      DB_PATH: path.join(root, 'server.db'),
      DATA_DIR: root,
    },
    stdio: 'ignore',
  });
  const base = `http://127.0.0.1:${port}`;
  const remote = `http://127.0.0.1:${remotePort}`;
  try {
    await waitFor(`${base}/api/settings`);
    const search = await fetch(`${base}/api/karaoke/library/search?q=Aimer`);
    assert.strictEqual(search.status, 200);
    assert.deepStrictEqual(await search.json(), { items: [] });

    const scan = await fetch(`${base}/api/karaoke/library/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.strictEqual(scan.status, 400);
    assert.deepStrictEqual(await scan.json(), {
      error: 'karaoke-folder-picker-unavailable',
    });

    const remoteSearch = await fetch(`${remote}/api/karaoke/library/search?q=Aimer`);
    assert.strictEqual(remoteSearch.status, 404);
    const crossSite = await fetch(`${base}/api/karaoke/library/search?q=Aimer`, {
      headers: { Origin: 'https://evil.example' },
    });
    assert.strictEqual(crossSite.status, 403);
  } finally {
    await stopChild(child);
  }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-karaoke-catalog-'));
  try {
    await testElectronFolderChooser();
    await testCatalogService(root);
    await testAdminRoutes(root);
    console.log('test_karaoke_catalog: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
