'use strict';
// MEDIA — pekerjaan WAV: setelah vokalis menekan Accept, WAV diunggah ke Google Drive
// (First Club / Vokalis / "YYYY-MM-DD Vokalis - Judul.wav", tanggal = tanggal Accept supaya urut),
// dicek MD5-nya, lalu dilaporkan.
// Kalau vokalis menekan Revision, file di Drive dihapus. WAV di komputer TIDAK pernah dihapus.
//
// Sejak fase 4: sebelum mengunggah, isi file dicocokkan dengan sidik jari versi yang di-Accept.
// Kalau WAV di komputer ternyata sudah berbeda (dirender ulang setelah Accept), unggahan
// DIBATALKAN dan admin diberi tahu — jauh lebih baik daripada diam-diam mengirim versi yang salah.
const fs = require('fs');
const path = require('path');
const { createDrive, md5File, hasToken } = require('./gdrive');
const { hashFile } = require('../../sync/lib/fingerprint');
const { NeedsAdmin } = require('./finalize');
const { log } = require('./log');

const ROOT_FOLDER = 'First Club';

function createWavWorker(cfg, db) {
  const drive = createDrive();
  const sources = new Map((cfg.sources || []).map((s) => [s.name, s]));
  let warnedLogin = false, running = false;

  function localPath(job, relPath) {
    const src = sources.get(job.source);
    if (!src) return null;
    const rel = relPath || job.rel_path;
    const prefix = job.source + ':';   // sumber selain "pc" memakai awalan di rel_path
    const bare = rel.startsWith(prefix) ? rel.slice(prefix.length) : rel;
    return path.join(src.root, ...bare.split('/'));
  }

  /**
   * File mana yang benar-benar diunggah. Dicari lewat ISI, bukan sekadar nama: kalau file di
   * tempat biasanya hilang atau sudah berbeda, tempat lain dengan isi yang sama tetap diterima.
   */
  async function resolveFile(job) {
    const first = localPath(job);
    const tried = [];
    for (const rel of [job.rel_path, ...(job.alt_paths || [])]) {
      const file = localPath(job, rel);
      if (!file || !fs.existsSync(file)) { tried.push(file || rel); continue; }
      if (!job.expected_sha256) return { file, sha: null };   // lagu lama: tidak ada yang bisa dicocokkan
      const h = await hashFile(file);
      if (h.sha256 === job.expected_sha256) return { file, sha: h.sha256 };
      tried.push(file);
    }
    const src = sources.get(job.source);
    if (src && !src.main && !fs.existsSync(src.root)) {
      throw new Error(`${src.root} tidak tersambung`);       // dicoba lagi nanti, bukan salah admin
    }
    if (!fs.existsSync(first)) {
      throw new NeedsAdmin('file WAV tidak ditemukan di komputer ini');
    }
    throw new NeedsAdmin('WAV di komputer sudah berbeda dari versi yang di-Accept — finalisasi ulang file yang sekarang, lalu minta vokalis Accept lagi');
  }

  async function doUpload(job) {
    const { file } = await resolveFile(job);
    const name = path.basename(job.rel_path);
    const driveName = `${job.upload_date} ${name}`; // nama di Drive diawali tanggal supaya urut
    const st = await db.wavReport({ id: job.id, status: 'uploading' });
    if (st === 'cancelled') { log(`WAV ${name}: dibatalkan (Revision) sebelum diunggah.`); return; }

    const md5 = await md5File(file);
    const size = fs.statSync(file).size;
    let f = await drive.findByJob(job.id);
    if (f && f.md5Checksum !== md5) { await drive.remove(f.id); f = null; } // sisa upload lama yang berbeda
    if (!f) {
      const parent = await drive.folderPath([ROOT_FOLDER, job.vocalist]);
      log(`WAV ${name}: mengunggah ke Drive (${(size / 1048576).toFixed(1)} MB)…`);
      f = await drive.upload(file, driveName, parent, job.id);
    }
    if (f.md5Checksum !== md5 || Number(f.size) !== size) {
      await drive.remove(f.id).catch(() => {});
      throw new Error('verifikasi gagal: file di Drive tidak sama dengan file di komputer');
    }
    const after = await db.wavReport({ id: job.id, status: 'complete', driveFileId: f.id, size, md5 });
    log(after === 'cancelled'
      ? `WAV ${name}: terunggah, tapi lagunya sudah di-Revision — akan dihapus dari Drive.`
      : `WAV ${name}: siap di Google Drive (${ROOT_FOLDER} / ${job.vocalist}).`);
  }

  async function doDelete(job) {
    // Ke Trash, bukan hapus permanen: masih bisa dikembalikan 30 hari kalau ternyata salah.
    const gone = await drive.trash(job.drive_file_id);
    await db.wavReport({ id: job.id, status: 'deleted' });
    log(`WAV "${job.title}": ${gone ? 'dipindahkan ke Trash Google Drive' : 'sudah tidak ada di Drive'} (Revision / batas 40 file per vokalis).`);
  }

  async function runOnce() {
    if (running) return true;
    if (!hasToken()) {
      if (!warnedLogin) { warnedLogin = true; log('Upload WAV belum aktif: belum login Google (jalankan login-google).'); }
      return true;
    }
    running = true;
    let ok = true;
    try {
      const jobs = await db.wavJobs([...sources.keys()]);
      for (const job of jobs) {
        try {
          if (job.action === 'delete') await doDelete(job);
          else await doUpload(job);
        } catch (e) {
          ok = false;
          const admin = e instanceof NeedsAdmin;
          log(`${admin ? 'PERLU ADMIN' : 'GAGAL'} WAV "${job.title}": ${e.message}`);
          if (job.action === 'upload') {
            await db.wavReport({ id: job.id, status: admin ? 'needs_admin' : 'failed', error: e.message }).catch(() => {});
          }
        }
      }
    } catch (e) {
      ok = false; log('GAGAL (WAV): ' + e.message);
    } finally { running = false; }
    return ok;
  }

  /** Siapkan folder First Club / <vokalis> supaya Drive langsung rapi. */
  async function ensureFolders(names) {
    for (const n of names || []) await drive.folderPath([ROOT_FOLDER, n]);
  }

  return { runOnce, check: () => drive.token(), ensureFolders, drive };
}

module.exports = { createWavWorker };
