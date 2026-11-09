'use strict';
// MEDIA — pengaturan. Kunci (sync\config.json dan r2.txt) hanya ada di PC ini,
// tidak pernah disimpan di GitHub.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const CONFIG_PATH = path.join(DIR, 'config.json');
const R2_PATH = path.join(DIR, 'r2.txt');
const SYNC_CONFIG_PATH = path.join(DIR, '..', 'sync', 'config.json');

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

/**
 * Alamat database dan kunci diambil dari pengaturan First Club Sync (..\sync\config.json),
 * jadi tidak ada kunci baru yang perlu disalin. drive\config.json (opsional) boleh menimpa
 * bucket / intervalSeconds / root.
 */
function loadConfig() {
  let sync;
  try { sync = readJson(SYNC_CONFIG_PATH); }
  catch (e) { throw new Error(`pengaturan First Club Sync (sync\\config.json) tidak bisa dibaca: ${e.message}`); }
  let own = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try { own = readJson(CONFIG_PATH); } catch (e) { throw new Error(`drive\\config.json rusak: ${e.message}`); }
  }
  const cfg = {
    supabaseUrl: own.supabaseUrl || sync.supabaseUrl,
    anonKey: own.anonKey || sync.anonKey,
    agentSecret: own.agentSecret || sync.syncSecret,
    root: own.root || sync.root || path.resolve(DIR, '..', '..'),
    bucket: own.bucket || 'evo-audio',
    intervalSeconds: Number(own.intervalSeconds) || 15,
  };
  for (const k of ['supabaseUrl', 'anonKey', 'agentSecret']) {
    if (!cfg[k]) throw new Error(`pengaturan "${k}" tidak ditemukan (cek sync\\config.json)`);
  }
  cfg.r2 = parseR2(readR2());
  cfg.sources = loadSyncSources(cfg);
  cfg.root = cfg.sources[0].root;
  return cfg;
}

/** Sumber folder sama seperti First Club Sync (sync\\sources.json): PC, backup G:, MacBook. */
function loadSyncSources(cfg) {
  try {
    const { loadSources } = require(path.join(DIR, '..', 'sync', 'lib', 'config.js'));
    return loadSources({ root: cfg.root });
  } catch (e) {
    if (/sources\.json/.test(e.message)) throw e;
    return [{ name: 'pc', root: cfg.root, archive: false, main: true }];
  }
}

function readR2() {
  try { return fs.readFileSync(R2_PATH, 'utf8'); }
  catch (e) { throw new Error('r2.txt tidak ditemukan di folder drive'); }
}

/**
 * Membaca r2.txt dengan format bebas. Yang dicari:
 *  - endpoint  https://<ACCOUNT_ID>.r2.cloudflarestorage.com   (atau baris "Account ID: ...")
 *  - Access Key ID      : 32 karakter hex
 *  - Secret Access Key  : 64 karakter hex
 * Isi kunci tidak pernah ditulis ke log.
 */
function parseR2(text) {
  const lines = String(text).split(/\r?\n/);
  const out = { accountId: null, accessKeyId: null, secretAccessKey: null, endpoint: null };
  const ep = text.match(/https:\/\/([0-9a-f]{32})\.((?:[a-z]+\.)?r2\.cloudflarestorage\.com)/i);
  if (ep) { out.accountId = ep[1].toLowerCase(); out.endpoint = `https://${ep[1].toLowerCase()}.${ep[2].toLowerCase()}`; }
  const tok = (re, line) => (line.replace(/https:\/\/\S+/g, ' ').match(re) || [])[0];
  for (const line of lines) {
    const l = line.toLowerCase();
    if (!out.secretAccessKey && /secret/.test(l)) out.secretAccessKey = tok(/\b[0-9a-f]{64}\b/i, line) || null;
    if (!out.accessKeyId && /access/.test(l) && !/secret/.test(l)) out.accessKeyId = tok(/\b[0-9a-f]{32}\b/i, line) || null;
    if (!out.accountId && /account/.test(l)) out.accountId = (tok(/\b[0-9a-f]{32}\b/i, line) || '').toLowerCase() || null;
  }
  // Tanpa label: ambil dari urutan token yang ada.
  const all = (text.replace(/https:\/\/\S+/g, ' ').match(/\b[0-9a-f]{32,64}\b/gi) || []);
  if (!out.secretAccessKey) out.secretAccessKey = all.find((t) => t.length === 64) || null;
  if (!out.accessKeyId) out.accessKeyId = all.find((t) => t.length === 32 && t.toLowerCase() !== out.accountId) || null;
  if (!out.endpoint && out.accountId) out.endpoint = `https://${out.accountId}.r2.cloudflarestorage.com`;
  const missing = [];
  if (!out.endpoint) missing.push('endpoint (https://<account id>.r2.cloudflarestorage.com)');
  if (!out.accessKeyId) missing.push('Access Key ID');
  if (!out.secretAccessKey) missing.push('Secret Access Key');
  if (missing.length) throw new Error('r2.txt belum lengkap: ' + missing.join(', ') + ' tidak ditemukan');
  return out;
}

module.exports = { loadConfig, parseR2, CONFIG_PATH };
