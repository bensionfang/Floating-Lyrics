/**
 * 雲端唯讀模式的允許清單 (server.js 的 CLOUD_MODE 那段)。
 *
 *   node tests/test_cloud_guard.js
 *
 * 自己帶起一份 server (CLOUD_MODE=1 + 獨立 port + 暫存 DB),測完關掉。
 * 這道清單是那台機器**唯一**的防線:沒有帳號系統,靠的就是「寫入路由根本不存在」。
 * 破了的話 /api/settings 可以被任何人改 llm_base_url、/api/restore 可以蓋掉整顆 DB。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 5733;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'test-token-abc';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-cloud-'));

async function waitForServer(deadlineMs = 20000) {
  const until = Date.now() + deadlineMs;
  while (Date.now() < until) {
    // /mobile/ 是唯一不需要 token 的路徑,拿它當健康檢查 (render.yaml 也是用這條)
    try { await fetch(BASE + '/mobile/'); return true; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
  return false;
}

async function run() {
  let failed = 0;
  const check = (ok, label, detail) => {
    if (!ok) failed++;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
  };

  // 桌面版的路由在這台一律不存在。**不是 403 而是 404** —— 連「有這條路但你沒權限」都不透露
  for (const [name, method, route] of [
    ['GET /api/settings', 'GET', '/api/settings'],
    ['POST /api/settings (竄改 llm_base_url 的入口)', 'POST', '/api/settings'],
    ['POST /api/db-clear', 'POST', '/api/db-clear'],
    ['POST /api/restore', 'POST', '/api/restore'],
    ['GET /api/llm-key', 'GET', '/api/llm-key'],
    ['GET /island', 'GET', '/island'],
    ['GET /api/media', 'GET', '/api/media'],
  ]) {
    const r = await fetch(BASE + route, { method });
    check(r.status === 404, `${name} → 不存在`, `${r.status} (expected 404)`);
  }

  // 行動版的靜態頁是公開的:它是頂層導覽,沒有地方可以帶 header
  for (const p of ['/mobile/', '/mobile/index.html', '/mobile/lyrics.js', '/mobile/sw.js', '/mobile/manifest.json']) {
    const r = await fetch(BASE + p);
    check(r.ok, `靜態頁放行 ${p}`, String(r.status));
  }

  // 根路徑轉到行動版:使用者只要記一個網域。/mobile (少斜線) 一起收。
  for (const p of ['/', '/mobile']) {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    check(r.status === 302 && r.headers.get('location') === '/mobile/',
      `${p} → 轉址到 /mobile/`, `${r.status} ${r.headers.get('location')}`);
  }

  // 進場的喚醒 ping (index.html)。帶 query 是給 SW 看的 (讓它放行走網路),B1 判斷的是
  // req.path 不含 query,所以照樣命中 /mobile/ 那條;真的擋掉的話喚醒就完全沒作用。
  const wake = await fetch(`${BASE}/mobile/manifest.json?wake=1`);
  check(wake.ok, '喚醒 ping (/mobile/manifest.json?wake=1) 放行', String(wake.status));

  // token
  const noToken = await fetch(`${BASE}/api/lyrics?title=a&artist=b`);
  check(noToken.status === 401, '/api/lyrics 沒帶 token', `${noToken.status} (expected 401)`);

  const badToken = await fetch(`${BASE}/api/lyrics?title=a&artist=b`, { headers: { 'X-Kanaric-Token': 'wrong' } });
  check(badToken.status === 401, '/api/lyrics token 不對', `${badToken.status} (expected 401)`);

  // 有 token 但缺參數 → 400。用缺參數而不是真的查一首歌:**證明 token 過了,而且不打外部網路**
  const okToken = await fetch(`${BASE}/api/lyrics`, { headers: { 'X-Kanaric-Token': TOKEN } });
  check(okToken.status === 400, '/api/lyrics token 正確 (缺參數 → 400)', `${okToken.status} (expected 400)`);

  // 限流:每分鐘 30 次。第 31 次要被擋,而且要帶 Retry-After (前端的 poll() 靠它決定等多久)
  let limited = null;
  for (let i = 0; i < 31; i++) {
    const r = await fetch(`${BASE}/api/lyrics`, { headers: { 'X-Kanaric-Token': TOKEN } });
    if (r.status === 429) { limited = r; break; }
  }
  check(!!limited, '連打 31 次觸發限流', limited ? '429' : '沒被擋');
  check(!!limited && !!limited.headers.get('Retry-After'), '限流回應帶 Retry-After',
    limited ? String(limited.headers.get('Retry-After')) : '—');

  // WebSocket:upgrade 不經過 express middleware,所以允許清單擋不到,要靠 verifyClient 再擋一次
  const ws = await new Promise((resolve) => {
    const socket = new (require('../web-app/node_modules/ws'))(`ws://127.0.0.1:${PORT}`);
    socket.on('open', () => { socket.close(); resolve('連上'); });
    socket.on('error', () => resolve('被拒'));
  });
  check(ws === '被拒', 'WebSocket 一律拒絕 (雲端沒有正當的 WS 客戶端)', ws);

  return failed;
}

(async () => {
  const server = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..', 'web-app'),
    env: {
      ...process.env,
      CLOUD_MODE: '1',
      MOBILE_TOKEN: TOKEN,
      PUBLIC_ORIGIN: BASE,
      PORT: String(PORT),
      DB_PATH: path.join(TMP, 'test.db'),
      DATA_DIR: TMP,
      LYRICS_SETTINGS_PATH: path.join(TMP, 'settings.json'),
    },
    stdio: 'ignore',
  });

  try {
    if (!(await waitForServer())) throw new Error('server 沒有起來');
    const failed = await run();
    console.log(failed === 0 ? '\n全部通過' : `\n${failed} 項失敗`);
    process.exitCode = failed === 0 ? 0 : 1;
  } catch (e) {
    console.error('測試無法執行:', e.message);
    process.exitCode = 1;
  } finally {
    server.kill();
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
  }
})();
