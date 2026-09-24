'use strict';

// gpt-image-2 / gpt-image-2.5 accept any WIDTHxHEIGHT within these limits (OpenAI image docs).
// Older models (gpt-image-1*, dall-e) only take fixed sizes; the gateway rejects the rest.
function openaiSizeError(model, size) {
  if (!size || size === 'auto') return '';
  const match = /^(\d+)x(\d+)$/.exec(size);
  if (!match) return 'size 必须是 auto 或 宽x高，例如 1920x1088';
  if (!/gpt-image-2/i.test(String(model || ''))) return '';
  const w = Number(match[1]);
  const h = Number(match[2]);
  if (w % 16 || h % 16) return 'gpt-image-2 的宽和高都必须是 16 的倍数';
  if (Math.max(w, h) > 3840) return 'gpt-image-2 最长边不能超过 3840';
  if (Math.max(w, h) > 3 * Math.min(w, h)) return 'gpt-image-2 长短边之比不能超过 3:1';
  if (w * h < 655360 || w * h > 8294400) return 'gpt-image-2 总像素必须在 655,360 到 8,294,400 之间';
  return '';
}

module.exports = { openaiSizeError };
