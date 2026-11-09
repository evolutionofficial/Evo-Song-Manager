'use strict';
// SYNC — membaca config.json (berisi kunci sync; tidak pernah disimpan di GitHub).
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');
const SOURCES_PATH = path.join(__dirname, '..', 'sources.json');

/**
 * sources.json (opsional, tidak berisi kunci):
 *   {
 *     "main": "pc",                       // nama sumber folder utama (PC = "pc", MacBook = "mac")
 *     "extra": [ { "name": "backup", "root": "G:\\FIrst CLUB", "archive": true } ]
 *   }
 * archive = lagu baru otomatis Paid, nama yang tidak dikenal diabaikan (tidak masuk Needs review).
 */
function loadSources(cfg) {
  let s = {};
  if (fs.existsSync(SOURCES_PATH)) {
    try { s = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8')); }
    catch (e) { throw new Error(`sources.json rusak: ${e.message}`); }
  }
  const okName = (n) => /^[a-z][a-z0-9-]{0,30}$/.test(n);
  const main = s.main || 'pc';
  if (!okName(main)) throw new Error(`sources.json: nama "${main}" tidak valid (huruf kecil/angka/-)`);
  const list = [{ name: main, root: cfg.root, archive: false, main: true }];
  for (const x of s.extra || []) {
    if (!x || !okName(x.name) || !x.root) throw new Error('sources.json: setiap sumber "extra" butuh "name" (huruf kecil) dan "root"');
    if (list.some((y) => y.name === x.name)) throw new Error(`sources.json: nama sumber "${x.name}" dobel`);
    list.push({ name: x.name, root: x.root, archive: !!x.archive, main: false });
  }
  return list;
}

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of ['supabaseUrl', 'anonKey', 'syncSecret', 'root']) {
    if (!cfg[k]) throw new Error(`config.json: "${k}" belum diisi`);
  }
  cfg.intervalSeconds = Number(cfg.intervalSeconds) || 60;
  cfg.sources = loadSources(cfg);
  return cfg;
}

module.exports = { loadConfig, loadSources, CONFIG_PATH };
