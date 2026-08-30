const assert = require('assert');
const { createKaraokeStemSeparator } = require('../web-app/karaoke-stem-separator');

assert.strictEqual(typeof createKaraokeStemSeparator, 'function');
console.log('test_karaoke_stem_separator: PASS');
