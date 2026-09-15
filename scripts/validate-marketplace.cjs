#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifestPath = path.join(root, '.agents/plugins/marketplace.json');
if (!fs.existsSync(manifestPath)) {
  throw new Error('missing .agents/plugins/marketplace.json');
}
const marketplace = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (!marketplace.name || !Array.isArray(marketplace.plugins) || marketplace.plugins.length < 1) {
  throw new Error('marketplace.json must have name and plugins[]');
}

for (const entry of marketplace.plugins) {
  const rel = typeof entry.source === 'string' ? entry.source : entry.source && entry.source.path;
  if (!rel) throw new Error(`plugin ${entry.name} missing source`);
  const dir = path.join(root, rel);
  const ghostPath = path.join(dir, 'ghost.json');
  if (!fs.existsSync(ghostPath)) throw new Error(`missing ${path.relative(root, ghostPath)}`);
  const ghost = JSON.parse(fs.readFileSync(ghostPath, 'utf8'));
  if (!ghost.id || !ghost.name || !ghost.version || !ghost.entry) {
    throw new Error(`${rel}/ghost.json missing id/name/version/entry`);
  }
  const entryFile = path.join(dir, ghost.entry);
  if (!fs.existsSync(entryFile)) throw new Error(`missing entry ${ghost.entry}`);
  if (ghost.icon) {
    const icon = path.join(dir, ghost.icon);
    if (!fs.existsSync(icon)) throw new Error(`missing icon ${ghost.icon}`);
    const bytes = fs.statSync(icon).size;
    if (bytes < 10000) throw new Error(`icon too small (${bytes} bytes), placeholder?`);
  }
  console.log(`ok ${marketplace.name} -> ${entry.name} (${ghost.id}@${ghost.version})`);
}
