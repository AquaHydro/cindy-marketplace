'use strict';

var DEFAULT_IMAGE_MODEL = 'grok-imagine-image-2.0';
var DEFAULT_VIDEO_MODEL = 'grok-imagine-video-1.5';
var DEFAULT_OPENAI_IMAGE = 'gpt-image-2';
var CHANNEL = new BroadcastChannel('medio-gen');
var EYE_SHOW = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/></svg>';
var EYE_HIDE = '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" d="M1.8 8s2.4-4.2 6.2-4.2S14.2 8 14.2 8 11.8 12.2 8 12.2 1.8 8 1.8 8z"/><circle cx="8" cy="8" r="1.8" fill="currentColor"/><path stroke="currentColor" stroke-width="1.4" d="M3 13.2 13 2.8"/></svg>';

var ICON_XAI = '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.469 8.776L16.512 23h-4.464L2.005 8.776H6.47zm-.004 7.9l2.233 3.164L6.467 23H2l4.465-6.324zM22 2.582V23h-3.659V7.764L22 2.582zM22 1l-9.952 14.095-2.233-3.163L17.533 1H22z"/></svg>';
var ICON_OPENAI = '<svg class="brand" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.495 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.787a4.49 4.49 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.674zm2.01-3.026l-.142-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.607 1.5-2.602-1.5z"/></svg>';

var DICT = {
  grokTab: { zh: 'Grok', en: 'Grok' },
  openaiTab: { zh: 'OpenAI', en: 'OpenAI' },
  baseLabel: { zh: '网关 Base URL', en: 'Gateway Base URL' },
  keyLabel: { zh: 'API Key', en: 'API Key' },
  imageLabel: { zh: '生图模型', en: 'Image model' },
  videoLabel: { zh: '视频模型', en: 'Video model' },
  openaiImageLabel: { zh: '生图模型', en: 'Image model' },
  defaultGrok: { zh: '设为默认生图通道', en: 'Use as default image provider' },
  defaultOpenAI: { zh: '设为默认生图通道', en: 'Use as default image provider' },
  save: { zh: '保存设置', en: 'Save settings' },
  fetch: { zh: '拉取模型', en: 'Fetch models' },
  fetching: { zh: '正在拉取…', en: 'Fetching…' },
  fetchOk: { zh: '已更新模型列表', en: 'Model list updated' },
  needUrl: { zh: '请先填写网关 Base URL', en: 'Enter a gateway Base URL first' },
  clear: { zh: '清除', en: 'Clear' },
  clearConfirm: { zh: '清除这个通道的 API Key？', en: 'Clear this channel’s API key?' },
  show: { zh: '显示', en: 'Show' },
  hide: { zh: '隐藏', en: 'Hide' },
  ok: { zh: '已保存', en: 'Saved' },
  cleared: { zh: '已清除 Key', en: 'Key cleared' },
  fail: { zh: '操作失败，请重试', en: 'Failed, please retry' },
  empty: { zh: '还没有媒体模型，请先拉取', en: 'No media models yet. Fetch the list first.' },
};

function t(key, locale) {
  var row = DICT[key];
  if (!row) return key;
  return locale === 'zh-CN' ? row.zh : row.en;
}

function $(id) {
  return document.getElementById(id);
}

function statusEl(provider) {
  return $(provider === 'openai' ? 'status-openai' : 'status-grok');
}

function setStatus(provider, text) {
  const el = statusEl(provider);
  if (el) el.textContent = text || '';
}

function syncFetchEnabled() {
  $('fetch-grok').disabled = !$('baseUrl').value.trim();
  $('fetch-openai').disabled = !$('openaiBaseUrl').value.trim();
}

function brandIcon(kind) {
  return kind === 'openai' ? ICON_OPENAI : ICON_XAI;
}

function mediaOnly(models, kind) {
  return (Array.isArray(models) ? models : []).filter(function (m) {
    return m && m.id && m.kind === kind;
  });
}

async function loadLocale() {
  try {
    const r = await (await fetch('/app-context')).json();
    return r && r.context && r.context.locale ? r.context.locale : 'en';
  } catch (_err) {
    return 'en';
  }
}

async function loadKv() {
  const res = await fetch('/kv');
  if (!res.ok) throw new Error('kv');
  const cfg = await res.json();
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) throw new Error('kv');
  return cfg;
}

var kvWriteChain = Promise.resolve();
function saveKv(patch) {
  var job = kvWriteChain.then(async function () {
    const cur = await loadKv();
    const res = await fetch('/kv', {
      method: 'PUT',
      body: JSON.stringify(Object.assign({}, cur, patch)),
    });
    if (!res.ok && res.status !== 204) throw new Error('kv');
  });
  kvWriteChain = job.then(function () {}, function () {});
  return job;
}

async function loadSecrets() {
  try {
    const list = await (await fetch('/secrets')).json();
    if (!Array.isArray(list)) return {};
    const map = {};
    list.forEach(function (item) {
      if (item && item.key) map[item.key] = item;
    });
    return map;
  } catch (_err) {
    return {};
  }
}

function syncToggle(button, input, locale) {
  const visible = input.type === 'text';
  button.innerHTML = visible ? EYE_HIDE : EYE_SHOW;
  button.setAttribute('aria-label', visible ? t('hide', locale) : t('show', locale));
  button.title = visible ? t('hide', locale) : t('show', locale);
}

function bindToggle(button, input, locale) {
  button.onclick = function () {
    input.type = input.type === 'password' ? 'text' : 'password';
    syncToggle(button, input, locale);
  };
  syncToggle(button, input, locale);
}

function closeMenus() {
  document.querySelectorAll('.picker-menu').forEach(function (el) {
    el.hidden = true;
  });
}

function appendBrandAndName(el, brand, label) {
  const icon = document.createElement('span');
  icon.className = 'brand-wrap';
  icon.innerHTML = brandIcon(brand);
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = label;
  el.appendChild(icon);
  el.appendChild(name);
}

function renderPicker(host, hidden, models, current, brand, locale) {
  const list = Array.isArray(models) ? models : [];
  const selected = list.find(function (m) { return m.id === current; }) || list[0] || null;
  hidden.value = selected ? selected.id : '';
  host.textContent = '';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'picker-btn';
  if (selected) appendBrandAndName(btn, brand, selected.id);
  else {
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = t('empty', locale);
    btn.appendChild(name);
  }
  const menu = document.createElement('div');
  menu.className = 'picker-menu';
  menu.hidden = true;
  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'picker-empty';
    empty.textContent = t('empty', locale);
    menu.appendChild(empty);
  } else {
    list.forEach(function (m) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'picker-item';
      item.setAttribute('aria-selected', m.id === hidden.value ? 'true' : 'false');
      appendBrandAndName(item, brand, m.id);
      item.onclick = function () {
        hidden.value = m.id;
        hidden.dispatchEvent(new Event('change'));
        closeMenus();
        renderPicker(host, hidden, list, m.id, brand, locale);
      };
      menu.appendChild(item);
    });
  }
  btn.onclick = function () {
    const open = menu.hidden;
    closeMenus();
    menu.hidden = !open;
  };
  host.appendChild(btn);
  host.appendChild(menu);
}

function showTab(name) {
  const grok = name === 'grok';
  $('tab-grok').setAttribute('aria-selected', grok ? 'true' : 'false');
  $('tab-openai').setAttribute('aria-selected', grok ? 'false' : 'true');
  $('panel-grok').hidden = !grok;
  $('panel-openai').hidden = grok;
}

function paintIcons() {
  document.querySelectorAll('[data-brand]').forEach(function (el) {
    el.innerHTML = brandIcon(el.getAttribute('data-brand'));
  });
}

function paint(locale, kv, secrets) {
  $('grok-tab-label').textContent = t('grokTab', locale);
  $('openai-tab-label').textContent = t('openaiTab', locale);
  $('base-label').textContent = t('baseLabel', locale);
  $('openai-base-label').textContent = t('baseLabel', locale);
  $('key-label').textContent = t('keyLabel', locale);
  $('openai-key-label').textContent = t('keyLabel', locale);
  $('image-label').textContent = t('imageLabel', locale);
  $('video-label').textContent = t('videoLabel', locale);
  $('openai-image-label').textContent = t('openaiImageLabel', locale);
  $('default-grok-label').textContent = t('defaultGrok', locale);
  $('default-openai-label').textContent = t('defaultOpenAI', locale);
  $('save-grok').textContent = t('save', locale);
  $('save-openai').textContent = t('save', locale);
  $('fetch-grok').textContent = t('fetch', locale);
  $('fetch-openai').textContent = t('fetch', locale);
  $('clear-grok').textContent = t('clear', locale);
  $('clear-openai').textContent = t('clear', locale);
  paintIcons();
  bindToggle($('toggle-grok-key'), $('apiKey'), locale);
  bindToggle($('toggle-openai-key'), $('openaiKey'), locale);

  const imageProvider = kv.imageProvider === 'openai' ? 'openai' : 'grok';
  $('default-grok').checked = imageProvider === 'grok';
  $('default-openai').checked = imageProvider === 'openai';
  $('baseUrl').value = kv.baseUrl || '';
  $('openaiBaseUrl').value = kv.openaiBaseUrl || '';

  const grokImages = mediaOnly(kv.grokModels, 'image');
  const grokVideos = mediaOnly(kv.grokModels, 'video');
  const openaiImages = mediaOnly(kv.openaiModels, 'image');
  renderPicker($('image-picker'), $('imageModel'), grokImages, kv.imageModel || DEFAULT_IMAGE_MODEL, 'xai', locale);
  renderPicker($('video-picker'), $('videoModel'), grokVideos, kv.videoModel || DEFAULT_VIDEO_MODEL, 'xai', locale);
  renderPicker($('openai-image-picker'), $('openaiImageModel'), openaiImages, kv.openaiImageModel || DEFAULT_OPENAI_IMAGE, 'openai', locale);
  syncFetchEnabled();
}

async function refresh(locale) {
  const kv = await loadKv();
  const secrets = await loadSecrets();
  paint(locale, kv && typeof kv === 'object' ? kv : {}, secrets);
}

async function putSecret(key, value) {
  if (!value) return;
  const res = await fetch('/secrets/' + key, {
    method: 'PUT',
    body: JSON.stringify({ value: value }),
  });
  if (!res.ok && res.status !== 204) throw new Error('secret');
}

function waitList(provider, nonce, timeoutMs) {
  return new Promise(function (resolve, reject) {
    const timer = setTimeout(function () {
      CHANNEL.removeEventListener('message', onMsg);
      reject(new Error('timeout'));
    }, timeoutMs);
    function onMsg(event) {
      const data = event && event.data;
      if (!data || data.type !== 'list-models-result' || data.nonce !== nonce) return;
      clearTimeout(timer);
      CHANNEL.removeEventListener('message', onMsg);
      if (data.ok) resolve(data);
      else reject(new Error(data.message || 'fetch failed'));
    }
    CHANNEL.addEventListener('message', onMsg);
    CHANNEL.postMessage({ type: 'list-models', provider: provider, nonce: nonce });
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function fetchModels(provider, locale) {
  setStatus(provider, t('fetching', locale));
  try { await fetch('/wake'); } catch (_err) {}
  await sleep(500);
  async function once() {
    const nonce = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    await waitList(provider, nonce, 20000);
  }
  try {
    await once();
  } catch (_first) {
    try { await fetch('/wake'); } catch (_err) {}
    await sleep(800);
    try {
      await once();
    } catch (err) {
      setStatus(provider, (err && err.message) || t('fail', locale));
      return;
    }
  }
  await refresh(locale);
  setStatus(provider, t('fetchOk', locale));
}

(async function init() {
  const locale = await loadLocale();
  await refresh(locale);
  document.addEventListener('click', function (event) {
    if (!event.target.closest('.picker')) closeMenus();
  });

  CHANNEL.addEventListener('message', function (event) {
    const data = event && event.data;
    if (data && data.type === 'models-updated') refresh(locale);
  });

  $('tab-grok').onclick = function () { showTab('grok'); };
  $('tab-openai').onclick = function () { showTab('openai'); };
  $('baseUrl').oninput = syncFetchEnabled;
  $('openaiBaseUrl').oninput = syncFetchEnabled;

  $('default-grok').onchange = async function () {
    $('default-grok').checked = true;
    $('default-openai').checked = false;
    await saveKv({ imageProvider: 'grok' });
  };
  $('default-openai').onchange = async function () {
    $('default-openai').checked = true;
    $('default-grok').checked = false;
    await saveKv({ imageProvider: 'openai' });
  };

  $('save-grok').onclick = async function () {
    setStatus('grok', '');
    try {
      await saveKv({
        baseUrl: $('baseUrl').value.trim(),
        imageModel: $('imageModel').value.trim() || DEFAULT_IMAGE_MODEL,
        videoModel: $('videoModel').value.trim() || DEFAULT_VIDEO_MODEL,
      });
      await putSecret('api_key', $('apiKey').value.trim());
      await refresh(locale);
      setStatus('grok', t('ok', locale));
    } catch (_err) {
      setStatus('grok', t('fail', locale));
    }
  };

  $('save-openai').onclick = async function () {
    setStatus('openai', '');
    try {
      await saveKv({
        openaiBaseUrl: $('openaiBaseUrl').value.trim(),
        openaiImageModel: $('openaiImageModel').value.trim() || DEFAULT_OPENAI_IMAGE,
      });
      await putSecret('openai_key', $('openaiKey').value.trim());
      await refresh(locale);
      setStatus('openai', t('ok', locale));
    } catch (_err) {
      setStatus('openai', t('fail', locale));
    }
  };

  $('fetch-grok').onclick = async function () {
    if (!$('baseUrl').value.trim()) {
      setStatus('grok', t('needUrl', locale));
      return;
    }
    try {
      await saveKv({ baseUrl: $('baseUrl').value.trim() });
      await putSecret('api_key', $('apiKey').value.trim());
      await fetchModels('grok', locale);
    } catch (_err) {
      setStatus('grok', t('fail', locale));
    }
  };

  $('fetch-openai').onclick = async function () {
    if (!$('openaiBaseUrl').value.trim()) {
      setStatus('openai', t('needUrl', locale));
      return;
    }
    try {
      await saveKv({ openaiBaseUrl: $('openaiBaseUrl').value.trim() });
      await putSecret('openai_key', $('openaiKey').value.trim());
      await fetchModels('openai', locale);
    } catch (_err) {
      setStatus('openai', t('fail', locale));
    }
  };

  $('clear-grok').onclick = async function () {
    if (!window.confirm(t('clearConfirm', locale))) return;
    setStatus('grok', '');
    try {
      const res = await fetch('/secrets/api_key', { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('delete');
      $('apiKey').value = '';
      $('apiKey').type = 'password';
      await refresh(locale);
      setStatus('grok', t('cleared', locale));
    } catch (_err) {
      setStatus('grok', t('fail', locale));
    }
  };

  $('clear-openai').onclick = async function () {
    if (!window.confirm(t('clearConfirm', locale))) return;
    setStatus('openai', '');
    try {
      const res = await fetch('/secrets/openai_key', { method: 'DELETE' });
      if (!res.ok && res.status !== 204) throw new Error('delete');
      $('openaiKey').value = '';
      $('openaiKey').type = 'password';
      await refresh(locale);
      setStatus('openai', t('cleared', locale));
    } catch (_err) {
      setStatus('openai', t('fail', locale));
    }
  };

  $('imageModel').onchange = function () {
    saveKv({ imageModel: $('imageModel').value }).catch(function () {});
  };
  $('videoModel').onchange = function () {
    saveKv({ videoModel: $('videoModel').value }).catch(function () {});
  };
  $('openaiImageModel').onchange = function () {
    saveKv({ openaiImageModel: $('openaiImageModel').value }).catch(function () {});
  };
})();
