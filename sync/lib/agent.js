'use strict';
// SYNC — Agent: menjadwalkan scan (pemantauan langsung + berkala) dan mengirim hanya bila ada perubahan.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { scan } = require('./scanner');
const { push } = require('./pusher');
const { log } = require('./log');

const REFRESH_MS = 10 * 60 * 1000; // kirim ulang minimal tiap 10 menit (tanda program masih hidup)

function createAgent(cfg) {
  let lastHash = null;
  let lastPushAt = 0;
  let running = false;
  let again = false;

  async function runOnce(reason) {
    if (running) { again = true; return true; }
    running = true;
    let ok = true;
    try {
      const snap = scan(cfg.root);
      const hash = crypto.createHash('sha1').update(JSON.stringify([snap.folders, snap.files])).digest('hex');
      if (hash !== lastHash || Date.now() - lastPushAt > REFRESH_MS) {
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
      ok = false;
      log('GAGAL: ' + e.message);
    } finally {
      running = false;
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
