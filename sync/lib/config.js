'use strict';
// SYNC — membaca config.json (berisi kunci sync; tidak pernah disimpan di GitHub).
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of ['supabaseUrl', 'anonKey', 'syncSecret', 'root']) {
    if (!cfg[k]) throw new Error(`config.json: "${k}" belum diisi`);
  }
  cfg.intervalSeconds = Number(cfg.intervalSeconds) || 60;
  return cfg;
}

module.exports = { loadConfig, CONFIG_PATH };
