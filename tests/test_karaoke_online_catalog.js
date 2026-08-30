const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  createKaraokeOnlineCatalog,
  DOWNLOAD_MAX_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  ONLINE_SEARCH_TTL_MS,
} = require('../web-app/karaoke-online-catalog');

function jsonResponse(value) {
  return { ok: true, status: 200, headers: new Headers({ 'content-type': 'application/json' }), json: async () => value };
}

async function run() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-online-catalog-'));
  let now = 1_000_000;
  const calls = [];
  const metadata = new Map([
    ['valid-1', {
      metadata: {
        identifier: 'valid-1', title: 'Legal Song', creator: ['Artist'], album: 'Album',
        licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
      },
      files: [
        { name: 'legal-song.mp3', format: 'VBR MP3', size: '1234', length: '180' },
        { name: 'legal-song.jpg', format: 'JPEG', size: '10' },
        { name: 'legal-song.flac', format: 'FLAC', size: '3456', length: '180' },
      ],
    }],
    ['valid-2', {
      metadata: {
        identifier: 'valid-2', title: 'Official Karaoke', creator: 'Artist 2',
        licenseurl: 'https://creativecommons.org/publicdomain/zero/1.0/',
      },
      files: [{ name: 'Official Karaoke instrumental.ogg', format: 'Ogg Vorbis', size: '222', length: '90' }],
    }],
    ['invalid-license', {
      metadata: {
        identifier: 'invalid-license', title: 'Nope', creator: 'Artist',
        licenseurl: 'https://creativecommons.org/licenses/by-nc/4.0/',
      },
      files: [{ name: 'nope.mp3', format: 'MP3', size: '1', length: '1' }],
    }],
  ]);
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const parsed = new URL(url);
    if (parsed.pathname === '/advancedsearch.php') {
      assert.equal(parsed.hostname, 'archive.org');
      assert.equal(parsed.searchParams.get('rows'), '5');
      return jsonResponse({ responseHeader: { status: 0 }, response: {
        numFound: 6,
        docs: [
          { identifier: 'valid-1' }, { identifier: 'valid-2' }, { identifier: 'invalid-license' },
          { identifier: 'missing-meta' }, { identifier: 'valid-1-duplicate' }, { identifier: 'ignored-sixth' },
        ],
      } });
    }
    const identifier = decodeURIComponent(parsed.pathname.split('/').pop());
    if (identifier === 'valid-1-duplicate' || identifier === 'ignored-sixth') {
      return jsonResponse({ metadata: { identifier, title: identifier, creator: 'Artist', licenseurl: 'https://creativecommons.org/licenses/by/4.0/' }, files: [] });
    }
    if (identifier === 'missing-meta') return jsonResponse({ metadata: { identifier }, files: [] });
    if (!metadata.has(identifier)) throw new Error(`unexpected URL: ${url}`);
    return jsonResponse(metadata.get(identifier));
  };
  const catalog = createKaraokeOnlineCatalog({
    library: {}, storageDir: root, fetchImpl, now: () => now, idFactory: () => 'search-1',
  });

  assert.equal(ONLINE_SEARCH_TTL_MS, 10 * 60 * 1000);
  assert.deepEqual(await catalog.search('   '), { searchId: null, expiresAt: null, results: [] });

  const search = await catalog.search('hello + world: [x]');
  assert.equal(search.searchId, 'search-1');
  assert.equal(search.expiresAt, now + ONLINE_SEARCH_TTL_MS);
  assert.equal(search.results.length, 3);
  assert.deepEqual(search.results.map((item) => item.variant), ['studio', 'studio', 'instrumental']);
  assert.deepEqual(search.results.map((item) => item.format), ['mp3', 'flac', 'ogg']);
  assert.equal(search.results[2].license, 'CC0');
  assert.ok(search.results.every((item) => item.sourceUrl.startsWith('https://archive.org/details/')));
  const serialized = JSON.stringify(search);
  for (const forbidden of ['identifier', 'filename', 'downloadUrl', 'path']) assert.equal(serialized.includes(forbidden), false, forbidden);
  const advancedUrl = new URL(calls.find((url) => url.includes('/advancedsearch.php')));
  assert.match(advancedUrl.searchParams.get('q'), /hello \\\+ world\\:/);
  assert.match(advancedUrl.searchParams.get('q'), /\\\[x\\\]/);

  now += ONLINE_SEARCH_TTL_MS + 1;
  assert.deepEqual(await catalog.search(''), { searchId: null, expiresAt: null, results: [] });
  catalog.dispose();

  assert.equal(DOWNLOAD_MAX_BYTES, 200 * 1024 * 1024);
  assert.equal(DOWNLOAD_TIMEOUT_MS, 120_000);
  await testImport(root);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('test_karaoke_online_catalog: PASS');
}

function bodyResponse(bytes = Buffer.from('audio'), headers = { 'content-type': 'audio/mpeg' }) {
  return {
    ok: true,
    status: 200,
    headers: new Headers(headers),
    body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
  };
}

async function makeImportHarness(root, downloadImpl, validateAudio = async () => ({ durationMs: 123_000 })) {
  let id = 0;
  const imported = [];
  const downloadCalls = [];
  const library = {
    async importSong(input) {
      imported.push(input);
      assert.equal(fs.existsSync(input.audio.path), true);
      return {
        songId: input.songId,
        title: input.metadata.title,
        artist: input.metadata.artist,
        album: input.metadata.album,
        variant: input.metadata.variant,
        audio: { path: input.audio.path },
        lyrics: { status: 'missing' },
      };
    },
  };
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname === '/advancedsearch.php') {
      return jsonResponse({ response: { docs: [{ identifier: 'valid-1' }] } });
    }
    if (parsed.pathname === '/metadata/valid-1') {
      return jsonResponse({
        metadata: {
          identifier: 'valid-1', title: 'Legal Song', creator: 'Artist', album: 'Album',
          licenseurl: 'https://creativecommons.org/licenses/by/4.0/',
        },
        files: [{ name: 'legal-song.mp3', format: 'VBR MP3', size: '5', length: '123' }],
      });
    }
    downloadCalls.push({ url: String(url), options });
    return downloadImpl(String(url), options, downloadCalls.length);
  };
  const catalog = createKaraokeOnlineCatalog({
    library,
    storageDir: path.join(root, `downloads-${Date.now()}-${Math.random()}`),
    fetchImpl,
    validateAudio,
    idFactory: () => `id-${++id}`,
  });
  const search = await catalog.search('Legal Song');
  return { catalog, search, imported, downloadCalls };
}

async function testImport(root) {
  let releaseDownload;
  const gate = new Promise((resolve) => { releaseDownload = resolve; });
  const success = await makeImportHarness(root, async (url, options, call) => {
    assert.equal(options.redirect, 'manual');
    assert.equal(options.signal instanceof AbortSignal, true);
    if (call === 1) {
      return { ok: false, status: 302, headers: new Headers({ location: 'https://ia800001.us.archive.org/file.mp3' }) };
    }
    await gate;
    return bodyResponse();
  }, async (filePath) => {
    assert.match(filePath, /\.part$/);
    assert.equal(fs.statSync(filePath).size, 5);
    return { durationMs: 123_000 };
  });
  const resultId = success.search.results[0].resultId;
  await assert.rejects(() => success.catalog.importResult('forged', resultId), (error) => error.code === 'karaoke-online-search-expired');
  await assert.rejects(
    () => success.catalog.importResult(success.search.searchId, 'forged'),
    (error) => error.code === 'karaoke-online-result-invalid',
  );
  const one = success.catalog.importResult(success.search.searchId, resultId);
  const two = success.catalog.importResult(success.search.searchId, resultId);
  releaseDownload();
  const [first, second] = await Promise.all([one, two]);
  assert.deepEqual(first, second);
  assert.equal(success.downloadCalls.length, 2);
  assert.equal(success.downloadCalls[0].url, 'https://archive.org/download/valid-1/legal-song.mp3');
  assert.equal(success.imported.length, 1);
  assert.equal(success.imported[0].songId,
    `internet-archive:valid-1:${require('node:crypto').createHash('sha256').update('legal-song.mp3').digest('hex')}`);
  assert.equal(success.imported[0].metadata.variant, 'studio');
  assert.equal(success.imported[0].audio.durationMs, 123_000);
  assert.equal(first.lyricsStatus, 'missing');
  for (const forbidden of ['identifier', 'filename', 'downloadUrl', 'path']) {
    assert.equal(JSON.stringify(first).includes(forbidden), false, forbidden);
  }
  assert.equal(success.imported[0].audio.path.endsWith('.part'), false);
  success.catalog.dispose();

  const hostile = await makeImportHarness(root, async () => ({
    ok: false, status: 302, headers: new Headers({ location: 'https://evil.example/audio.mp3' }),
  }));
  await assert.rejects(
    () => hostile.catalog.importResult(hostile.search.searchId, hostile.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-download-host-invalid',
  );

  const tooLarge = await makeImportHarness(root, async () => bodyResponse(Buffer.from('x'), {
    'content-type': 'audio/mpeg', 'content-length': String(DOWNLOAD_MAX_BYTES + 1),
  }));
  await assert.rejects(
    () => tooLarge.catalog.importResult(tooLarge.search.searchId, tooLarge.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-download-too-large',
  );

  const invalidMime = await makeImportHarness(root, async () => bodyResponse(Buffer.from('html'), { 'content-type': 'text/html' }));
  await assert.rejects(
    () => invalidMime.catalog.importResult(invalidMime.search.searchId, invalidMime.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-download-type-invalid',
  );

  const zero = await makeImportHarness(root, async () => bodyResponse(Buffer.alloc(0)));
  await assert.rejects(
    () => zero.catalog.importResult(zero.search.searchId, zero.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-download-empty',
  );

  const invalidAudio = await makeImportHarness(root, async () => bodyResponse(), async () => false);
  await assert.rejects(
    () => invalidAudio.catalog.importResult(invalidAudio.search.searchId, invalidAudio.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-audio-invalid',
  );

  const redirects = await makeImportHarness(root, async (url, options, call) => ({
    ok: false, status: 302,
    headers: new Headers({ location: `https://ia800001.us.archive.org/audio.mp3?step=${call}` }),
  }));
  await assert.rejects(
    () => redirects.catalog.importResult(redirects.search.searchId, redirects.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-redirect-limit',
  );
  assert.equal(redirects.downloadCalls.length, 6);

  const interrupted = await makeImportHarness(root, async () => ({
    ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }),
    body: new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('x')); controller.error(new Error('socket reset')); } }),
  }));
  await assert.rejects(
    () => interrupted.catalog.importResult(interrupted.search.searchId, interrupted.search.results[0].resultId),
    (error) => error.code === 'karaoke-online-download-failed',
  );

  for (const entry of fs.readdirSync(root, { recursive: true })) assert.equal(String(entry).endsWith('.part'), false);
}

run().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
