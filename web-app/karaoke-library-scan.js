const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const EXTENSION_KIND = new Map([
  ['.mp3', 'audio'], ['.m4a', 'audio'], ['.aac', 'audio'],
  ['.flac', 'audio'], ['.wav', 'audio'], ['.ogg', 'audio'], ['.opus', 'audio'],
  ['.lrc', 'lyric'],
  ['.mp4', 'video'], ['.mkv', 'video'], ['.webm', 'video'],
  ['.jpg', 'cover'], ['.jpeg', 'cover'], ['.png', 'cover'], ['.webp', 'cover'],
]);

function invalidFolderError() {
  const error = new Error('karaoke folder is invalid');
  error.code = 'karaoke-folder-invalid';
  return error;
}

function parseKaraokeBasename(basename) {
  const value = String(basename);
  const separator = value.indexOf(' - ');
  if (separator < 1 || separator >= value.length - 3) {
    return { artist: '', title: value.trim(), complete: false };
  }
  return {
    artist: value.slice(0, separator).trim(),
    title: value.slice(separator + 3).trim(),
    complete: true,
  };
}

async function scanKaraokeFolder(rootPath, options = {}) {
  if (typeof rootPath !== 'string' || !rootPath) throw invalidFolderError();
  const io = options.fs || fs;
  const root = path.resolve(rootPath);
  const rootStat = await io.stat(root).catch(() => null);
  if (!rootStat || !rootStat.isDirectory()) throw invalidFolderError();

  const groups = new Map();
  const issues = [];

  async function visit(directory) {
    let entries;
    try {
      entries = await io.readdir(directory, { withFileTypes: true });
    } catch (error) {
      issues.push({ code: 'directory-unreadable', path: directory, message: error.message });
      return;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'en-US'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;

      const extension = path.extname(entry.name).toLowerCase();
      const kind = EXTENSION_KIND.get(extension);
      if (!kind) continue;
      const basename = entry.name.slice(0, -path.extname(entry.name).length);
      const key = path.join(directory, basename).toLocaleLowerCase('en-US');
      if (!groups.has(key)) {
        groups.set(key, { basename, audio: [], lyric: [], video: [], cover: [] });
      }
      groups.get(key)[kind].push(fullPath);
    }
  }

  await visit(root);
  const candidates = [...groups.entries()]
    .filter(([, group]) => group.audio.length > 0)
    .map(([key, group]) => {
      for (const kind of ['audio', 'lyric', 'video', 'cover']) group[kind].sort();
      const metadata = parseKaraokeBasename(group.basename);
      const candidateIssues = [];
      if (!metadata.complete) candidateIssues.push('metadata-incomplete');
      if (group.audio.length > 1 || group.lyric.length > 1
        || group.video.length > 1 || group.cover.length > 1) {
        candidateIssues.push('asset-conflict');
      }
      return {
        candidateId: crypto.createHash('sha256').update(key, 'utf8').digest('hex'),
        basename: group.basename,
        metadata,
        audioOptions: group.audio,
        lyricOptions: group.lyric,
        videoOptions: group.video,
        coverOptions: group.cover,
        issues: candidateIssues,
      };
    });

  candidates.sort((a, b) => `${a.metadata.artist}\0${a.metadata.title}\0${a.candidateId}`
    .localeCompare(`${b.metadata.artist}\0${b.metadata.title}\0${b.candidateId}`, 'zh-Hant'));
  return { rootPath: root, candidates, issues };
}

module.exports = { scanKaraokeFolder, parseKaraokeBasename };
