/**
 * Spotify OAuth 的 PKCE (RFC 7636) 純函式。
 *
 * 獨立成檔的理由同 public/js/scroll-zone.js、public/js/song-key.js:測試 require 得到,
 * 瀏覽器則當一般 <script> 載入。用的是 WebCrypto,Node 18+ 的 crypto.webcrypto 與
 * 瀏覽器同介面,測試不必 mock。
 */

// RFC 7636 §4.1 的 unreserved 字元:[A-Za-z0-9-._~]
const UNRESERVED = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';

const webcrypto = (typeof crypto !== 'undefined' && crypto.subtle)
  ? crypto
  : require('crypto').webcrypto;

/**
 * 隨機 code_verifier。長度規格是 43–128,預設 64。
 *
 * **取字元用取模是有偏差的** (256 不是 66 的倍數),所以落在尾巴那段的位元組直接丟掉重抽 ——
 * verifier 是安全參數,不值得為了少幾行而讓分布傾斜。
 */
function randomVerifier(len = 64) {
  if (len < 43 || len > 128) throw new RangeError('code_verifier 長度必須在 43–128 之間');
  const limit = Math.floor(256 / UNRESERVED.length) * UNRESERVED.length;   // 256 % 66 = 58,丟掉 198–255
  let out = '';
  while (out.length < len) {
    const buf = new Uint8Array(len - out.length);
    webcrypto.getRandomValues(buf);
    for (const b of buf) {
      if (b < limit) out += UNRESERVED[b % UNRESERVED.length];
    }
  }
  return out;
}

// base64url:標準 base64 換掉 +/ 並去掉尾端的 =
function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** code_challenge = BASE64URL(SHA256(ASCII(verifier)))，即 S256 方法 */
async function challengeFor(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await webcrypto.subtle.digest('SHA-256', data);
  return base64url(new Uint8Array(digest));
}

if (typeof module !== 'undefined') module.exports = { randomVerifier, challengeFor, base64url };
