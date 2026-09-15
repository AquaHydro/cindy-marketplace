'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const policy = require('../node/net-policy.cjs');

test('same-origin download keeps Authorization', () => {
  const headers = policy.downloadAuthHeader(
    'https://gw.example:8888/v1/videos/1/content',
    'https://gw.example:8888/v1',
    'TEST_KEY',
  );
  assert.equal(headers.Authorization, 'Bearer TEST_KEY');
});

test('cross-origin download does not send the gateway key', () => {
  const headers = policy.downloadAuthHeader(
    'https://cdn.example/img.png',
    'https://gw.example:8888/v1',
    'TEST_KEY',
  );
  assert.equal(headers.Authorization, undefined);
});

test('rejects http download and http gateway', () => {
  assert.throws(
    () => policy.downloadAuthHeader('http://cdn.example/a.png', 'https://gw.example/v1', 'TEST_KEY'),
    /https/,
  );
  assert.throws(() => policy.assertHttpsUrl('http://gw.example/v1', '网关'), /https/);
});

test('rejects cross-origin localhost download', () => {
  assert.throws(
    () => policy.downloadAuthHeader('https://127.0.0.1/secret', 'https://gw.example/v1', 'TEST_KEY'),
    /内网/,
  );
});

test('POST is not retried; GET may retry', () => {
  assert.equal(policy.paidMethodRetries('POST'), 0);
  assert.equal(policy.paidMethodRetries('GET'), 3);
});
