const test = require('node:test');
const assert = require('node:assert/strict');

const { formatConnectionStatus } = require('../src/popup.js');

test('formatConnectionStatus exposes truthful lifecycle text', () => {
  assert.equal(formatConnectionStatus('connecting'), 'connecting');
  assert.equal(formatConnectionStatus('connected'), 'connected');
  assert.equal(formatConnectionStatus('error', 'WebSocket failed'), 'error: WebSocket failed');
  assert.equal(formatConnectionStatus('disconnected'), 'disconnected');
});
