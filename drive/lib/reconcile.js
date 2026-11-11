'use strict';
// MEDIA — pemeriksaan berkala: apakah file yang TERCATAT ada memang benar-benar masih ada?
//
// Database bisa saja mengatakan sebuah lagu punya audio di R2 dan WAV di Google Drive, padahal
// filenya sudah hilang (terhapus dari luar, gagal yang tidak terdeteksi, dsb). Tanpa pemeriksaan
// ini, hal itu baru ketahuan ketika vokalis menekan tombol dan mendapat kesalahan.
//
// Dua hal yang dijaga di sini:
//   - Dibatasi beberapa berkas per putaran dan hanya tiap 10 menit, supaya tidak membebani R2,
//     Google Drive, maupun koneksi studio. Semua berkas kebagian secara bergilir (yang paling lama
//     tidak diperiksa didahulukan), jadi seluruh katalog tercakup dalam beberapa jam.
//   - "Hilang" hanya dilaporkan kalau layanannya benar-benar menjawab "tidak ada". Kalau jaringan
//     bermasalah, berkas itu DILEWATI, bukan ditandai hilang — menandai file sehat sebagai hilang
//     jauh lebih berbahaya daripada terlambat tahu.
const { log } = require('./log');

const EVERY_MS = 10 * 60 * 1000;
const PER_RUN = 20;

function createReconciler(cfg, db, r2, drive) {
  const device = (cfg.device || {}).id || null;
  let next = 0;

  async function runOnce(force) {
    if (!device) return true;
    if (!force && Date.now() < next) return true;
    next = Date.now() + EVERY_MS;

    let batch;
    try { batch = await db.rpc('claim_verify', { p_device: device, p_limit: PER_RUN }); }
    catch (e) { log('Pemeriksaan berkala dilewati: ' + e.message); return false; }

    const results = [];
    let skipped = 0;

    for (const v of (batch && batch.versions) || []) {
      try {
        const obj = await r2.head(v.key);
        results.push({ kind: 'version', id: v.id, ok: !!obj });
      } catch (_) { skipped++; }   // galat jaringan: jangan simpulkan apa pun
    }
    for (const u of (batch && batch.uploads) || []) {
      try {
        const f = await drive.info(u.drive_file_id);
        results.push({ kind: 'upload', id: u.id, ok: !!f });
      } catch (_) { skipped++; }
    }

    if (!results.length) return true;
    try {
      const r = await db.rpc('verify_report', { p_device: device, p_results: results });
      if (r && r.missing) {
        log(`Pemeriksaan berkala: ${r.missing} berkas tercatat ada tapi ternyata hilang — lihat halaman System di admin.`);
      }
    } catch (e) { log('Hasil pemeriksaan gagal dikirim: ' + e.message); return false; }
    if (skipped) log(`Pemeriksaan berkala: ${skipped} berkas dilewati karena layanannya sedang tidak bisa dihubungi.`);
    return true;
  }

  return { runOnce, EVERY_MS, PER_RUN };
}

module.exports = { createReconciler };
