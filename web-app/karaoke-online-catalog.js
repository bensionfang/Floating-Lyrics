'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const ONLINE_SEARCH_TTL_MS = 10 * 60 * 1000;
const DOWNLOAD_MAX_BYTES = 200 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 5;
const AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.opus', '.flac', '.wav']);

function catalogError(code) {
  return Object.assign(new Error(code), { code });
}

function first(value) {
  return Array.isArray(value) ? value[0] : value;
}

function licenseInfo(value) {
  let url;
  try { url = new URL(String(first(value) || '')); } catch { return null; }
  if (url.hostname !== 'creativecommons.org') return null;
  const pathname = url.pathname.toLowerCase().replace(/\/+$/, '');
  if (/^\/publicdomain\/zero\/\d+(?:\.\d+)*$/.test(pathname)) return { label: 'CC0', url: url.href };
  if (/^\/publicdomain\/mark\/\d+(?:\.\d+)*$/.test(pathname)) return { label: 'Public Domain Mark', url: url.href };
  if (/^\/licenses\/by\/\d+(?:\.\d+)*$/.test(pathname)) return { label: 'CC BY', url: url.href };
  if (/^\/licenses\/by-sa\/\d+(?:\.\d+)*$/.test(pathname)) return { label: 'CC BY-SA', url: url.href };
  return null;
}

function escapeLucene(value) {
  return value.replace(/([+\-!(){}\[\]^"~*?:\\/])/g, '\\$1').replace(/&&|\|\|/g, '\\$&');
}

function looksInstrumental(...values) {
  return values.some((value) => /(?:instrumental|off[\s_-]*vocal|karaoke|backing[\s_-]*track|伴奏|オフ[\s_-]*ボーカル)/i.test(String(value || '')));
}

function safeText(value, fallback = '') {
  return String(first(value) ?? fallback).trim();
}

function projection(candidate) {
  return {
    resultId: candidate.resultId,
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    variant: candidate.variant,
    license: candidate.license,
    source: 'Internet Archive',
    sourceUrl: candidate.sourceUrl,
    format: candidate.extension.slice(1),
    sizeBytes: candidate.sizeBytes,
    durationMs: candidate.durationMs,
  };
}

function importProjection(song, candidate) {
  return {
    songId: song.songId,
    title: song.title || candidate.title,
    artist: song.artist || candidate.artist,
    album: song.album ?? candidate.album,
    variant: song.variant || candidate.variant,
    lyricsStatus: song.lyricsStatus || song.lyrics?.status || 'missing',
  };
}

function assertArchiveUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw catalogError('karaoke-online-download-url-invalid'); }
  if (url.protocol !== 'https:' || (url.hostname !== 'archive.org' && !url.hostname.endsWith('.archive.org'))) {
    throw catalogError('karaoke-online-download-host-invalid');
  }
  return url;
}

function createKaraokeOnlineCatalog({
  library,
  storageDir,
  fetchImpl = fetch,
  validateAudio,
  now = Date.now,
  idFactory = crypto.randomUUID,
} = {}) {
  if (!library) throw new TypeError('library is required');
  if (!storageDir) throw new TypeError('storageDir is required');
  const searches = new Map();
  const imports = new Map();
  const controllers = new Set();

  async function fetchJson(url) {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json' } });
    if (!response || !response.ok) throw catalogError('karaoke-online-provider-failed');
    return response.json();
  }

  function clearExpired() {
    const time = now();
    for (const [id, record] of searches) if (record.expiresAt <= time) searches.delete(id);
  }

  function candidateFor(searchId, resultId) {
    clearExpired();
    const record = searches.get(String(searchId));
    if (!record) throw catalogError('karaoke-online-search-expired');
    const candidate = record.candidates.get(String(resultId));
    if (!candidate) throw catalogError('karaoke-online-result-invalid');
    return candidate;
  }

  async function fetchDownload(candidate, partPath) {
    const controller = new AbortController();
    controllers.add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, DOWNLOAD_TIMEOUT_MS);
    try {
      let url = assertArchiveUrl(candidate.downloadUrl);
      let response;
      for (let redirects = 0; ; redirects += 1) {
        response = await fetchImpl(url, { redirect: 'manual', signal: controller.signal });
        if (![301, 302, 303, 307, 308].includes(response && response.status)) break;
        if (redirects >= MAX_REDIRECTS) throw catalogError('karaoke-online-redirect-limit');
        const location = response.headers && response.headers.get('location');
        if (!location) throw catalogError('karaoke-online-download-failed');
        url = assertArchiveUrl(new URL(location, url));
      }
      if (!response || !response.ok || !response.body) throw catalogError('karaoke-online-download-failed');
      const type = String(response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
      if (type && !type.startsWith('audio/') && !['application/octet-stream', 'binary/octet-stream', 'application/ogg'].includes(type)) {
        throw catalogError('karaoke-online-download-type-invalid');
      }
      const length = Number(response.headers.get('content-length'));
      if (Number.isFinite(length) && length > DOWNLOAD_MAX_BYTES) throw catalogError('karaoke-online-download-too-large');
      let received = 0;
      const counter = new Transform({
        transform(chunk, encoding, callback) {
          received += chunk.length;
          callback(received > DOWNLOAD_MAX_BYTES ? catalogError('karaoke-online-download-too-large') : null, chunk);
        },
      });
      const source = typeof response.body.getReader === 'function' ? Readable.fromWeb(response.body) : Readable.from(response.body);
      try {
        await pipeline(source, counter, fs.createWriteStream(partPath, { flags: 'wx' }));
      } catch (error) {
        if (error && error.code && String(error.code).startsWith('karaoke-')) throw error;
        throw catalogError('karaoke-online-download-failed');
      }
      if (!received) throw catalogError('karaoke-online-download-empty');
    } catch (error) {
      if (timedOut) throw catalogError('karaoke-online-download-timeout');
      if (error && error.code && String(error.code).startsWith('karaoke-')) throw error;
      throw catalogError('karaoke-online-download-failed');
    } finally {
      clearTimeout(timer);
      controllers.delete(controller);
    }
  }

  async function doImport(candidate) {
    if (typeof validateAudio !== 'function') throw catalogError('karaoke-online-validator-unavailable');
    await fs.promises.mkdir(storageDir, { recursive: true });
    const assetDigest = crypto.createHash('sha256').update(`${candidate.identifier}\0${candidate.filename}`, 'utf8').digest('hex');
    const finalPath = path.join(storageDir, `${assetDigest}${candidate.extension}`);
    const partPath = path.join(storageDir, `${assetDigest}-${crypto.randomUUID()}.part`);
    try {
      let probe;
      if (!fs.existsSync(finalPath)) {
        await fetchDownload(candidate, partPath);
        try { probe = await validateAudio(partPath); } catch { probe = false; }
        if (!probe) throw catalogError('karaoke-online-audio-invalid');
        await fs.promises.rename(partPath, finalPath);
      } else {
        try { probe = await validateAudio(finalPath); } catch { probe = false; }
        if (!probe) throw catalogError('karaoke-online-audio-invalid');
      }
      const durationMs = typeof probe === 'object' && Number.isFinite(Number(probe.durationMs))
        ? Math.round(Number(probe.durationMs)) : candidate.durationMs;
      const filenameDigest = crypto.createHash('sha256').update(candidate.filename, 'utf8').digest('hex');
      const songId = `internet-archive:${candidate.identifier}:${filenameDigest}`;
      const song = await library.importSong({
        songId,
        metadata: {
          title: candidate.title,
          artist: candidate.artist,
          album: candidate.album,
          variant: candidate.variant,
        },
        audio: { path: finalPath, durationMs },
        preferences: {
          source: {
            provider: 'internet-archive',
            identifier: candidate.identifier,
            filename: candidate.filename,
            license: candidate.license,
            licenseUrl: candidate.licenseUrl,
            sourceUrl: candidate.sourceUrl,
          },
        },
      });
      return importProjection(song, candidate);
    } finally {
      try { await fs.promises.unlink(partPath); } catch {}
    }
  }

  return {
    async search(input) {
      clearExpired();
      const query = [...String(input ?? '').trim()].slice(0, 100).join('');
      if (!query) return { searchId: null, expiresAt: null, results: [] };
      const lucene = escapeLucene(query);
      const searchUrl = new URL('https://archive.org/advancedsearch.php');
      searchUrl.searchParams.set('q', `mediatype:audio AND (title:"${lucene}" OR creator:"${lucene}")`);
      searchUrl.searchParams.append('fl[]', 'identifier');
      searchUrl.searchParams.set('rows', '5');
      searchUrl.searchParams.set('page', '1');
      searchUrl.searchParams.set('output', 'json');
      const data = await fetchJson(searchUrl);
      const docs = Array.isArray(data?.response?.docs) ? data.response.docs.slice(0, 5) : [];
      const searchId = String(idFactory());
      const candidates = new Map();

      for (const doc of docs) {
        const identifier = safeText(doc && doc.identifier);
        if (!identifier) continue;
        let item;
        try { item = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(identifier)}`); } catch { continue; }
        const metadata = item && item.metadata || {};
        const license = licenseInfo(metadata.licenseurl);
        const title = safeText(metadata.title);
        const artist = Array.isArray(metadata.creator)
          ? metadata.creator.map((value) => String(value).trim()).filter(Boolean).join(', ')
          : safeText(metadata.creator);
        if (!license || !title || !artist) continue;
        const album = safeText(metadata.album) || null;
        for (const file of Array.isArray(item.files) ? item.files : []) {
          if (candidates.size >= 20) break;
          const filename = safeText(file && file.name);
          const extension = path.extname(filename).toLowerCase();
          if (!filename || !AUDIO_EXTENSIONS.has(extension)) continue;
          const parts = filename.split('/');
          if (parts.some((part) => !part || part === '.' || part === '..')) continue;
          const resultId = `${idFactory()}:${candidates.size}`;
          const durationSeconds = Number(file.length);
          const sizeBytes = Number(file.size);
          const candidate = {
            resultId,
            identifier,
            filename,
            downloadUrl: `https://archive.org/download/${encodeURIComponent(identifier)}/${parts.map(encodeURIComponent).join('/')}`,
            title,
            artist,
            album,
            variant: looksInstrumental(title, filename) ? 'instrumental' : 'studio',
            license: license.label,
            licenseUrl: license.url,
            sourceUrl: `https://archive.org/details/${encodeURIComponent(identifier)}`,
            extension,
            sizeBytes: Number.isFinite(sizeBytes) && sizeBytes >= 0 ? sizeBytes : null,
            durationMs: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) : null,
          };
          candidates.set(resultId, candidate);
        }
        if (candidates.size >= 20) break;
      }

      const expiresAt = now() + ONLINE_SEARCH_TTL_MS;
      searches.set(searchId, { expiresAt, candidates });
      return { searchId, expiresAt, results: [...candidates.values()].map(projection) };
    },

    async importResult(searchId, resultId) {
      const candidate = candidateFor(searchId, resultId);
      const key = `${candidate.identifier}\0${candidate.filename}`;
      if (imports.has(key)) return imports.get(key);
      const task = doImport(candidate).finally(() => imports.delete(key));
      imports.set(key, task);
      return task;
    },

    dispose() {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      imports.clear();
      searches.clear();
    },
  };
}

module.exports = {
  AUDIO_EXTENSIONS,
  DOWNLOAD_MAX_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  ONLINE_SEARCH_TTL_MS,
  createKaraokeOnlineCatalog,
  escapeLucene,
  licenseInfo,
};
