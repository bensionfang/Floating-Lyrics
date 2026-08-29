const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('../web-app/node_modules/sqlite3').verbose();
const { SongLibrary, ensureSongLibrarySchema } = require('../web-app/song-library');

const run = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function onRun(err) { if (err) reject(err); else resolve(this); });
});
const get = (db, sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
});

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-song-library-'));
  const db = new sqlite3.Database(path.join(root, 'library.db'));
  const audio = (name) => {
    const file = path.join(root, name);
    fs.writeFileSync(file, 'audio');
    return file;
  };

  await run(db, 'CREATE TABLE cache (artist TEXT, title TEXT, lyrics TEXT, PRIMARY KEY (artist, title))');
  await run(db, 'INSERT INTO cache VALUES (?, ?, ?)', ['舊歌手', '舊歌', '[00:01.00]舊歌詞']);
  await ensureSongLibrarySchema(db);
  const library = new SongLibrary(db);

  const lrc = '[00:01.00]<ruby>夜<rt>よる</rt></ruby>空\n[00:01.00]#WORDS#0:0,1:250\n[00:01.00]#TRANS#night sky';
  await library.importSong({
    songId: 'local-studio-1',
    metadata: { title: '夜空', artist: '歌手', variant: 'studio', aliases: ['夜空 原曲'], kana: 'よぞら', romaji: 'yozora' },
    audio: { path: audio('studio.m4a'), durationMs: 180000 },
    video: { path: path.join(root, 'missing.mp4') },
    lyrics: { text: lrc, durationMs: 179000 },
    preferences: { key: 0 },
  });

  const loaded = await library.loadSong('local-studio-1');
  assert.strictEqual(loaded.playable, true);
  assert.strictEqual(loaded.playbackMode, 'audio-only');
  assert.strictEqual(loaded.video.status, 'unavailable');
  assert.strictEqual(loaded.lyrics.status, 'ready');
  assert.strictEqual(loaded.lyrics.hasWords, true);
  assert.strictEqual(loaded.lyrics.hasRuby, true);
  assert.strictEqual(loaded.lyrics.content.includes('#TRANS#'), false);
  assert.deepStrictEqual(loaded.lyrics.translations, { '00:01.00': 'night sky' });

  await library.importSong({
    songId: 'local-live-1',
    metadata: { title: '夜空', artist: '歌手', variant: 'live', aliases: ['現場'], kana: 'よぞら', romaji: 'yozora live' },
    audio: { path: audio('live.m4a'), durationMs: 181000 },
    lyrics: { text: '[00:01.00]夜空', durationMs: 181000 },
  });
  let results = await library.searchSongs('yozora');
  assert.deepStrictEqual(results.map((song) => song.songId), ['local-live-1', 'local-studio-1']);
  assert.deepStrictEqual((await library.searchSongs('現場')).map((song) => song.variant), ['live']);

  await library.importSong({
    songId: 'local-studio-1',
    metadata: { title: '夜空改名', artist: '歌手', variant: 'studio', aliases: ['重索引'], kana: 'よぞら', romaji: 'yozora' },
    audio: { path: audio('studio.m4a'), durationMs: 180000 },
    lyrics: { text: '[00:01.00]夜空', durationMs: 180000 },
  });
  assert.strictEqual((await library.searchSongs('重索引')).length, 1);
  assert.strictEqual((await get(db, 'SELECT COUNT(*) AS n FROM songs')).n, 2);

  await library.importSong({
    songId: 'missing-audio',
    metadata: { title: '缺音檔', artist: '歌手', variant: 'studio' },
    audio: { path: path.join(root, 'not-found.m4a') },
    lyrics: { text: '[00:01.00]歌詞' },
  });
  const missing = await library.loadSong('missing-audio');
  assert.strictEqual(missing.playable, false);
  assert.strictEqual(missing.audio.status, 'missing');

  await library.importSong({
    songId: 'missing-lyrics',
    metadata: { title: '缺歌詞', artist: '歌手' },
    audio: { path: audio('no-lyrics.m4a'), durationMs: 180000 },
    video: { path: root },
  });
  const noLyrics = await library.loadSong('missing-lyrics');
  assert.strictEqual(noLyrics.playable, true);
  assert.strictEqual(noLyrics.playbackMode, 'audio-only');
  assert.strictEqual(noLyrics.video.status, 'unavailable');
  assert.strictEqual(noLyrics.lyrics.status, 'missing');
  assert.strictEqual(noLyrics.lyrics.policy, 'show-missing-lyrics');

  await library.importSong({
    songId: 'bad-lyrics',
    metadata: { title: '壞歌詞', artist: '歌手' },
    audio: { path: audio('bad.m4a'), durationMs: 180000 },
    lyrics: { text: '[00:xx]壞格式' },
  });
  assert.strictEqual((await library.loadSong('bad-lyrics')).lyrics.status, 'malformed');

  await library.importSong({
    songId: 'mismatch',
    metadata: { title: '長度不符', artist: '歌手' },
    audio: { path: audio('mismatch.m4a'), durationMs: 180000 },
    lyrics: { text: '[00:01.00]歌詞', durationMs: 170000 },
  });
  assert.strictEqual((await library.loadSong('mismatch')).lyrics.status, 'duration-mismatch');

  const firstLegacy = await library.mapLegacySong('舊歌手', '舊歌');
  const secondLegacy = await library.mapLegacySong('舊歌手', '舊歌');
  assert.strictEqual(firstLegacy, secondLegacy);
  assert.strictEqual((await get(db, 'SELECT lyrics FROM cache WHERE artist=? AND title=?', ['舊歌手', '舊歌'])).lyrics, '[00:01.00]舊歌詞');

  db.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('test_song_library: PASS');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
