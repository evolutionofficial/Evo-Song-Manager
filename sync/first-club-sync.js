#!/usr/bin/env node
// First Club Sync — memantau D:\FIRST CLUB dan mengirim daftar file Mixdown ke database.
// Butuh Node.js 18 atau lebih baru. Tidak perlu npm install.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HERE = __dirname;
const CONFIG_PATH = path.join(HERE, 'config.json');
const LOG_PATH = path.join(HERE, 'sync.log');

const SKIP_DIRS = new Set(['cache', 'history', '.git', 'node_modules', '$recycle.bin', 'system volume information']);
const MONTHS = '(jan|januari|feb|februari|mar|maret|apr|april|mei|may|jun|juni|jul|juli|agu|agt|ags|agustus|aug|august|sep|sept|september|okt|oktober|oct|october|nov|november|des|desember|dec|december)';
const DATE_RE = new RegExp('\\b(\\d{1,2})\\s*' + MONTHS + '\\b', 'i');
const NAME_RE = /^\s*([^-]+?)\s*-\s*(.+?)\s*\.wav$/i;

function log(msg) {
  const line = `[${new Date().toLocaleString('id-ID')}] ${msg}`;
  console.log(line);
  try {
    if (fs.existsSync(LOG_PATH) && fs.statSync(LOG_PATH).size > 1024 * 1024) {
      fs.renameSync(LOG_PATH, LOG_PATH + '.old');
    }
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch (_) { /* log is best-effort */ }
}

function loadConfig() {
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  for (const k of ['supabaseUrl', 'anonKey', 'syncSecret', 'root']) {
    if (!cfg[k]) throw new Error(`config.json: "${k}" belum diisi`);
  }
  cfg.intervalSeconds = Number(cfg.intervalSeconds) || 60;
  return cfg;
}

function isVocalistFolder(name) {
  return !/^[._$]/.test(name);
}

function sessionLabel(segments) {
  for (const seg of segments) {
    const m = seg.match(DATE_RE);
    if (m) {
      const mon = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
      return `${Number(m[1])} ${mon}`;
    }
  }
  return null;
}

function scan(root) {
  const folders = [];
  const files = [];
  let pending = 0;
  const now = Date.now();

  let top;
  try {
    top = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Tidak bisa membuka folder ${root}: ${e.message}`);
  }

  for (const ent of top) {
    if (ent.isDirectory() && isVocalistFolder(ent.name)) folders.push(ent.name);
  }

  const walk = (dir, segs) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
        walk(full, segs.concat(ent.name));
      } else if (ent.isFile() && /\.wav$/i.test(ent.name)) {
        if (!segs.some(s => s.toLowerCase() === 'mixdown')) continue;
        const m = ent.name.match(NAME_RE);
        if (!m) continue;
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (now - st.mtimeMs < 15000) { pending++; continue; } // masih dirender
        files.push({
          rel_path: segs.concat(ent.name).join('/'),
          file_name: ent.name,
          prefix: m[1].replace(/\s+/g, ' ').trim(),
          title: m[2].replace(/\s+/g, ' ').trim(),
          session_label: sessionLabel(segs),
          file_size: st.size,
          file_mtime: new Date(st.mtimeMs).toISOString(),
        });
      }
    }
  };

  for (const f of folders) walk(path.join(root, f), [f]);
  files.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  return { folders, files, pending };
}

async function push(cfg, snap) {
  const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/sync_files', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: cfg.anonKey,
      Authorization: 'Bearer ' + cfg.anonKey,
    },
    body: JSON.stringify({ p_secret: cfg.syncSecret, p_folders: snap.folders, p_files: snap.files }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return JSON.parse(text);
}

let lastHash = null;
let lastPushAt = 0;
let running = false;
let again = false;

async function runOnce(cfg, reason) {
  if (running) { again = true; return; }
  running = true;
  try {
    const snap = scan(cfg.root);
    const hash = crypto.createHash('sha1').update(JSON.stringify([snap.folders, snap.files])).digest('hex');
    const stale = Date.now() - lastPushAt > 10 * 60 * 1000;
    if (hash !== lastHash || stale) {
      const r = await push(cfg, snap);
      lastHash = hash;
      lastPushAt = Date.now();
      const bits = [`${r.files} file`, `${snap.folders.length} nama`];
      if (r.new_vocalists) bits.push(`${r.new_vocalists} nama baru`);
      if (r.new_songs) bits.push(`${r.new_songs} lagu baru`);
      if (r.newly_missing) bits.push(`${r.newly_missing} file hilang`);
      if (r.unmatched) bits.push(`${r.unmatched} perlu dicek`);
      log(`Sync (${reason}): ${bits.join(', ')}`);
    }
    if (snap.pending) log(`${snap.pending} file masih baru/dirender, dicek lagi nanti`);
  } catch (e) {
    log('GAGAL: ' + e.message);
  } finally {
    running = false;
    if (again) { again = false; setTimeout(() => runOnce(cfg, 'antrian'), 2000); }
  }
}

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes('--once');
  log(`First Club Sync mulai. Folder: ${cfg.root}`);
  await runOnce(cfg, 'awal');
  if (once) return;

  let timer = null;
  try {
    fs.watch(cfg.root, { recursive: true }, (_evt, file) => {
      const f = String(file || '');
      const topLevel = !f.includes(path.sep) && !f.includes('/');
      if (f && !topLevel && !/mixdown/i.test(f)) return; // abaikan Cache, Media, dll.
      clearTimeout(timer);
      timer = setTimeout(() => runOnce(cfg, 'perubahan'), 20000);
    });
  } catch (e) {
    log('Pemantauan langsung tidak tersedia, hanya pakai pengecekan berkala: ' + e.message);
  }
  setInterval(() => runOnce(cfg, 'berkala'), cfg.intervalSeconds * 1000);
}

if (require.main === module) {
  main().catch(e => { log('Berhenti: ' + e.message); process.exit(1); });
}
module.exports = { scan };
