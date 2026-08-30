const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { scanKaraokeFolder } = require('./karaoke-library-scan');

const SCAN_TTL_MS = 10 * 60 * 1000;

function catalogError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createKaraokeCatalog({ library, chooseFolder, now = Date.now, idFactory = crypto.randomUUID }) {
  const scans = new Map();

  function getScan(scanId) {
    const key = String(scanId);
    const record = scans.get(key);
    if (!record || record.expiresAt <= now()) {
      scans.delete(key);
      throw catalogError('karaoke-scan-expired');
    }
    return record;
  }

  function selectAsset(options, index, required) {
    if (!options.length) {
      if (required) throw catalogError('karaoke-audio-required');
      return null;
    }
    const selectedIndex = index === undefined || index === null
      ? (options.length === 1 ? 0 : -1) : Number(index);
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= options.length) {
      throw catalogError('karaoke-asset-selection-required');
    }
    const selected = options[selectedIndex];
    let stat;
    try { stat = fs.lstatSync(selected); } catch (error) { throw catalogError('karaoke-asset-missing'); }
    if (!stat.isFile() || stat.isSymbolicLink()) throw catalogError('karaoke-asset-missing');
    return selected;
  }

  return {
    async createScan() {
      const rootPath = await chooseFolder();
      if (!rootPath) return null;
      const preview = await scanKaraokeFolder(rootPath);
      const scanId = String(idFactory());
      const expiresAt = now() + SCAN_TTL_MS;
      scans.set(scanId, { preview, expiresAt });
      return { scanId, expiresAt, ...preview };
    },

    async importScan(scanId, corrections) {
      const record = getScan(scanId);
      const candidates = new Map(record.preview.candidates.map((candidate) => [candidate.candidateId, candidate]));
      const items = [];
      const rejected = [];
      try {
        for (const correction of Array.isArray(corrections) ? corrections : []) {
          if (!correction || correction.include === false) continue;
          const candidateId = correction && correction.candidateId;
          try {
            const candidate = candidates.get(String(candidateId));
            if (!candidate) throw catalogError('karaoke-candidate-invalid');
            const artist = String(correction.artist || '').trim();
            const title = String(correction.title || '').trim();
            if (!artist || !title) throw catalogError('karaoke-metadata-incomplete');

            const audioPath = selectAsset(candidate.audioOptions, correction.audioIndex, true);
            const lyricPath = selectAsset(candidate.lyricOptions, correction.lyricIndex, false);
            const videoPath = selectAsset(candidate.videoOptions, correction.videoIndex, false);
            const coverPath = selectAsset(candidate.coverOptions, correction.coverIndex, false);
            const normalizedAudioPath = path.normalize(path.resolve(audioPath)).toLocaleLowerCase('en-US');
            const songId = `local:${crypto.createHash('sha256').update(normalizedAudioPath, 'utf8').digest('hex')}`;
            items.push(await library.importSong({
              songId,
              metadata: { artist, title },
              audio: { path: audioPath },
              video: videoPath ? { path: videoPath } : null,
              cover: coverPath ? { path: coverPath } : null,
              lyrics: lyricPath ? fs.readFileSync(lyricPath, 'utf8') : '',
            }));
          } catch (error) {
            rejected.push({ candidateId, code: error.code || error.message });
          }
        }
      } finally {
        scans.delete(String(scanId));
      }
      return { imported: items.length, items, rejected };
    },

    async search(query) {
      const limitedQuery = [...String(query ?? '').trim()].slice(0, 100).join('');
      const songs = await library.searchSongs(limitedQuery);
      return songs.map((song) => ({
        songId: song.songId,
        title: song.title,
        artist: song.artist,
        album: song.album ?? null,
        variant: song.variant ?? 'studio',
        lyricsStatus: song.lyricsStatus ?? 'missing',
      }));
    },
  };
}

module.exports = { SCAN_TTL_MS, createKaraokeCatalog };
