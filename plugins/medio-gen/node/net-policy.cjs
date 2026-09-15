'use strict';

function originOf(urlString) {
  const u = new URL(urlString);
  return u.protocol + '//' + u.host;
}

function sameOrigin(urlString, gatewayBase) {
  try {
    return originOf(urlString) === originOf(gatewayBase);
  } catch (_err) {
    return false;
  }
}

function isBlockedHost(hostname) {
  const h = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === 'localhost.localdomain') return true;
  if (h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '::') return true;
  if (h === 'metadata.google.internal' || h.endsWith('.internal')) return true;
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
  return false;
}

function assertHttpsUrl(urlString, label) {
  let u;
  try {
    u = new URL(urlString);
  } catch (_err) {
    throw new Error((label || 'URL') + ' 无效');
  }
  if (u.protocol !== 'https:') {
    throw new Error((label || 'URL') + ' 必须是 https://');
  }
  return u;
}

function downloadAuthHeader(urlString, gatewayBase, apiKey) {
  const u = assertHttpsUrl(urlString, '下载地址');
  const gateway = assertHttpsUrl(gatewayBase, '网关 Base URL');
  if (sameOrigin(u.href, gateway.href)) {
    if (!apiKey) return {};
    return { Authorization: 'Bearer ' + apiKey };
  }
  if (isBlockedHost(u.hostname)) {
    throw new Error('拒绝下载到内网或本机地址');
  }
  return {};
}

function paidMethodRetries(method) {
  const m = String(method || 'GET').toUpperCase();
  if (m === 'GET' || m === 'HEAD') return 3;
  return 0;
}

module.exports = {
  originOf,
  sameOrigin,
  isBlockedHost,
  assertHttpsUrl,
  downloadAuthHeader,
  paidMethodRetries,
};
