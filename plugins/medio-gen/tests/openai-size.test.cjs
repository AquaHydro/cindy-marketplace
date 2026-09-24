'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { openaiSizeError } = require('../node/openai-size.cjs');

test('accepts auto, empty and valid custom sizes', () => {
  assert.equal(openaiSizeError('gpt-image-2', ''), '');
  assert.equal(openaiSizeError('gpt-image-2', 'auto'), '');
  for (const size of ['1024x1024', '1920x1088', '3840x2160', '2160x3840', '1536x512', '1024x640']) {
    assert.equal(openaiSizeError('gpt-image-2', size), '', size);
  }
  assert.equal(openaiSizeError('gpt-image-2.5-flare', '2048x1152'), '');
});

test('rejects sizes that break gpt-image-2 limits', () => {
  assert.match(openaiSizeError('gpt-image-2', '1920x1080'), /16/);
  assert.match(openaiSizeError('gpt-image-2', '3856x2160'), /3840/);
  assert.match(openaiSizeError('gpt-image-2', '2400x784'), /3:1/);
  assert.match(openaiSizeError('gpt-image-2', '512x512'), /像素/);
  assert.match(openaiSizeError('gpt-image-2', '3840x3840'), /像素/);
  assert.match(openaiSizeError('gpt-image-2', '1024*1024'), /宽x高/);
});

test('leaves fixed-size models to the gateway', () => {
  assert.equal(openaiSizeError('gpt-image-1', '1920x1080'), '');
  assert.equal(openaiSizeError('dall-e-3', '1792x1024'), '');
});
