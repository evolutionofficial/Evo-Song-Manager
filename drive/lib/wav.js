'use strict';
// MEDIA — pekerjaan WAV: setelah vokalis menekan Accept, WAV diunggah ke Google Drive
// (Evo Song Manager / Vokalis / Tanggal Accept / file.wav), dicek MD5-nya, lalu dilaporkan.
// Kalau vokalis menekan Revision, file di Drive dihapus. WAV di komputer TIDAK pernah dihapus.
const fs = require('fs');
const path = require('path');
const { createDrive, md5File, hasToken } = require('./gdrive');
const { log } = require('./log');

const ROOT_FOLDER = 'Evo Song Manager';

function createWavWorker(cfg, db) {
  const drive = createDrive();
  const sources = new Map((cfg.sources || []).map((s) => [s.name, s]));
  let warnedLogin = false, running = false;

  function localPath(job) {
    const src = sources.get(job.source);
    if (!src) return null;
    const rel = job.source === 'pc' ? job.rel_path : job.rel_path.slice(job.source.length + 1);
    return path.join(src.root, ...rel.split('/'));
  }

  async function doUpload(job) {
    const file = localPath(job);
    const name = path.basename(file || job.rel_path);
    if (!fs.existsSync(file)) {
      const src = sources.get(job.source);
      const why = src && !src.main && !fs.existsSync(src.root) ? `${src.root} tidak tersambung` : 'file WAV tidak ditemukan di komputer ini';
      throw new Error(why);
    }
    const st = await db.wavReport({ id: job.id, status: 'uploading' });
    if (st === 'cancelled') { log(`WAV ${name}: dibatalkan (Revision) sebelum diunggah.`); return; }

    const md5 = await md5File(file);
    const size = fs.statSync(file).size;
    let f = await drive.findByJob(job.id);
    if (f && f.md5Checksum !== md5) { await drive.remove(f.id); f = null; } // sisa upload lama yang berbeda
    if (!f) {
      const parent = await drive.folderPath([ROOT_FOLDER, job.vocalist, String(job.upload_date)]);
      log(`WAV ${name}: mengunggah ke Drive (${(size / 1048576).toFixed(1)} MB)…`);
      f = await drive.upload(file, name, parent, job.id);
    }
    if (f.md5Checksum !== md5 || Number(f.size) !== size) {
      await drive.remove(f.id).catch(() => {});
      throw new Error('verifikasi gagal: file di Drive tidak sama dengan file di komputer');
    }
    const after = await db.wavReport({ id: job.id, status: 'complete', driveFileId: f.id, size, md5 });
    log(after === 'cancelled'
      ? `WAV ${name}: terunggah, tapi lagunya sudah di-Revision — akan dihapus dari Drive.`
      : `WAV ${name}: siap di Google Drive (${job.vocalist} / ${job.upload_date}).`);
  }

  async function doDelete(job) {
    const gone = await drive.remove(job.drive_file_id);
    await db.wavReport({ id: job.id, status: 'deleted' });
    log(`WAV "${job.title}": ${gone ? 'dihapus dari Drive' : 'sudah tidak ada di Drive'} (Revision).`);
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
          log(`GAGAL WAV "${job.title}": ${e.message}`);
          if (job.action === 'upload') await db.wavReport({ id: job.id, status: 'failed', error: e.message }).catch(() => {});
        }
      }
    } catch (e) {
      ok = false; log('GAGAL (WAV): ' + e.message);
    } finally { running = false; }
    return ok;
  }

  return { runOnce, check: () => drive.token() };
}

module.exports = { createWavWorker };
