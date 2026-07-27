/**
 * 魔杖 (/api/llm-furigana/run) 對非日文歌詞的守門回歸測試。
 *
 *   node tests/test_llm_wand.js
 *
 * 守的是「假成功」:furigana_inject.process_lrc 對整份沒假名的歌詞 (中文歌,或同名中文歌
 * 被抓錯進快取) 直接原樣退回、根本不呼叫 LLM,而那條路徑不會設 LAST_ERROR ——
 * server 因此回 success:true / changed:0,前端就亮燈說「AI 校正完成,無需修正」,
 * 使用者看不出自己在對一份不是日文的歌詞按魔杖。
 */
const PORT = process.env.PORT || '5744';
process.env.PORT = PORT;

const fs = require('fs');
const os = require('os');
const path = require('path');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'kanaric-wand-'));
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.DATA_DIR = TMP;
process.env.LYRICS_SETTINGS_PATH = path.join(TMP, 'settings.json');

// key 在 server.js 載入時就讀進來 (loadLlmKey),所以要先寫好。dev 模式是明文。
fs.writeFileSync(path.join(TMP, 'secrets.json'), JSON.stringify({ llm_api_key: 'test-key' }));
// base_url/model 先填好,免得 POST /api/llm-key 的供應商偵測跑去打真的網路;
// 指到一個一定拒絕連線的位址,日文那組才會停在「連不上」而不是真的送歌詞出去。
fs.writeFileSync(path.join(TMP, 'settings.json'), JSON.stringify({
  llm_base_url: 'http://127.0.0.1:1/v1', llm_model: 'test-model', llm_furigana: 'off'
}));

require('../web-app/server.js');

const BASE = `http://localhost:${PORT}`;
const GUARD = '這首歌沒有日文假名，不需要讀音校正';
let failed = 0;
const check = (ok, label, detail) => {
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `: ${detail}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const post = (url, body) => fetch(`${BASE}${url}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}).then(async r => ({ status: r.status, body: await r.json() }));

const save = (title, artist, lyrics) => post('/api/lyrics/save', { title, artist, lyrics });
const wand = (title, artist) => post('/api/llm-furigana/run', { artist, title });

async function run() {
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${BASE}/api/songs`); break; } catch (e) { await sleep(100); }
  }

  await save('龍捲風', '周杰倫', '[00:27.39]愛像一陣風 吹完它就走\n[00:32.99]這樣的節奏 誰都無可奈何');
  const cn = await wand('龍捲風', '周杰倫');
  check(cn.body.success === false, '中文歌詞不回假成功', JSON.stringify(cn.body));
  check(cn.body.error === GUARD, '中文歌詞的訊息說清楚原因', JSON.stringify(cn.body));

  // 有假名就不該被這道守門攔下 —— 走到真正的 LLM 請求 (連不上,或本機沒 python 就沒有錯誤欄),
  // 總之訊息不會是守門那句。
  await save('春泥棒', 'ヨルシカ', '[00:10.00]高架下、木漏れ日、抜け道');
  const jp = await wand('春泥棒', 'ヨルシカ');
  check(jp.body.error !== GUARD, '有假名的歌不被守門攔下', JSON.stringify(jp.body));

  const missing = await wand('沒這首', '沒這人');
  check(missing.status === 404, '沒快取的歌照舊回 404', JSON.stringify(missing.body));

  // --- Model 清單 (/api/llm-models):/models 原樣倒出來的東西要先清過再進 datalist ---
  const stub = require('http').createServer((rq, rs) => {
    rs.setHeader('Content-Type', 'application/json');
    // 供應商退場模型的回應形狀 (Gemini 實測:404 + 陣列包著的 error.message)
    if (rq.url.includes('/chat/completions')) {
      rs.statusCode = 404;
      return rs.end(JSON.stringify([{ error: {
        code: 404, status: 'NOT_FOUND',
        message: 'This model models/gemini-2.5-flash-lite is no longer available to new users.'
      } }]));
    }
    rs.end(JSON.stringify({ data: [
      { id: 'models/gemini-1.5-flash' },
      { id: 'models/embedding-001' },
      { id: 'models/gemini-2.5-flash' },
      { id: 'models/imagen-3.0-generate-002' },
      { id: 'models/gemini-2.0-flash' },
      { id: 'models/gemini-pro-vision' },
      { id: 'models/gemini-2.5-flash-lite' },
      { id: 'models/gemma-3-4b-it' },
      { id: 'models/claude-haiku-4-5' },
    ] }));
  });
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  fs.writeFileSync(path.join(TMP, 'settings.json'), JSON.stringify({
    llm_base_url: `http://127.0.0.1:${stub.address().port}/v1`, llm_model: 'test-model', llm_furigana: 'off'
  }));
  const list = await fetch(`${BASE}/api/llm-models`).then(r => r.json());
  const ms = list.models || [];
  check(!ms.some(id => /embedding|imagen|vision/.test(id)), '非對話模型被濾掉', JSON.stringify(ms));
  check(ms.every(id => !id.startsWith('models/')), 'Gemini 的 models/ 前綴被剝掉', JSON.stringify(ms));
  // 同系列擺一起、系列內新版在前;跨系列不比數字 (gemma-3 不比 gemini-2.5 新,gemma 的 3-4b 也不是 3.4 版)
  check(JSON.stringify(ms) === JSON.stringify([
    'claude-haiku-4-5', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-1.5-flash', 'gemma-3-4b-it'
  ]), '同系列相鄰、系列內新版在前', JSON.stringify(ms));
  // 供應商說得比我們猜得準:HTTP 錯誤的 body 裡有 error.message 就原樣往上帶,
  // 不要收斂成「Base URL 或 Model 有誤」(退場模型看那句只會去改 Base URL,越改越錯)
  const retired = await wand('春泥棒', 'ヨルシカ');
  check(/no longer available to new users/.test(retired.body.error || ''),
    '供應商的錯誤訊息有帶回前端', JSON.stringify(retired.body));

  stub.close();

  console.log(failed ? `\n${failed} FAILED` : '\nall pass');
  process.exit(failed ? 1 : 0);
}

run();
