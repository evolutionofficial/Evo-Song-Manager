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

  /**
   * Melengkapi snap.files dengan sha256/md5. File yang belum sempat dihitung dibiarkan kosong
   * dan akan diambil pada putaran berikutnya; database menerima file tanpa sidik jari.
   */
  async function fill(snap, src) {
    let fromCache = 0, computed = 0, left = 0;
    for (const f of snap.files) {
      const key = keyOf(src, f.rel_path);
      const hit = cache[key];
      if (fresh(hit, f)) { f.sha256 = hit.sha256; f.md5 = hit.md5; fromCache++; continue; }
      if (budget <= 0) { left++; continue; }
      budget--;
      const full = path.join(src.root, ...f.rel_path.split('/'));
      try {
        const h = await hashFile(full);
        // File yang berubah saat dibaca tidak disimpan; diulang putaran berikutnya.
        const st = fs.statSync(full);
        if (st.size !== f.file_size || new Date(st.mtimeMs).toISOString() !== f.file_mtime) { left++; continue; }
        cache[key] = { size: f.file_size, mtime: f.file_mtime, sha256: h.sha256, md5: h.md5 };
        dirty = true;
        f.sha256 = h.sha256; f.md5 = h.md5;
        computed++;
      } catch (e) {
        left++;
        log(`Sidik jari ${f.file_name} gagal dibaca: ${e.message}`);
      }
      await new Promise((r) => setImmediate(r)); // beri napas ke proses lain
    }
    if (computed && !announced && left) {
      announced = true;
      log('Membaca isi file untuk pertama kali; dicicil beberapa puluh file per putaran.');
    }
    return { fromCache, computed, left };
  }

  /** Buang catatan file yang sudah tidak ada di sumber mana pun (cache tidak menggelembung). */
  function prune(seen) {
    for (const k of Object.keys(cache)) if (!seen.has(k)) { delete cache[k]; dirty = true; }
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
