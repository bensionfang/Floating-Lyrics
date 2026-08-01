/**
 * 行動版的播放狀態插值 (規格 §3.3 / §3.4)。純函式,獨立成檔的理由同 pkce.js:
 * 測試 require 得到,瀏覽器則當一般 <script> 載入。
 *
 * 時間軸一律用 performance.now() 傳進來,**不要用 Date.now()** —— 那個會被系統校時
 * 與時區調整往前後跳,插值就會突然跳一大段。
 */

const POLL_PLAYING_MS = 3000;   // 規格 §3.3;Spotify 的限流是 30 秒滾動窗,3 秒很安全
const POLL_PAUSED_MS = 15000;

/** 一次 GET /me/player 的回應 → 內部狀態。沒有 item (204 或空裝置) 回 null */
function snapshot(data, now) {
  const item = data && data.item;
  if (!item) return null;
  return {
    id: item.id,
    title: item.name,
    artist: (item.artists || []).map((a) => a.name).join(', '),
    durationMs: item.duration_ms || 0,
    // images 由大到小,[0] 是 640px。單曲/podcast 可能整個沒有 album,取不到就空字串
    art: ((item.album && item.album.images || [])[0] || {}).url || '',
    progressMs: data.progress_ms || 0,
    isPlaying: !!data.is_playing,
    at: now,                      // 這份快照是在哪個時間點量的
  };
}

/**
 * 插值出「現在」的播放位置:上次量到的位置 + 之後經過的時間。
 * 暫停中不前進;夾在歌曲長度內,免得輪詢空窗期進度條爆出去。
 */
function positionAt(track, now) {
  if (!track) return 0;
  const elapsed = track.isPlaying ? Math.max(0, now - track.at) : 0;
  return Math.min(track.progressMs + elapsed, track.durationMs || Infinity);
}

/** 播放中 3 秒、暫停中 15 秒 (沒有狀態時當暫停,不要空轉打 API) */
function pollDelay(track) {
  return track && track.isPlaying ? POLL_PLAYING_MS : POLL_PAUSED_MS;
}

if (typeof module !== 'undefined') {
  module.exports = { snapshot, positionAt, pollDelay, POLL_PLAYING_MS, POLL_PAUSED_MS };
}
