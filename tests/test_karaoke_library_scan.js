const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  parseKaraokeBasename,
  scanKaraokeFolder,
} = require('../web-app/karaoke-library-scan');

function writeFile(filePath, content = 'fixture') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function snapshotTree(rootPath) {
  const snapshot = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(rootPath, fullPath);
      const stat = fs.lstatSync(fullPath);
      const item = {
        relativePath,
        mode: stat.mode,
        size: stat.size,
        mtimeMs: stat.mtimeMs,
      };
      if (stat.isSymbolicLink()) item.target = fs.readlinkSync(fullPath);
      if (stat.isFile()) item.content = fs.readFileSync(fullPath, 'utf8');
      snapshot.push(item);
      if (stat.isDirectory()) visit(fullPath);
    }
  }
  visit(rootPath);
  return snapshot.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-karaoke-scan-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-karaoke-scan-outside-'));
  const symlinkPath = path.join(root, 'linked-outside');
  try {
    writeFile(path.join(root, 'album', '宇多田ヒカル - First Love.MP3'), 'audio');
    writeFile(path.join(root, 'album', '宇多田ヒカル - First Love.lrc'), '[00:01.00]First Love');
    writeFile(path.join(root, 'album', '宇多田ヒカル - First Love.jpg'), 'cover');
    writeFile(path.join(root, 'album', '宇多田ヒカル - First Love.mp4'), 'video');

    writeFile(path.join(root, 'case', 'Case Artist - Case Title.MP3'), 'audio');
    writeFile(path.join(root, 'case', 'case artist - case title.LRC'), '[00:01.00]Case');

    writeFile(path.join(root, 'conflict', 'Conflict Artist - Song.mp3'), 'audio-1');
    writeFile(path.join(root, 'conflict', 'Conflict Artist - Song.flac'), 'audio-2');
    writeFile(path.join(root, 'conflict', 'Conflict Artist - Song.jpg'), 'cover-1');
    writeFile(path.join(root, 'conflict', 'Conflict Artist - Song.png'), 'cover-2');
    writeFile(path.join(root, 'conflict', 'Conflict Artist - Song.lrc'), '[00:01.00]Conflict');

    writeFile(path.join(root, 'nested', 'deep', 'Nested Artist - Nested Song.wav'), 'audio');
    writeFile(path.join(root, 'nested', 'deep', 'Nested Artist - Nested Song.webp'), 'cover');
    writeFile(path.join(root, 'NoDelimiter.mp3'), 'audio');
    writeFile(path.join(root, 'No Audio - Only Attachments.lrc'), '[00:01.00]No audio');
    writeFile(path.join(root, 'No Audio - Only Attachments.png'), 'cover');
    writeFile(path.join(root, 'No Audio - Only Attachments.webm'), 'video');
    writeFile(path.join(root, 'ignored.txt'), 'unsupported');
    writeFile(path.join(root, 'ignored.mp3.bak'), 'unsupported');

    writeFile(path.join(outside, 'linked-outside.mp3'), 'must not be scanned');
    try {
      fs.symlinkSync(outside, symlinkPath, 'junction');
    } catch (error) {
      fs.symlinkSync(path.join(outside, 'linked-outside.mp3'), `${symlinkPath}.mp3`, 'file');
    }

    const unreadableDirectory = path.join(root, 'unreadable');
    fs.mkdirSync(unreadableDirectory);
    writeFile(path.join(unreadableDirectory, 'Unreadable Artist - Hidden.mp3'), 'hidden');

    assert.deepStrictEqual(parseKaraokeBasename('宇多田ヒカル - First Love'), {
      artist: '宇多田ヒカル', title: 'First Love', complete: true,
    });
    assert.deepStrictEqual(parseKaraokeBasename('Artist - Title - Live'), {
      artist: 'Artist', title: 'Title - Live', complete: true,
    });
    assert.deepStrictEqual(parseKaraokeBasename('NoDelimiter'), {
      artist: '', title: 'NoDelimiter', complete: false,
    });

    const before = snapshotTree(root);
    const preview = await scanKaraokeFolder(root);
    const after = snapshotTree(root);
    assert.deepStrictEqual(after, before);
    assert.strictEqual(preview.rootPath, path.resolve(root));
    assert.deepStrictEqual(preview.issues, []);
    assert.strictEqual(preview.candidates.some((item) => item.basename === 'linked-outside'), false);
    assert.strictEqual(preview.candidates.some((item) => item.basename === 'No Audio - Only Attachments'), false);
    assert.strictEqual(preview.candidates.some((item) => item.audioOptions.some((itemPath) => itemPath.endsWith('ignored.txt'))), false);

    const first = preview.candidates.find((item) => item.basename === '宇多田ヒカル - First Love');
    assert.ok(first);
    assert.deepStrictEqual(first.metadata, {
      artist: '宇多田ヒカル', title: 'First Love', complete: true,
    });
    assert.strictEqual(first.audioOptions.length, 1);
    assert.strictEqual(first.lyricOptions.length, 1);
    assert.strictEqual(first.videoOptions.length, 1);
    assert.strictEqual(first.coverOptions.length, 1);
    assert.strictEqual(first.lyricOptions[0].endsWith('宇多田ヒカル - First Love.lrc'), true);
    assert.match(first.candidateId, /^[a-f0-9]{64}$/);

    const caseMatch = preview.candidates.find((item) => item.metadata.title.toLowerCase() === 'case title');
    assert.ok(caseMatch);
    assert.strictEqual(caseMatch.audioOptions.length, 1);
    assert.strictEqual(caseMatch.lyricOptions.length, 1);
    assert.strictEqual(caseMatch.metadata.artist.toLowerCase(), 'case artist');

    const conflict = preview.candidates.find((item) => item.metadata.title === 'Song');
    assert.ok(conflict);
    assert.strictEqual(conflict.audioOptions.length, 2);
    assert.strictEqual(conflict.coverOptions.length, 2);
    assert.ok(conflict.issues.includes('asset-conflict'));

    const incomplete = preview.candidates.find((item) => item.basename === 'NoDelimiter');
    assert.ok(incomplete.issues.includes('metadata-incomplete'));
    assert.deepStrictEqual(preview.candidates.map((item) => item.candidateId), [...preview.candidates]
      .sort((a, b) => `${a.metadata.artist}\0${a.metadata.title}\0${a.candidateId}`
        .localeCompare(`${b.metadata.artist}\0${b.metadata.title}\0${b.candidateId}`, 'zh-Hant'))
      .map((item) => item.candidateId));

    const failingFs = {
      stat: (...args) => fs.promises.stat(...args),
      readdir: (directory, options) => {
        if (path.resolve(directory) === path.resolve(unreadableDirectory)) {
          const error = new Error('permission denied');
          error.code = 'EACCES';
          return Promise.reject(error);
        }
        return fs.promises.readdir(directory, options);
      },
    };
    const withIssue = await scanKaraokeFolder(root, { fs: failingFs });
    assert.deepStrictEqual(withIssue.issues, [{
      code: 'directory-unreadable',
      path: unreadableDirectory,
      message: 'permission denied',
    }]);
    assert.strictEqual(withIssue.candidates.some((item) => item.basename === 'Unreadable Artist - Hidden'), false);

    await assert.rejects(
      () => scanKaraokeFolder(path.join(root, 'missing-root')),
      (error) => error.code === 'karaoke-folder-invalid',
    );

    const repeat = await scanKaraokeFolder(root);
    assert.deepStrictEqual(repeat.candidates, preview.candidates);
    console.log('test_karaoke_library_scan: PASS');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
