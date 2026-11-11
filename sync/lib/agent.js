'use strict';
// SYNC — Agent: menjadwalkan scan (pemantauan langsung + berkala) dan mengirim hanya bila ada perubahan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scan } = require('./scanner');
const { push, hello } = require('./pusher');
const { createFingerprints } = require('./fingerprint');
const { log } = require('./log');

const REFRESH_MS = 10 * 60 * 1000; // kirim ulang minimal tiap 10 menit (tanda program masih hidup)

function createAgent(cfg) {
  const sources = cfg.sources || [{ name: 'pc', root: cfg.root, archive: false, main: true }];
  const fp = createFingerprints(path.join(__dirname, '..'));
  const last = new Map(); // nama sumber -> { hash, at }
  let said = false;       // sapaan perangkat sudah terkirim
  const offline = new Set(); // sumber tambahan yang sedang tidak tersambung (drive dicabut)
  const seen = new Set();
  let running = false;
  let again = false;

  async function syncSource(src, reason) {
    if (!src.main && !fs.existsSync(src.root)) {
      if (!offline.has(src.name)) { offline.add(src.name); log(`[${src.name}] ${src.root} tidak tersambung — dilewati (lagu-lagunya tidak diubah).`); }
      return;
    }
    if (offline.delete(src.name)) log(`[${src.name}] ${src.root} tersambung lagi.`);
    const snap = scan(src.root);
    if (!src.main) snap.folders = [];
    const fpStat = await fp.fill(snap, src);
    for (const f of snap.files) seen.add(fp.keyOf(src, f.rel_path));
    const hash = crypto.createHash('sha1').update(JSON.stringify([snap.folders, snap.files])).digest('hex');
    const prev = last.get(src.name);
    if (prev && prev.hash === hash && Date.now() - prev.at < REFRESH_MS) {
      if (snap.pending) log(`[${src.name}] ${snap.pending} file masih baru/dirender, dicek lagi nanti`);
      return;
    }
    const r = await push(cfg, snap, src);
    last.set(src.name, { hash, at: Date.now() });
    const bits = [`${r.files} file`];
    if (src.main) bits.push(`${snap.folders.length} nama`);
    if (r.new_vocalists) bits.push(`${r.new_vocalists} nama baru`);
    if (r.new_songs) bits.push(`${r.new_songs} lagu baru`);
    if (r.newly_missing) bits.push(`${r.newly_missing} file hilang`);
    if (r.unmatched) bits.push(`${r.unmatched} perlu dicek`);
    if (fpStat.left) bits.push(`${fpStat.left} isi file belum dibaca`);
    log(`Sync${sources.length > 1 ? ' [' + src.name + ']' : ''} (${reason}): ${bits.join(', ')}`);
    if (snap.pending) log(`[${src.name}] ${snap.pending} file masih baru/dirender, dicek lagi nanti`);
  }

  async function runOnce(reason) {
    if (running) { again = true; return true; }
    running = true;
    let ok = true;
    seen.clear();
    fp.startRun();
    if (!said) {
      try { await hello(cfg); said = true; }
      catch (e) { log('Pendaftaran komputer gagal (dicoba lagi nanti): ' + e.message); }
    }
    try {
      for (const src of sources) {
        try { await syncSource(src, reason); }
        catch (e) { ok = false; log(`GAGAL${sources.length > 1 ? ' [' + src.name + ']' : ''}: ` + e.message); }
      }
    } finally {
      running = false;
      // Catatan sidik jari hanya dibersihkan kalau semua sumber benar-benar terbaca.
      if (ok && sources.every((s) => s.main || fs.existsSync(s.root))) fp.prune(seen);
      fp.save();
      if (again) { again = false; setTimeout(() => runOnce('antrian'), 2000); }
    }
    return ok;
  }

  function watch() {
    let timer = null;
    try {
      fs.watch(cfg.root, { recursive: true }, (_evt, file) => {
        const f = String(file || '');
        const topLevel = !f.includes(path.sep) && !f.includes('/');
        if (f && !topLevel && !/mixdown/i.test(f)) return; // abaikan Cache, Media, dll.
        clearTimeout(timer);
        timer = setTimeout(() => runOnce('perubahan'), 20000);
      }).on('error', (e) => log('Pemantauan langsung berhenti, lanjut pakai pengecekan berkala: ' + e.message));
    } catch (e) {
      log('Pemantauan langsung tidak tersedia, hanya pakai pengecekan berkala: ' + e.message);
    }
    setInterval(() => runOnce('berkala'), cfg.intervalSeconds * 1000);
  }

  return { runOnce, watch };
}

module.exports = { createAgent };
