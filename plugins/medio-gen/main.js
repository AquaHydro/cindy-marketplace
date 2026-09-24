/* global cindy */

const DEFAULT_GROK_BASE = '';
const DEFAULT_OPENAI_BASE = '';
const DEFAULT_IMAGE_MODEL = 'grok-imagine-image-2.0';
const DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5';
const DEFAULT_OPENAI_IMAGE = 'gpt-image-2';
const HASH_RE = /[0-9a-f]{64}/i;
const MEDIA_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.mp4', '.webm'];
const PUT_CHUNK = 80 * 1024;
const READ_CHUNK = 180 * 1024;
const CHANNEL = new BroadcastChannel('medio-gen');
const OPENAI_ONLY_ARGS = ['size', 'quality', 'background', 'output_format'];

function failCall(callId, message) {
  return cindy.send({
    type: 'tool-result',
    callId: callId,
    ok: false,
    message: message,
  });
}

function nodeErrorMessage(response) {
  if (!response) return 'Node 工作进程无响应';
  if (typeof response.message === 'string' && response.message) return response.message;
  return 'Node 工作进程调用失败';
}

async function readKv() {
  const res = await fetch('/kv');
  if (!res.ok) throw new Error('读取设置失败');
  const cfg = await res.json();
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('设置损坏');
  return cfg;
}

let kvWriteChain = Promise.resolve();
function writeKv(patch) {
  const job = kvWriteChain.then(async function () {
    const cur = await readKv();
    const next = Object.assign({}, cur, patch);
    const res = await fetch('/kv', { method: 'PUT', body: JSON.stringify(next) });
    if (!res.ok && res.status !== 204) throw new Error('保存设置失败');
    return next;
  });
  kvWriteChain = job.then(
    function () {},
    function () {},
  );
  return job;
}

async function readSecrets() {
  const empty = {
    grok: { saved: false, tail: '' },
    openai: { saved: false, tail: '' },
  };
  try {
    const list = await (await fetch('/secrets')).json();
    if (!Array.isArray(list)) return empty;
    function one(key) {
      const row = list.find(function (item) { return item && item.key === key; });
      return {
        saved: !!(row && row.saved),
        tail: row && typeof row.tail === 'string' ? row.tail : '',
      };
    }
    return { grok: one('api_key'), openai: one('openai_key') };
  } catch (_err) {
    return empty;
  }
}

function optionalString(args, key) {
  return args && typeof args[key] === 'string' && args[key].trim() ? args[key].trim() : '';
}

function extractHash(value) {
  if (typeof value !== 'string') return null;
  const match = value.match(HASH_RE);
  return match ? match[0].toLowerCase() : null;
}

function extractExt(value) {
  if (typeof value !== 'string') return '';
  const match = value.match(/[0-9a-f]{64}(\.[a-z0-9]{1,10})/i);
  return match ? match[1].toLowerCase() : '';
}

function collectHashes(args) {
  const out = [];
  const seen = {};
  function add(value) {
    const hash = extractHash(value);
    if (!hash || seen[hash]) return;
    seen[hash] = true;
    out.push({ hash: hash, ext: extractExt(value) });
  }
  if (args && Array.isArray(args.images)) args.images.forEach(add);
  if (args && Array.isArray(args.attachments)) args.attachments.forEach(add);
  return out;
}

function u8ToB64(u8) {
  let binary = '';
  const step = 0x8000;
  for (let i = 0; i < u8.length; i += step) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + step));
  }
  return btoa(binary);
}

function inferProvider(kind, args, kv) {
  if (kind === 'video') return 'grok';
  const explicit = optionalString(args, 'provider');
  if (explicit === 'openai' || explicit === 'grok') return explicit;
  return kv.imageProvider === 'openai' ? 'openai' : 'grok';
}

async function fetchOwnedBytes(hash, hintedExt) {
  const tries = [];
  if (hintedExt) tries.push(hintedExt);
  MEDIA_EXTS.forEach(function (ext) {
    if (tries.indexOf(ext) === -1) tries.push(ext);
  });
  for (let i = 0; i < tries.length; i += 1) {
    try {
      const response = await fetch('/media/' + hash + tries[i]);
      if (!response.ok) continue;
      const buf = new Uint8Array(await response.arrayBuffer());
      if (buf.length) return buf;
    } catch (_err) {
      /* try next ext */
    }
  }
  throw new Error(
    '读不到源图。请把要改的图放进 ghost_call 顶层 attachments，或填完整的 cindy-media://blobs/<指纹>.<后缀> 地址。',
  );
}

async function uploadSource(u8) {
  const sourceId = 'src-' + Date.now() + '-' + Math.random().toString(16).slice(2);
  let offset = 0;
  while (offset < u8.length) {
    const end = Math.min(u8.length, offset + PUT_CHUNK);
    const response = await cindy.node.request({
      method: 'media/put',
      params: {
        sourceId: sourceId,
        offset: offset,
        b64: u8ToB64(u8.subarray(offset, end)),
      },
    });
    if (!response.ok) throw new Error(nodeErrorMessage(response));
    const result = response.result || {};
    if (result.ok === false) throw new Error(result.message || '上传源图失败');
    offset = end;
  }
  return sourceId;
}

async function downloadResult(cacheId, totalBytes) {
  let offset = 0;
  const parts = [];
  while (offset < totalBytes) {
    const length = Math.min(READ_CHUNK, totalBytes - offset);
    const response = await cindy.node.request({
      method: 'media/read',
      params: { cacheId: cacheId, offset: offset, length: length },
    });
    if (!response.ok) throw new Error(nodeErrorMessage(response));
    const result = response.result || {};
    if (result.ok === false) throw new Error(result.message || '读取成品失败');
    if (result.b64) parts.push(result.b64);
    if (result.eof) break;
    offset += length;
  }
  return parts.join('');
}

async function depositBytes(callId, b64, label) {
  const deposited = await cindy.send({
    type: 'cindy-request',
    kind: 'deposit_media',
    data: b64,
    label: label || 'Grok Gen',
    callId: callId,
  });
  if (!deposited || deposited.ok !== true || typeof deposited.url !== 'string') {
    throw new Error(
      deposited && typeof deposited.message === 'string'
        ? deposited.message
        : '成品已生成，但写入 Cindy 媒体库失败。请重试。',
    );
  }
  return deposited.url;
}

function startHeartbeat(callId) {
  const timer = setInterval(function () {
    cindy.send({ type: 'tool-progress', callId: callId }).catch(function () {});
  }, 45000);
  return function stop() {
    clearInterval(timer);
  };
}

function pickDefault(current, classified) {
  if (current && classified.some(function (m) { return m.id === current; })) return current;
  if (classified[0] && classified[0].id) return classified[0].id;
  return current || '';
}

async function refreshProvider(provider) {
  const kv = await readKv();
  const isOpenAI = provider === 'openai';
  const method = isOpenAI ? 'media/list_openai' : 'media/list_models';
  const baseUrl = isOpenAI ? (kv.openaiBaseUrl || '') : (kv.baseUrl || '');
  if (!String(baseUrl).trim()) throw new Error('请先在设置页填写该通道的网关 Base URL');
  const response = await cindy.node.request({
    method: method,
    params: { baseUrl: baseUrl },
    timeoutMs: 30000,
  });
  if (!response.ok) throw new Error(nodeErrorMessage(response));
  const result = response.result || {};
  if (result.ok === false) throw new Error(result.message || '拉取模型列表失败');
  const models = Array.isArray(result.models) ? result.models : [];
  const image = Array.isArray(result.image) ? result.image : models.filter(function (m) { return m.kind === 'image'; });
  const video = Array.isArray(result.video) ? result.video : models.filter(function (m) { return m.kind === 'video'; });
  const patch = {};
  if (isOpenAI) {
    patch.openaiModels = models;
    patch.openaiImageModel = pickDefault(kv.openaiImageModel, image);
  } else {
    patch.grokModels = models;
    patch.imageModel = pickDefault(kv.imageModel, image);
    patch.videoModel = pickDefault(kv.videoModel, video);
  }
  const next = await writeKv(patch);
  CHANNEL.postMessage({ type: 'models-updated', provider: provider });
  return {
    provider: provider,
    baseUrl: result.baseUrl || baseUrl,
    models: models,
    imageModel: isOpenAI ? next.openaiImageModel : next.imageModel,
    videoModel: isOpenAI ? null : next.videoModel,
  };
}

async function statusPayload(refreshed) {
  const kv = await readKv();
  const secrets = await readSecrets();
  return {
    grok: {
      ready: secrets.grok.saved === true,
      baseUrl: kv.baseUrl || '',
      apiKeySaved: secrets.grok.saved === true,
      apiKeyTail: secrets.grok.tail || '',
      imageModel: kv.imageModel || DEFAULT_IMAGE_MODEL,
      videoModel: kv.videoModel || DEFAULT_VIDEO_MODEL,
      models: Array.isArray(kv.grokModels) ? kv.grokModels : [],
    },
    openai: {
      ready: secrets.openai.saved === true,
      baseUrl: kv.openaiBaseUrl || '',
      apiKeySaved: secrets.openai.saved === true,
      apiKeyTail: secrets.openai.tail || '',
      imageModel: kv.openaiImageModel || DEFAULT_OPENAI_IMAGE,
      video: false,
      models: Array.isArray(kv.openaiModels) ? kv.openaiModels : [],
    },
    imageProvider: kv.imageProvider === 'openai' ? 'openai' : 'grok',
    refreshed: refreshed || null,
    advice: secrets.grok.saved || secrets.openai.saved
      ? '至少一条通道已配置。出图用设置页的默认生图通道；视频只走 Grok。'
      : '请到插件详情页保存 API Key，填好网关 Base URL 后点「拉取模型」。',
  };
}

async function handleStatus(msg) {
  let refreshed = null;
  if (msg.args && msg.args.refresh === true) {
    const secrets = await readSecrets();
    const done = [];
    if (secrets.grok.saved) done.push(await refreshProvider('grok'));
    if (secrets.openai.saved) done.push(await refreshProvider('openai'));
    refreshed = done;
  }
  await cindy.send({
    type: 'tool-result',
    callId: msg.callId,
    ok: true,
    result: await statusPayload(refreshed),
  });
}

async function handleRefreshModels(msg) {
  const provider = optionalString(msg.args, 'provider');
  if (provider !== 'grok' && provider !== 'openai') {
    await failCall(msg.callId, 'provider 只能是 grok 或 openai。');
    return;
  }
  const listed = await refreshProvider(provider);
  await cindy.send({
    type: 'tool-result',
    callId: msg.callId,
    ok: true,
    result: listed,
  });
}

async function handleGenerate(msg) {
  const tool = msg.tool;
  const args = msg.args || {};
  const prompt = optionalString(args, 'prompt');
  if (!prompt) {
    await failCall(msg.callId, '缺少 prompt。请把用户原话透传进来。');
    return;
  }

  const needsImage = tool === 'edit_image' || tool === 'edit_video';
  const refs = collectHashes(args);
  if (needsImage && refs.length === 0) {
    await failCall(
      msg.callId,
      tool === 'edit_video'
        ? '图生视频需要参考图。请把图放进 ghost_call 顶层 attachments，或在 images 里填 cindy-media:// 地址。'
        : '改图需要源图。请把图放进 ghost_call 顶层 attachments，或在 images 里填 cindy-media:// 地址。',
    );
    return;
  }
  if (tool === 'edit_video' && refs.length > 2) refs.length = 2;
  if (tool === 'edit_image' && refs.length > 4) refs.length = 4;

  const kv = await readKv();
  const kind = tool === 'gen_video' || tool === 'edit_video' ? 'video' : 'image';
  const provider = inferProvider(kind, args, kv);
  if (kind === 'video' && provider === 'openai') {
    await failCall(msg.callId, 'OpenAI 通道不支持视频，请改用 Grok 通道。');
    return;
  }

  const isOpenAI = provider === 'openai';
  const openaiOnly = OPENAI_ONLY_ARGS.filter(function (name) { return optionalString(args, name); });
  if (!isOpenAI && openaiOnly.length) {
    await failCall(
      msg.callId,
      openaiOnly.join('、') + ' 只有 OpenAI 通道支持。请传 provider=openai，或在 Grok 通道改用 aspect_ratio。',
    );
    return;
  }
  const baseUrl = isOpenAI ? (kv.openaiBaseUrl || '') : (kv.baseUrl || '');
  if (!baseUrl.trim()) {
    await failCall(msg.callId, '请先在设置页填写该通道的网关 Base URL。');
    return;
  }
  const fallbackModel = kind === 'video'
    ? (kv.videoModel || DEFAULT_VIDEO_MODEL)
    : (isOpenAI ? (kv.openaiImageModel || DEFAULT_OPENAI_IMAGE) : (kv.imageModel || DEFAULT_IMAGE_MODEL));
  const method = isOpenAI ? 'media/generate_openai' : 'media/generate';

  const stop = startHeartbeat(msg.callId);
  const sourceIds = [];
  let cacheId = '';
  try {
    for (let i = 0; i < refs.length; i += 1) {
      const bytes = await fetchOwnedBytes(refs[i].hash, refs[i].ext);
      sourceIds.push(await uploadSource(bytes));
    }

    const response = await cindy.node.request({
      method: method,
      params: {
        kind: kind,
        prompt: prompt,
        model: optionalString(args, 'model') || fallbackModel,
        aspect_ratio: optionalString(args, 'aspect_ratio'),
        duration: args.duration,
        resolution: optionalString(args, 'resolution'),
        size: optionalString(args, 'size'),
        quality: optionalString(args, 'quality'),
        background: optionalString(args, 'background'),
        output_format: optionalString(args, 'output_format'),
        baseUrl: baseUrl,
        sourceIds: sourceIds,
      },
      timeoutMs: 60000,
      maxTotalMs: kind === 'video' ? 900000 : 240000,
    });
    if (!response.ok) throw new Error(nodeErrorMessage(response));
    const result = response.result || {};
    if (result.ok === false) throw new Error(result.message || '生成失败');
    cacheId = result.cacheId;
    if (!cacheId || !result.bytes) throw new Error('网关没有返回成品字节');

    const b64 = await downloadResult(cacheId, result.bytes);
    const url = await depositBytes(msg.callId, b64, prompt.slice(0, 80));
    const model = optionalString(args, 'model') || fallbackModel;
    const aspect = optionalString(args, 'aspect_ratio');
    const payload = {
      note: kind === 'video' ? '视频已生成' : '图片已生成',
      prompt: prompt,
      provider: provider,
      model: model,
      url: url,
      bytes: result.bytes,
      mime: result.mime,
    };
    if (aspect) payload.aspect_ratio = aspect;
    openaiOnly.forEach(function (name) { payload[name] = optionalString(args, name); });
    if (result.width) payload.width = result.width;
    if (result.height) payload.height = result.height;
    if (kind === 'video') {
      payload.duration_seconds = Number(args.duration || 6);
      payload.resolution = optionalString(args, 'resolution') || '720p';
      payload.xdt_video_urls = [url];
    } else {
      payload.xdt_image_urls = [url];
    }
    await cindy.send({
      type: 'tool-result',
      callId: msg.callId,
      ok: true,
      result: payload,
    });
  } catch (err) {
    await failCall(msg.callId, err && err.message ? err.message : String(err));
  } finally {
    stop();
    sourceIds.concat(cacheId ? [cacheId] : []).forEach(function (id) {
      cindy.node
        .request({
          method: 'media/forget',
          params: id === cacheId ? { cacheId: id } : { sourceId: id },
        })
        .catch(function () {});
    });
  }
}

CHANNEL.onmessage = function (event) {
  const data = event && event.data;
  if (!data || data.type !== 'list-models') return;
  const provider = data.provider === 'openai' ? 'openai' : 'grok';
  refreshProvider(provider)
    .then(function (listed) {
      CHANNEL.postMessage({
        type: 'list-models-result',
        nonce: data.nonce,
        ok: true,
        listed: listed,
      });
    })
    .catch(function (err) {
      CHANNEL.postMessage({
        type: 'list-models-result',
        nonce: data.nonce,
        ok: false,
        message: err && err.message ? err.message : String(err),
      });
    });
};

cindy.onHostMessage(function (msg) {
  if (msg.type !== 'tool-call') return;
  const tool = msg.tool;
  if (tool === 'grok_status') {
    handleStatus(msg).catch(function (err) {
      failCall(msg.callId, err && err.message ? err.message : String(err));
    });
    return;
  }
  if (tool === 'refresh_models') {
    handleRefreshModels(msg).catch(function (err) {
      failCall(msg.callId, err && err.message ? err.message : String(err));
    });
    return;
  }
  if (tool === 'gen_image' || tool === 'edit_image' || tool === 'gen_video' || tool === 'edit_video') {
    handleGenerate(msg).catch(function (err) {
      failCall(msg.callId, err && err.message ? err.message : String(err));
    });
  }
});
