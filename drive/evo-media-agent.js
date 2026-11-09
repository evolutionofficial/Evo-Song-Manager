#!/usr/bin/env node
// Evo Media Agent — mengunggah audio player (M4A) ke Cloudflare R2.
// Butuh Node.js 18 atau lebih baru. Tidak perlu npm install.
//
//   node evo-media-agent.js          jalan terus
//   node evo-media-agent.js --once   cek pengaturan + proses sekali, lalu keluar (exit 1 kalau gagal)
//
// Alur untuk setiap "Nama - Judul.m4a" di folder Mixdown (yang punya pasangan .wav):
//   1. tanya database: lagu mana? (kalau WAV-nya belum tercatat oleh Sync, tunggu)
//   2. unggah ke R2 → cek file di R2 sama persis (ukuran + MD5)
//   3. catat di database → hapus M4A di PC (permanen)
// Gagal di langkah mana pun → file di PC TIDAK dihapus, dicoba lagi nanti.
// Biasanya dijalankan oleh evo-media-supervisor.js, yang menyalakannya lagi kalau mati.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { loadConfig } = require('./lib/config');
const { createR2 } = require('./lib/r2');
const { createDb } = require('./lib/db');
const { scanM4a } = require('./lib/scan');
const { log } = require('./lib/log');

const VERSION = '1.1';
const RETRY_S = [30, 60, 300, 900, 1800];
const HEARTBEAT_MS = 60000;

function createAgent(cfg) {
  const r2 = createR2(cfg.r2, cfg.bucket);
  const db = createDb(cfg);
  const retry = new Map();   // full path -> { n, at, sig }
  const said = new Map();    // pesan "menunggu" cukup dicatat sekali per file
  const stats = { uploaded: 0, failed: 0, lastError: null, lastUpload: null, waiting: 0 };
  let running = false;
  let lastBeat = 0;

  const sayOnce = (full, sig, msg) => { if (said.get(full) !== sig + msg) { said.set(full, sig + msg); log(msg); } };

  async function handle(f) {
    const sig = `${f.size}:${f.mtimeMs}`;
    const r = retry.get(f.full);
    if (r && r.sig === sig && Date.now() < r.at) return 'later';
    if (!f.wavName) { sayOnce(f.full, sig, `Menunggu: ${f.fileName} belum punya file WAV bernama sama.`); return 'wait'; }

    const t = await db.target(f.relWav);
    if (!t) { sayOnce(f.full, sig, `Menunggu: ${f.wavName} belum tercatat di database (tunggu Sync).`); return 'wait'; }
    if (t.deleted) { sayOnce(f.full, sig, `Dilewati: lagu ${f.wavName} sudah dihapus di admin. M4A dibiarkan.`); return 'wait'; }

    const buf = fs.readFileSync(f.full);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const key = `m4a/${t.song_id}/${md5}.m4a`;

    const before = await r2.head(key);
    if (!(before && before.etag === md5 && before.size === buf.length)) {
      await r2.put(key, buf, md5, 'audio/mp4');
    }
    const after = await r2.head(key);
    if (!after || after.size !== buf.length || after.etag !== md5) {
      throw new Error('verifikasi gagal: file di R2 tidak sama dengan file di PC');
    }
    const reg = await db.register({ relPath: f.relWav, key, fileName: f.fileName, size: buf.length, md5 });

    // Hapus hanya kalau file tidak berubah sejak dibaca (misalnya sedang dirender ulang).
    const now = fs.statSync(f.full);
    if (now.size !== f.size || now.mtimeMs !== f.mtimeMs) { log(`${f.fileName} berubah saat diunggah; diproses lagi nanti.`); return 'later'; }
    fs.unlinkSync(f.full);
    retry.delete(f.full); said.delete(f.full);
    stats.uploaded++; stats.lastUpload = new Date().toISOString();
    log(`Terunggah: ${f.fileName} (${(buf.length / 1048576).toFixed(1)} MB, revisi ${reg?.revision ?? t.revision}). M4A di PC dihapus.`);
    return 'done';
  }

  async function runOnce() {
    if (running) return true;
    running = true;
    let ok = true;
    try {
      const found = [];
      for (const src of cfg.sources || [{ name: 'pc', root: cfg.root, main: true }]) {
        if (!src.main && !fs.existsSync(src.root)) continue; // drive backup dicabut
        try { found.push(...scanM4a(src.root, src.name).found); }
        catch (e) { ok = false; log(`GAGAL [${src.name}]: ${e.message}`); }
      }
      stats.waiting = 0;
      for (const f of found) {
        try {
          const res = await handle(f);
          if (res === 'wait') stats.waiting++;
        } catch (e) {
          ok = false;
          const sig = `${f.size}:${f.mtimeMs}`;
          const prev = retry.get(f.full);
          const n = prev && prev.sig === sig ? prev.n + 1 : 0;
          const wait = RETRY_S[Math.min(n, RETRY_S.length - 1)];
          retry.set(f.full, { n, at: Date.now() + wait * 1000, sig });
          stats.failed++; stats.lastError = `${f.fileName}: ${e.message}`;
          log(`GAGAL ${f.fileName}: ${e.message}. File di PC tidak dihapus; dicoba lagi dalam ${wait} detik.`);
        }
      }
      for (const k of retry.keys()) if (!found.some((f) => f.full === k)) retry.delete(k);
    } catch (e) {
      ok = false; stats.lastError = e.message;
      log('GAGAL: ' + e.message);
    } finally {
      running = false;
    }
    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      lastBeat = Date.now();
      db.heartbeat({ version: VERSION, ...stats }).catch((e) => log('Tanda hidup gagal dikirim: ' + e.message));
    }
    return ok;
  }

  /** Cek awal: kunci database & kunci R2 benar. */
  async function check() {
    await db.heartbeat({ version: VERSION, check: true });
    const probe = Buffer.from('evo media agent check ' + new Date().toISOString());
    const md5 = crypto.createHash('md5').update(probe).digest('hex');
    await r2.put('_agent/check.txt', probe, md5, 'text/plain');
    const h = await r2.head('_agent/check.txt');
    if (!h || h.etag !== md5) throw new Error('R2: file uji tidak terbaca kembali');
  }

  function watch() {
    let timer = null;
    try {
      fs.watch(cfg.root, { recursive: true }, (_evt, file) => {
        if (!/\.m4a$/i.test(String(file || ''))) return;
        clearTimeout(timer);
        timer = setTimeout(runOnce, 20000);
      }).on('error', (e) => log('Pemantauan langsung berhenti, lanjut pakai pengecekan berkala: ' + e.message));
    } catch (e) {
      log('Pemantauan langsung tidak tersedia, hanya pakai pengecekan berkala: ' + e.message);
    }
    setInterval(runOnce, cfg.intervalSeconds * 1000);
  }

  return { runOnce, check, watch };
}

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes('--once');
  log(`Evo Media Agent ${VERSION} mulai. Folder: ${cfg.root} → R2 bucket ${cfg.bucket}`);
  const agent = createAgent(cfg);
  try {
    await agent.check();
    log('Cek awal OK: database dan R2 terhubung.');
  } catch (e) {
    log('Cek awal GAGAL: ' + e.message);
    if (once) { process.exitCode = 1; return; }
    throw e;
  }
  const ok = await agent.runOnce();
  if (once) { process.exitCode = ok ? 0 : 1; return; }
  agent.watch();
}

if (require.main === module) {
  main().catch((e) => { log('Berhenti: ' + e.message); process.exit(1); });
}
module.exports = { createAgent };
