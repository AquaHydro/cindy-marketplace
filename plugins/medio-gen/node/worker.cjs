'use strict';

const https = require('node:https');
const { Buffer } = require('node:buffer');
const { randomUUID } = require('node:crypto');
const { URL } = require('node:url');
const readline = require('node:readline');
const {
  originOf,
  assertHttpsUrl,
  downloadAuthHeader,
  paidMethodRetries,
} = require('./net-policy.cjs');
const { openaiSizeError } = require('./openai-size.cjs');

const DEFAULT_GROK_BASE = '';
const DEFAULT_OPENAI_BASE = '';
const DEFAULT_IMAGE_MODEL = 'grok-imagine-image-2.0';
const DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5';
const DEFAULT_OPENAI_IMAGE = 'gpt-image-2';
const MAX_BUFFER = 50 * 1024 * 1024;
const POLL_INTERVAL_MS = 10000;
const VIDEO_MAX_WAIT_MS = 600000;

const sources = new Map();
const results = new Map();

function reply(message) {
  process.stdout.write(JSON.stringify(message) + '\n');
}

function progress(params) {
  reply({ jsonrpc: '2.0', method: 'progress', params: params });
}

function withHeartbeat(stage, work) {
  progress({ stage: stage });
  const timer = setInterval(function () {
    progress({ stage: stage });
  }, 8000);
  return Promise.resolve()
    .then(work)
    .finally(function () {
      clearInterval(timer);
    });
}

function fail(message) {
  return { ok: false, message: String(message || '未知错误') };
}

function secretFrom(request, key) {
  const secrets = request && request.cindy && request.cindy.secrets;
  const value = secrets && typeof secrets[key] === 'string' ? secrets[key].trim() : '';
  return value;
}

function normalizeBase(raw, fallback) {
  let s = typeof raw === 'string' ? raw.trim() : '';
  if (!s && typeof fallback === 'string') s = fallback.trim();
  if (!s) throw new Error('请先填写网关 Base URL');
  s = s.replace(/\/+$/, '');
  if (!/^https:\/\//i.test(s)) {
    if (/^http:\/\//i.test(s)) throw new Error('网关必须是 https://，拒绝明文 HTTP');
    s = 'https://' + s;
  }
  assertHttpsUrl(s, '网关 Base URL');
  if (!/\/v1$/i.test(s)) s += '/v1';
  return s;
}

function classifyModel(id) {
  const s = String(id || '').toLowerCase();
  if (!s) return 'other';
  if (/(imagine-video|grok-imagine-video|kling|runway|sora|^video-)/.test(s) || /video/.test(s)) {
    return 'video';
  }
  if (/(imagine-image|grok-imagine-image|dall-e|dalle|gpt-image|flux|stable-diffusion|sdxl|imagen)/.test(s)) {
    return 'image';
  }
  return 'other';
}

function httpRequest(urlString, options) {
  const method = options.method || 'GET';
  const headers = Object.assign({}, options.headers || {});
  const body = options.body || null;
  const timeoutMs = options.timeoutMs || 60000;
  const retries = options.retries == null ? paidMethodRetries(method) : options.retries;
  let last = 'request failed';

  return new Promise((resolve, reject) => {
    let attempt = 0;

    function once() {
      const url = new URL(urlString);
      if (url.protocol !== 'https:') {
        reject(new Error('只允许 https:// 请求'));
        return;
      }
      const lib = https;
      const req = lib.request(
        {
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || (url.protocol === 'http:' ? 80 : 443),
          path: url.pathname + url.search,
          method: method,
          headers: headers,
        },
        (res) => {
          const chunks = [];
          let total = 0;
          res.on('data', (c) => {
            total += c.length;
            if (total > MAX_BUFFER) {
              req.destroy(new Error('响应超过 50MB 上限'));
              return;
            }
            chunks.push(c);
          });
          res.on('end', () => {
            const buf = Buffer.concat(chunks);
            const status = res.statusCode || 0;
            if (status >= 500 && attempt < retries) {
              last = 'HTTP ' + status;
              retry();
              return;
            }
            resolve({ status: status, headers: res.headers, body: buf });
          });
        },
      );
      req.on('error', (err) => {
        last = err && err.message ? err.message : String(err);
        if (attempt < retries) retry();
        else reject(new Error(last));
      });
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error('timeout'));
      });
      if (body) req.write(body);
      req.end();
    }

    function retry() {
      attempt += 1;
      setTimeout(once, Math.pow(2, attempt - 1) * 3000);
    }

    once();
  });
}

function parseHttpJson(res) {
  const text = res.body.toString('utf8');
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : {};
  } catch {
    parsed = { raw: text.slice(0, 300) };
  }
  if (res.status >= 400) {
    const detail = typeof parsed.error === 'string'
      ? parsed.error
      : parsed.error && parsed.error.message
        ? parsed.error.message
        : text.slice(0, 300);
    const err = new Error('HTTP ' + res.status + ': ' + detail);
    err.status = res.status;
    throw err;
  }
  return parsed;
}

async function jsonRequest(url, key, body, timeoutMs) {
  const headers = { Authorization: 'Bearer ' + key };
  let payload = null;
  if (body !== null && body !== undefined) {
    payload = Buffer.from(JSON.stringify(body), 'utf8');
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(payload.length);
  }
  const res = await httpRequest(url, {
    method: body ? 'POST' : 'GET',
    headers: headers,
    body: payload,
    timeoutMs: timeoutMs || 60000,
    retries: body ? 0 : 3,
  });
  return parseHttpJson(res);
}

function sniffMime(buf) {
  if (!buf || buf.length < 12) return 'application/octet-stream';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  if (buf.slice(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return 'application/octet-stream';
}

function extForMime(mime) {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/webp') return '.webp';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'video/mp4') return '.mp4';
  return '.png';
}

function readImageSize(buf) {
  if (!buf || buf.length < 24) return { width: 0, height: 0 };
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker === 0xc0 || marker === 0xc1 || marker === 0xc2) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      if (marker === 0xd8 || marker === 0xd9) {
        i += 2;
        continue;
      }
      const len = buf.readUInt16BE(i + 2);
      if (len < 2) break;
      i += 2 + len;
    }
  }
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP' && buf.length >= 30) {
    const chunk = buf.slice(12, 16).toString('ascii');
    if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
  }
  return { width: 0, height: 0 };
}

function storeResult(buf) {
  const id = randomUUID();
  results.set(id, buf);
  const mime = sniffMime(buf);
  const size = mime.indexOf('image/') === 0 ? readImageSize(buf) : { width: 0, height: 0 };
  return {
    ok: true,
    cacheId: id,
    bytes: buf.length,
    mime: mime,
    width: size.width || undefined,
    height: size.height || undefined,
  };
}

function dataUrlFor(buf) {
  const mime = sniffMime(buf);
  return 'data:' + mime + ';base64,' + buf.toString('base64');
}

function absoluteMediaUrl(base, value) {
  if (typeof value !== 'string' || !value) return '';
  if (/^https:\/\//i.test(value)) return value;
  if (/^http:\/\//i.test(value)) throw new Error('拒绝下载明文 HTTP 地址');
  const path = value.startsWith('/') ? value : '/' + value;
  return originOf(base) + path;
}

async function downloadUrl(url, key, gatewayBase, timeoutMs) {
  const headers = downloadAuthHeader(url, gatewayBase, key);
  const res = await httpRequest(url, {
    method: 'GET',
    headers: headers,
    timeoutMs: timeoutMs || 120000,
    retries: 2,
  });
  if (res.status >= 400) {
    throw new Error('下载失败 HTTP ' + res.status);
  }
  return res.body;
}

function collectSourceBuffers(ids) {
  const list = Array.isArray(ids) ? ids : [];
  const out = [];
  for (const id of list) {
    const buf = sources.get(id);
    if (!buf) throw new Error('源图缓存已失效，请重试并把参考图放进 attachments');
    out.push(buf);
  }
  return out;
}

function resultFromImagePayload(payload, base, key) {
  const items = payload.data || payload.images || [];
  const first = items[0] || payload;
  if (first && typeof first.b64_json === 'string' && first.b64_json) {
    return storeResult(Buffer.from(first.b64_json, 'base64'));
  }
  const url = first && (first.url || first.image_url);
  if (!url) throw new Error('网关响应里没有图片 url / b64_json');
  const abs = absoluteMediaUrl(base, url);
  return withHeartbeat('download', function () {
    return downloadUrl(abs, key, base, 120000);
  }).then(storeResult);
}

async function generateImage(base, key, params, sourceBufs) {
  const model = (params.model || DEFAULT_IMAGE_MODEL).trim();
  const body = {
    model: model,
    prompt: String(params.prompt || ''),
  };
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;

  if (sourceBufs.length === 1) {
    body.image = { url: dataUrlFor(sourceBufs[0]) };
  } else if (sourceBufs.length > 1) {
    body.images = sourceBufs.map((buf) => ({ url: dataUrlFor(buf) }));
  }

  const payload = await withHeartbeat('image', function () {
    return jsonRequest(base + '/images/generations', key, body, 180000);
  });
  return resultFromImagePayload(payload, base, key);
}

function openaiSize(model, aspect) {
  if (!aspect) return '';
  const m = String(model || '').toLowerCase();
  const landscape = aspect === '16:9' || aspect === '3:2' || aspect === '4:3';
  const portrait = aspect === '9:16' || aspect === '2:3' || aspect === '3:4';
  if (m.indexOf('dall-e-2') !== -1 || m.indexOf('dalle-2') !== -1) return '1024x1024';
  if (m.indexOf('gpt-image-2') !== -1) {
    return {
      '1:1': '1024x1024', '16:9': '1536x864', '9:16': '864x1536', '3:2': '1536x1024',
      '2:3': '1024x1536', '4:3': '1280x960', '3:4': '960x1280',
    }[aspect] || '1024x1024';
  }
  if (m.indexOf('gpt-image') !== -1) {
    if (landscape) return '1536x1024';
    if (portrait) return '1024x1536';
    return '1024x1024';
  }
  if (landscape) return '1792x1024';
  if (portrait) return '1024x1792';
  return '1024x1024';
}

function buildMultipart(fields, files) {
  const boundary = '----GrokGen' + randomUUID().replace(/-/g, '');
  const parts = [];
  Object.keys(fields).forEach(function (name) {
    const value = fields[name];
    if (value === undefined || value === null || value === '') return;
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + name + '"\r\n\r\n' + String(value) + '\r\n',
    ));
  });
  files.forEach(function (file) {
    parts.push(Buffer.from(
      '--' + boundary + '\r\nContent-Disposition: form-data; name="' + file.field +
      '"; filename="' + file.filename + '"\r\nContent-Type: ' + file.mime + '\r\n\r\n',
    ));
    parts.push(file.body);
    parts.push(Buffer.from('\r\n'));
  });
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { boundary: boundary, body: Buffer.concat(parts) };
}

async function generateOpenAIImage(base, key, params, sourceBufs) {
  const model = (params.model || DEFAULT_OPENAI_IMAGE).trim();
  const prompt = String(params.prompt || '');
  const size = params.size || openaiSize(model, params.aspect_ratio);
  const sizeError = openaiSizeError(model, size);
  if (sizeError) throw new Error(sizeError);
  const options = {
    quality: params.quality,
    background: params.background,
    output_format: params.output_format,
  };
  if (size) options.size = size;

  if (sourceBufs.length) {
    const fields = Object.assign({ model: model, prompt: prompt }, options);
    const files = sourceBufs.slice(0, 4).map(function (buf, index) {
      const mime = sniffMime(buf);
      return {
        field: sourceBufs.length === 1 ? 'image' : 'image[]',
        filename: 'ref-' + (index + 1) + extForMime(mime),
        mime: mime,
        body: buf,
      };
    });
    const packed = buildMultipart(fields, files);
    const res = await withHeartbeat('image-edit', function () {
      return httpRequest(base + '/images/edits', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + key,
          'Content-Type': 'multipart/form-data; boundary=' + packed.boundary,
          'Content-Length': String(packed.body.length),
        },
        body: packed.body,
        timeoutMs: 180000,
        retries: 0,
      });
    });
    return resultFromImagePayload(parseHttpJson(res), base, key);
  }

  const body = { model: model, prompt: prompt };
  Object.keys(options).forEach(function (name) {
    if (options[name]) body[name] = options[name];
  });
  if (/dall-e/i.test(model)) body.response_format = 'b64_json';
  const payload = await withHeartbeat('image', function () {
    return jsonRequest(base + '/images/generations', key, body, 180000);
  });
  return resultFromImagePayload(payload, base, key);
}

async function generateVideo(base, key, params, sourceBufs) {
  const model = (params.model || DEFAULT_VIDEO_MODEL).trim();
  const body = {
    model: model,
    prompt: String(params.prompt || ''),
    duration: Number(params.duration || 6),
    resolution: params.resolution || '720p',
  };
  if (params.aspect_ratio) body.aspect_ratio = params.aspect_ratio;
  if (sourceBufs.length >= 1) {
    body.image = { url: dataUrlFor(sourceBufs[0]) };
  }
  if (sourceBufs.length >= 2) {
    body.last_frame = { url: dataUrlFor(sourceBufs[1]) };
  }

  progress({ stage: 'submit' });
  const submitted = await jsonRequest(base + '/videos/generations', key, body, 60000);
  const requestId = submitted.request_id || submitted.id;
  if (!requestId) throw new Error('网关响应里没有 request_id');

  const deadline = Date.now() + VIDEO_MAX_WAIT_MS;
  while (true) {
    progress({ stage: 'poll', requestId: requestId });
    const payload = await jsonRequest(base + '/videos/' + requestId, key, null, 60000);
    const status = payload.status || '';
    if (status === 'done' || status === 'completed' || status === 'succeeded') {
      const video = payload.video || payload;
      const url = video.url || (video.video && video.video.url);
      if (!url) throw new Error('网关完成但没有 video.url');
      const abs = absoluteMediaUrl(base, url);
      const buf = await withHeartbeat('download', function () {
        return downloadUrl(abs, key, base, 180000);
      });
      return storeResult(buf);
    }
    if (status === 'failed' || status === 'expired' || status === 'error') {
      throw new Error('视频生成失败：' + (payload.error && payload.error.message ? payload.error.message : status));
    }
    if (Date.now() > deadline) {
      throw new Error('轮询超过 10 分钟仍未完成，最后状态：' + (status || 'unknown'));
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

async function handleListModels(request, secretKey, fallbackBase) {
  const key = secretFrom(request, secretKey);
  if (!key) {
    return fail(
      secretKey === 'openai_key'
        ? '未配置 OpenAI API Key。请到插件设置页保存。'
        : '未配置 Grok API Key。请到插件设置页保存。',
    );
  }
  const params = request.params || {};
  const base = normalizeBase(params.baseUrl, fallbackBase);
  const payload = await jsonRequest(base + '/models', key, null, 30000);
  const raw = payload.data || payload.models || [];
  const models = [];
  const seen = {};
  raw.forEach(function (item) {
    const id = item && (item.id || item.name);
    if (!id || seen[id]) return;
    seen[id] = true;
    models.push({
      id: String(id),
      name: String((item && (item.name || item.id)) || id),
      kind: classifyModel(id),
    });
  });
  const media = models.filter(function (m) {
    return m.kind === 'image' || m.kind === 'video';
  });
  media.sort(function (a, b) {
    const rank = { image: 0, video: 1 };
    const d = (rank[a.kind] || 9) - (rank[b.kind] || 9);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  return {
    ok: true,
    baseUrl: base,
    models: media,
    image: media.filter(function (m) { return m.kind === 'image'; }),
    video: media.filter(function (m) { return m.kind === 'video'; }),
  };
}

function handlePut(params) {
  const id = typeof params.sourceId === 'string' && params.sourceId ? params.sourceId : randomUUID();
  const offset = Number(params.offset || 0);
  const b64 = typeof params.b64 === 'string' ? params.b64 : '';
  if (!b64) return fail('缺少分片数据');
  const piece = Buffer.from(b64, 'base64');
  let buf = sources.get(id) || Buffer.alloc(0);
  if (offset !== buf.length) return fail('分片偏移不连续');
  if (buf.length + piece.length > MAX_BUFFER) return fail('源图超过 50MB 上限');
  sources.set(id, Buffer.concat([buf, piece]));
  return { ok: true, sourceId: id, bytes: sources.get(id).length };
}

function handleRead(params) {
  const id = params.cacheId;
  const buf = results.get(id);
  if (!buf) return fail('结果缓存已失效，请重新生成');
  const offset = Math.max(0, Number(params.offset || 0));
  const length = Math.max(1, Math.min(Number(params.length || 180000), buf.length - offset));
  if (offset >= buf.length) return { ok: true, b64: '', eof: true };
  return {
    ok: true,
    b64: buf.subarray(offset, offset + length).toString('base64'),
    eof: offset + length >= buf.length,
  };
}

async function handleGenerate(request) {
  const key = secretFrom(request, 'api_key');
  if (!key) return fail('未配置 API Key。请到插件设置页保存 Grok API Key。');
  const params = request.params || {};
  const base = normalizeBase(params.baseUrl, DEFAULT_GROK_BASE);
  const sourceBufs = collectSourceBuffers(params.sourceIds || []);
  const kind = params.kind;
  if (kind === 'image') return generateImage(base, key, params, sourceBufs);
  if (kind === 'video') return generateVideo(base, key, params, sourceBufs);
  return fail('不认识的 kind');
}

async function handleGenerateOpenAI(request) {
  const key = secretFrom(request, 'openai_key');
  if (!key) return fail('未配置 OpenAI API Key。请到插件设置页保存。');
  const params = request.params || {};
  if (params.kind === 'video') return fail('OpenAI 通道不支持视频生成，请改用 Grok。');
  const base = normalizeBase(params.baseUrl, DEFAULT_OPENAI_BASE);
  const sourceBufs = collectSourceBuffers(params.sourceIds || []);
  return generateOpenAIImage(base, key, params, sourceBufs);
}

async function dispatch(request) {
  const method = request.method;
  const params = request.params || {};
  if (method === 'media/put') return handlePut(params);
  if (method === 'media/read') return handleRead(params);
  if (method === 'media/forget') {
    if (params.sourceId) sources.delete(params.sourceId);
    if (params.cacheId) results.delete(params.cacheId);
    return { ok: true };
  }
  if (method === 'media/list_models') return handleListModels(request, 'api_key', DEFAULT_GROK_BASE);
  if (method === 'media/list_openai') return handleListModels(request, 'openai_key', DEFAULT_OPENAI_BASE);
  if (method === 'media/generate') return handleGenerate(request);
  if (method === 'media/generate_openai') return handleGenerateOpenAI(request);
  throw Object.assign(new Error('Method not found'), { rpcCode: -32601 });
}

readline.createInterface({ input: process.stdin }).on('line', async (line) => {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    reply({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!request || request.id === undefined || request.id === null) return;
  try {
    const result = await dispatch(request);
    reply({ jsonrpc: '2.0', id: request.id, result: result });
  } catch (err) {
    const code = err && err.rpcCode ? err.rpcCode : -32000;
    reply({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: code, message: err && err.message ? err.message : String(err) },
    });
  }
});
