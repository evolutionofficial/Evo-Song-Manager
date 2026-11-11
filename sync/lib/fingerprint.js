'use strict';
// SYNC — sidik jari isi file: SHA-256 (identitas versi) dan MD5 (verifikasi R2 & Google Drive).
// Dihitung sambil mengalir supaya file besar tidak dimuat ke memori, dan disimpan di
// fingerprints.json supaya file yang tidak berubah tidak dibaca ulang setiap pemindaian.
// Dibatasi beberapa file per putaran supaya pemindaian pertama (ratusan file) tidak mengganggu DAW.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { log } = require('./log');

const CACHE_NAME = 'fingerprints.json';
const MAX_NEW_PER_RUN = 40;   // file baru yang dihitung per putaran
const CHUNK = 1 << 20;

/** SHA-256 + MD5 dalam satu kali baca file. */
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const sha = crypto.createHash('sha256');
    const md5 = crypto.createHash('md5');
    const rs = fs.createReadStream(file, { highWaterMark: CHUNK });
    rs.on('error', reject);
    rs.on('data', (b) => { sha.update(b); md5.update(b); });
    rs.on('end', () => resolve({ sha256: sha.digest('hex'), md5: md5.digest('hex') }));
  });
}

function createFingerprints(dir) {
  const file = path.join(dir, CACHE_NAME);
  let cache = {};
  let dirty = false;
  let budget = MAX_NEW_PER_RUN;
  let announced = false;

  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && raw.version === 1 && raw.files) cache = raw.files;
  } catch (_) { /* belum ada / rusak → hitung ulang seperlunya */ }

  const keyOf = (src, rel) => `${src.name}:${rel}`;
  // Cache hanya dipakai kalau ukuran dan waktu ubah file sama persis.
  const fresh = (e, f) => e && e.size === f.file_size && e.mtime === f.file_mtime && e.sha256 && e.md5;

  function save() {
    if (!dirty) return;
    try {
      fs.writeFileSync(file, JSON.stringify({ version: 1, files: cache }));
      dirty = false;
    } catch (e) { log('Catatan sidik jari tidak bisa disimpan: ' + e.message); }
  }

  /** Satu file: pakai cache kalau ukuran+waktu sama, kalau tidak hitung (selama jatah cukup). */
  async function one(key, full, size, mtime, label) {
    const hit = cache[key];
    if (hit && hit.size === size && hit.mtime === mtime && hit.sha256 && hit.md5) return { hit: true, h: hit };
    if (budget <= 0) return { later: true };
    budget--;
    try {
      const h = await hashFile(full);
      const st = fs.statSync(full);
      // Berubah saat dibaca (sedang dirender ulang) → jangan disimpan; diulang putaran berikutnya.
      if (st.size !== size || new Date(st.mtimeMs).toISOString() !== mtime) return { later: true };
      cache[key] = { size, mtime, sha256: h.sha256, md5: h.md5 };
      dirty = true;
      return { h };
    } catch (e) {
      log(`Sidik jari ${label} gagal dibaca: ${e.message}`);
      return { later: true };
    } finally {
      await new Promise((r) => setImmediate(r)); // beri napas ke proses lain
    }
  }

  /**
   * Melengkapi snap.files dengan sha256/md5 (WAV dan M4A pasangannya). File yang belum sempat
   * dihitung dibiarkan kosong dan diambil putaran berikutnya; database menerima file tanpa sidik jari.
   */
  async function fill(snap, src) {
    let fromCache = 0, computed = 0, left = 0;
    for (const f of snap.files) {
      const key = keyOf(src, f.rel_path);
      const full = path.join(src.root, ...f.rel_path.split('/'));
      const r = await one(key, full, f.file_size, f.file_mtime, f.file_name);
      if (r.later) { left++; continue; }
      f.sha256 = r.h.sha256; f.md5 = r.h.md5;
      r.hit ? fromCache++ : computed++;

      // M4A pasangannya (kecil, jadi murah). Tanpa ini lagu tidak bisa difinalisasi.
      if (!f.m4a_name) continue;
      const mFull = path.join(path.dirname(full), f.m4a_name);
      const mr = await one(key + '#m4a', mFull, f.m4a_size, f.m4a_mtime, f.m4a_name);
      if (mr.later) { left++; continue; }
      f.m4a_sha256 = mr.h.sha256; f.m4a_md5 = mr.h.md5;
      if (!mr.hit) computed++;
    }
    if (computed && !announced && left) {
      announced = true;
      log('Membaca isi file untuk pertama kali; dicicil beberapa puluh file per putaran.');
    }
    return { fromCache, computed, left };
  }

  /** Buang catatan file yang sudah tidak ada di sumber mana pun (cache tidak menggelembung). */
  function prune(seen) {
    for (const k of Object.keys(cache)) {
      if (!seen.has(k.replace(/#m4a$/, ''))) { delete cache[k]; dirty = true; }
    }
  }

  return {
    startRun() { budget = MAX_NEW_PER_RUN; },
    fill,
    prune,
    save,
    keyOf,
  };
}

module.exports = { createFingerprints, hashFile };
