const assert = require('assert');
const { createKaraokeStemWorker } = require('../web-app/karaoke-stem-worker');

assert.strictEqual(typeof createKaraokeStemWorker, 'function');
console.log('test_karaoke_stem_worker: PASS');
