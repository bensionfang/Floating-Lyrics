/**
 * PKCE 的回歸測試。
 *
 *   node tests/test_pkce.js
 *
 * S256 算錯的話 Spotify 只會回一句 invalid_grant,從錯誤訊息看不出是雜湊還是編碼壞掉,
 * 所以拿 RFC 7636 附錄 B 的官方測試向量釘死。
 */
const assert = require('assert');
const { randomVerifier, challengeFor } = require('../web-app/public/mobile/pkce');

(async () => {
  // RFC 7636 附錄 B
  const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
  const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
  assert.strictEqual(await challengeFor(VERIFIER), CHALLENGE, 'S256 challenge 與 RFC 測試向量不符');

  // base64url 不可以留下 + / =
  assert.ok(!/[+/=]/.test(await challengeFor('a'.repeat(43))), 'challenge 含 base64url 不合法的字元');

  // verifier:長度與字元集
  assert.strictEqual(randomVerifier().length, 64, '預設長度應為 64');
  assert.strictEqual(randomVerifier(43).length, 43);
  assert.strictEqual(randomVerifier(128).length, 128);
  for (let i = 0; i < 50; i++) {
    assert.ok(/^[A-Za-z0-9\-._~]{64}$/.test(randomVerifier()), 'verifier 出現 unreserved 以外的字元');
  }
  assert.throws(() => randomVerifier(42), RangeError, '長度 42 應被拒絕');
  assert.throws(() => randomVerifier(129), RangeError, '長度 129 應被拒絕');

  // 每次都要不一樣 (抽壞成常數的話這條會抓到)
  assert.notStrictEqual(randomVerifier(), randomVerifier(), 'verifier 沒有隨機性');

  console.log('全部通過');
})().catch((e) => {
  console.error('FAIL:', e.message);
  process.exitCode = 1;
});
