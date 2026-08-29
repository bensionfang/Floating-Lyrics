const crypto = require('crypto');
const fs = require('fs');
const { parseLrc } = require('./public/js/lrc-parse');

const DURATION_TOLERANCE_MS = 3000;
const SCHEMA = `
CREATE TABLE IF NOT EXISTS songs (
  song_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  album TEXT,
  variant TEXT NOT NULL DEFAULT 'studio',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS song_audio_assets (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  path TEXT,
  fingerprint TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS song_video_assets (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  path TEXT,
  duration_ms INTEGER,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS song_covers (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  path TEXT,
  status TEXT NOT NULL,
  error TEXT
);
CREATE TABLE IF NOT EXISTS song_lyrics (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  content TEXT,
  format TEXT NOT NULL,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  has_words INTEGER NOT NULL DEFAULT 0,
  has_ruby INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS song_lyric_translations (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_preferences (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS song_search_index (
  song_id TEXT PRIMARY KEY REFERENCES songs(song_id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  artist TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '',
  kana TEXT NOT NULL DEFAULT '',
  romaji TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS legacy_song_map (
  legacy_artist TEXT NOT NULL,
  legacy_title TEXT NOT NULL,
  song_id TEXT NOT NULL,
  PRIMARY KEY (legacy_artist, legacy_title)
);
CREATE INDEX IF NOT EXISTS song_search_title_idx ON song_search_index(title);
CREATE INDEX IF NOT EXISTS song_search_artist_idx ON song_search_index(artist);
CREATE INDEX IF NOT EXISTS song_search_aliases_idx ON song_search_index(aliases);
CREATE INDEX IF NOT EXISTS song_search_kana_idx ON song_search_index(kana);
CREATE INDEX IF NOT EXISTS song_search_romaji_idx ON song_search_index(romaji);
`;

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(error) {
    if (error) reject(error);
    else resolve(this);
  });
});

const get = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (error, row) => error ? reject(error) : resolve(row || null));
});

const all = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (error, rows) => error ? reject(error) : resolve(rows || []));
});

function ensureSongLibrarySchema(db, callback) {
  const promise = new Promise((resolve, reject) => {
    db.exec(SCHEMA, (error) => error ? reject(error) : resolve());
  });
  if (callback) promise.then(() => callback(null), callback);
  return promise;
}

function normalizeSearchText(value) {
  return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

function listSearchValues(value) {
  const values = Array.isArray(value) ? value : [value];
  return [...new Set(values.map(normalizeSearchText).filter(Boolean))];
}

function timeKey(match) {
  const minutes = String(match[1]).padStart(2, '0');
  const seconds = String(match[2]).padStart(2, '0');
  const fraction = String(match[3] || '').padEnd(2, '0').slice(0, 3);
  return `${minutes}:${seconds}.${fraction}`;
}

function splitTranslations(text) {
  const translations = {};
  const timeTag = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
  const lines = String(text || '').split(/\r?\n/).filter((line) => {
    const withoutTime = line.replace(timeTag, '').trim();
    if (!withoutTime.startsWith('#TRANS#')) return true;
    timeTag.lastIndex = 0;
    let match;
    let foundTime = false;
    while ((match = timeTag.exec(line)) !== null) {
      translations[timeKey(match)] = withoutTime.substring(7).trim();
      foundTime = true;
    }
    if (!foundTime) translations[''] = withoutTime.substring(7).trim();
    return false;
  });
  return { content: lines.join('\n'), translations };
}

function inspectLyrics(input, audioDurationMs) {
  const text = input && typeof input === 'object' ? String(input.text || '') : String(input || '');
  if (!text.trim()) {
    return {
      content: null, format: 'none', status: 'missing', durationMs: null,
      hasWords: false, hasRuby: false, error: null, translations: {},
    };
  }

  const split = splitTranslations(text);
  const timeTag = /\[(\d+):(\d+)(?:[.:](\d+))?\]/g;
  let malformed = null;
  let hasTime = false;
  for (const line of split.content.split(/\r?\n/)) {
    for (const match of line.matchAll(/\[([^\]]*)\]/g)) {
      const tag = match[1];
      const validTime = /^(\d+):(\d+)(?:[.:](\d+))?$/.exec(tag);
      if (validTime) {
        hasTime = true;
        if (Number(validTime[2]) >= 60) malformed = `invalid timestamp: ${tag}`;
      } else if (/^\d+:[^\d]/.test(tag)) {
        malformed = `invalid timestamp: ${tag}`;
      } else if (!/^(?:source|ar|ti|al|by|offset|re|ve|length):/i.test(tag)) {
        // Unknown bracket metadata is kept as lyric text; only timestamp-shaped
        // tags are malformed because ordinary lyrics may legitimately contain [] .
      }
    }
  }

  const parsed = parseLrc(split.content);
  const requestedDurationMs = Number(input && input.durationMs);
  const durationMs = Number.isFinite(requestedDurationMs) && requestedDurationMs > 0
    ? Math.round(requestedDurationMs) : null;
  let status = 'ready';
  let error = null;
  if (malformed || (hasTime && !parsed.lines.length)) {
    status = 'malformed';
    error = malformed || 'no valid lyric lines';
  } else if (!hasTime || parsed.unsynced) {
    status = 'unsynced';
  } else if (audioDurationMs && durationMs && Math.abs(audioDurationMs - durationMs) > DURATION_TOLERANCE_MS) {
    status = 'duration-mismatch';
    error = `audio ${audioDurationMs}ms vs lyrics ${durationMs}ms`;
  }

  return {
    content: split.content,
    format: hasTime ? 'lrc' : 'txt',
    status,
    durationMs,
    hasWords: /#WORDS#/.test(split.content),
    hasRuby: /<ruby\b/i.test(split.content),
    error,
    translations: split.translations,
  };
}

function inspectAsset(asset, kind, exists = fs.existsSync) {
  const pathValue = asset && typeof asset === 'object' ? asset.path : asset;
  if (!pathValue) return { path: null, durationMs: null, fingerprint: null, status: kind === 'video' ? 'none' : 'missing', error: null };
  try {
    if (!exists(pathValue) || !fs.statSync(pathValue).isFile()) {
      return { path: pathValue, durationMs: null, fingerprint: null, status: kind === 'video' ? 'unavailable' : 'missing', error: 'file not found' };
    }
  } catch (error) {
    return { path: pathValue, durationMs: null, fingerprint: null, status: kind === 'video' ? 'unavailable' : 'invalid', error: error.message };
  }
  const duration = Number(asset && asset.durationMs);
  return {
    path: pathValue,
    durationMs: Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : null,
    fingerprint: asset && asset.fingerprint ? String(asset.fingerprint) : null,
    status: 'ready',
    error: null,
  };
}

function json(value, fallback) {
  try { return value == null ? fallback : JSON.parse(value); } catch (error) { return fallback; }
}

function lyricPolicy(status) {
  return {
    missing: 'show-missing-lyrics',
    malformed: 'show-lyrics-error',
    'duration-mismatch': 'show-duration-warning',
    unsynced: 'show-unsynced-lyrics',
    ready: 'show-lyrics',
  }[status] || 'show-lyrics-error';
}

class SongLibrary {
  constructor(db, options = {}) {
    this.db = db;
    this.exists = options.exists || fs.existsSync;
    this.ready = ensureSongLibrarySchema(db);
  }

  async importSong(input) {
    await this.ready;
    if (!input || !input.songId) throw new Error('songId is required for local song import');
    const metadata = input.metadata || {};
    const title = String(metadata.title || input.title || '').trim();
    const artist = String(metadata.artist || input.artist || '').trim();
    if (!title || !artist) throw new Error('title and artist are required for local song import');
    const songId = String(input.songId);
    const audio = inspectAsset(input.audio, 'audio', this.exists);
    const video = inspectAsset(input.video, 'video', this.exists);
    const cover = inspectAsset(input.cover, 'cover', this.exists);
    const lyrics = inspectLyrics(input.lyrics, audio.durationMs);
    const aliases = listSearchValues(input.search?.aliases ?? metadata.aliases).join(' ');
    const kana = listSearchValues(input.search?.kana ?? metadata.kana).join(' ');
    const romaji = listSearchValues(input.search?.romaji ?? metadata.romaji).join(' ');
    const preferences = input.preferences && typeof input.preferences === 'object' ? input.preferences : {};

    await run(this.db, 'BEGIN IMMEDIATE');
    try {
      await run(this.db, `INSERT INTO songs (song_id, title, artist, album, variant)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(song_id) DO UPDATE SET title=excluded.title, artist=excluded.artist,
          album=excluded.album, variant=excluded.variant, updated_at=CURRENT_TIMESTAMP`,
      [songId, title, artist, metadata.album || null, metadata.variant || 'studio']);
      await run(this.db, `INSERT OR REPLACE INTO song_audio_assets
        (song_id, path, fingerprint, duration_ms, status, error) VALUES (?, ?, ?, ?, ?, ?)`,
      [songId, audio.path, audio.fingerprint, audio.durationMs, audio.status, audio.error]);
      await run(this.db, 'DELETE FROM song_video_assets WHERE song_id=?', [songId]);
      if (input.video) {
        await run(this.db, `INSERT INTO song_video_assets
          (song_id, path, duration_ms, status, error) VALUES (?, ?, ?, ?, ?)`,
        [songId, video.path, video.durationMs, video.status, video.error]);
      }
      await run(this.db, 'DELETE FROM song_covers WHERE song_id=?', [songId]);
      if (input.cover) {
        await run(this.db, 'INSERT INTO song_covers (song_id, path, status, error) VALUES (?, ?, ?, ?)',
          [songId, cover.path, cover.status, cover.error]);
      }
      await run(this.db, `INSERT OR REPLACE INTO song_lyrics
        (song_id, content, format, status, duration_ms, has_words, has_ruby, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [songId, lyrics.content, lyrics.format, lyrics.status, lyrics.durationMs,
        lyrics.hasWords ? 1 : 0, lyrics.hasRuby ? 1 : 0, lyrics.error]);
      await run(this.db, 'INSERT OR REPLACE INTO song_lyric_translations (song_id, data) VALUES (?, ?)',
        [songId, JSON.stringify(lyrics.translations)]);
      await run(this.db, 'INSERT OR REPLACE INTO song_preferences (song_id, data) VALUES (?, ?)',
        [songId, JSON.stringify(preferences)]);
      await run(this.db, `INSERT OR REPLACE INTO song_search_index
        (song_id, title, artist, aliases, kana, romaji) VALUES (?, ?, ?, ?, ?, ?)`,
      [songId, normalizeSearchText(title), normalizeSearchText(artist), aliases, kana, romaji]);
      await run(this.db, 'COMMIT');
    } catch (error) {
      try { await run(this.db, 'ROLLBACK'); } catch (rollbackError) { /* preserve the original failure */ }
      throw error;
    }
    return this.loadSong(songId);
  }

  reindexSong(songId, input) {
    return this.importSong({ ...input, songId });
  }

  async searchSongs(query) {
    await this.ready;
    const needle = `%${normalizeSearchText(query)}%`;
    return all(this.db, `SELECT s.song_id AS songId, s.title, s.artist, s.album, s.variant
      FROM songs s JOIN song_search_index i ON i.song_id=s.song_id
      WHERE i.title LIKE ? OR i.artist LIKE ? OR i.aliases LIKE ? OR i.kana LIKE ? OR i.romaji LIKE ?
      ORDER BY i.artist, i.title, s.variant, s.song_id`, [needle, needle, needle, needle, needle]);
  }

  async loadSong(songId) {
    await this.ready;
    const song = await get(this.db, 'SELECT song_id AS songId, title, artist, album, variant FROM songs WHERE song_id=?', [songId]);
    if (!song) return null;
    const [audio, video, cover, lyrics, translations, preferences] = await Promise.all([
      get(this.db, 'SELECT path, fingerprint, duration_ms AS durationMs, status, error FROM song_audio_assets WHERE song_id=?', [songId]),
      get(this.db, 'SELECT path, duration_ms AS durationMs, status, error FROM song_video_assets WHERE song_id=?', [songId]),
      get(this.db, 'SELECT path, status, error FROM song_covers WHERE song_id=?', [songId]),
      get(this.db, 'SELECT content, format, status, duration_ms AS durationMs, has_words AS hasWords, has_ruby AS hasRuby, error FROM song_lyrics WHERE song_id=?', [songId]),
      get(this.db, 'SELECT data FROM song_lyric_translations WHERE song_id=?', [songId]),
      get(this.db, 'SELECT data FROM song_preferences WHERE song_id=?', [songId]),
    ]);
    const lyricStatus = lyrics ? lyrics.status : 'missing';
    const videoState = video || { path: null, durationMs: null, status: 'none', error: null };
    const audioState = audio || { path: null, durationMs: null, status: 'missing', error: null };
    return {
      ...song,
      playable: audioState.status === 'ready',
      playbackMode: videoState.status === 'ready' ? 'audio-video' : 'audio-only',
      audio: { ...audioState, playable: audioState.status === 'ready' },
      video: { ...videoState, available: videoState.status === 'ready' },
      cover: cover || { path: null, status: 'none', error: null },
      lyrics: {
        ...(lyrics || { content: null, format: 'none', durationMs: null, hasWords: 0, hasRuby: 0, error: null }),
        hasWords: !!(lyrics && lyrics.hasWords),
        hasRuby: !!(lyrics && lyrics.hasRuby),
        policy: lyricPolicy(lyricStatus),
        translations: json(translations && translations.data, {}),
      },
      preferences: json(preferences && preferences.data, {}),
    };
  }

  async mapLegacySong(artist, title) {
    await this.ready;
    const legacyArtist = String(artist);
    const legacyTitle = String(title);
    const existing = await get(this.db, 'SELECT song_id AS songId FROM legacy_song_map WHERE legacy_artist=? AND legacy_title=?', [legacyArtist, legacyTitle]);
    if (existing) return existing.songId;
    const digest = crypto.createHash('sha256').update(`${legacyArtist}\0${legacyTitle}`, 'utf8').digest('hex');
    const songId = `legacy:${digest}`;
    await run(this.db, 'INSERT OR IGNORE INTO legacy_song_map (legacy_artist, legacy_title, song_id) VALUES (?, ?, ?)', [legacyArtist, legacyTitle, songId]);
    const mapped = await get(this.db, 'SELECT song_id AS songId FROM legacy_song_map WHERE legacy_artist=? AND legacy_title=?', [legacyArtist, legacyTitle]);
    return mapped.songId;
  }
}

module.exports = {
  DURATION_TOLERANCE_MS,
  SongLibrary,
  ensureSongLibrarySchema,
  inspectLyrics,
  normalizeSearchText,
};
