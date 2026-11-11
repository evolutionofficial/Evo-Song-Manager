'use strict';
// MEDIA — memindahkan WAV versi lama ke folder "Cancel Song" setelah vokalis minta revisi.
//
// Aturan yang dijaga ketat di sini, karena ini satu-satunya bagian sistem yang memindahkan
// file milik Jeffry:
//   - Nama file asli dipertahankan. Tidak ada akhiran (2), (3).
//   - TIDAK PERNAH menimpa. Kalau nama itu sudah terpakai oleh isi yang berbeda, file masuk
//     subfolder bertanggal supaya revisi berulang tidak saling menindih.
//   - Isi file dicocokkan dulu dengan sidik jari versinya. Kalau sudah berbeda, artinya ekspor
//     baru sudah menimpa file lama — tidak ada yang perlu diarsipkan, dan itu dilaporkan apa adanya.
//   - Sumber baru dihapus setelah tujuan terbukti ada dengan isi yang sama.
const fs = require('fs');
const path = require('path');
const { hashFile } = require('../../sync/lib/fingerprint');
const { NeedsAdmin } = require('./finalize');
const { log } = require('./log');

const CANCEL_DIR = 'Cancel Song';

/** Folder Mixdown terdekat di atas file ini; kalau tidak ada, folder file itu sendiri. */
function mixdownDir(file) {
  let dir = path.dirname(file);
  const parts = dir.split(path.sep);
  for (let i = parts.length - 1; i >= 0; i--) {
    if (parts[i].toLowerCase() === 'mixdown') return parts.slice(0, i + 1).join(path.sep);
  }
  return dir;
}

function createArchiver(cfg) {
  const sources = new Map((cfg.sources || []).map((s) => [s.name, s]));

  function localPath(job) {
    const src = sources.get(job.source);
    if (!src) throw new NeedsAdmin(`folder sumber "${job.source}" tidak dikenal di komputer ini`);
    const prefix = job.source + ':';
    const rel = job.rel_path.startsWith(prefix) ? job.rel_path.slice(prefix.length) : job.rel_path;
    return path.join(src.root, ...rel.split('/'));
  }

  /** Pindah tanpa kemungkinan menimpa: tautan keras dulu (gagal kalau tujuan ada), lalu salin. */
  function moveNoOverwrite(from, to) {
    try {
      fs.linkSync(from, to);          // gagal dengan EEXIST kalau tujuan sudah ada
      fs.unlinkSync(from);
      return 'link';
    } catch (e) {
      if (e.code === 'EEXIST') throw e;
      // Disk tanpa dukungan tautan keras (exFAT, antar-volume): salin dengan mode "gagal bila ada".
      fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      return 'copy';
    }
  }

  async function run(job) {
    const file = localPath(job);
    if (!fs.existsSync(file)) {
      const src = sources.get(job.source);
      if (src && !src.main && !fs.existsSync(src.root)) throw new Error(`${src.root} tidak tersambung`);
      throw new NeedsAdmin('WAV versi lama tidak ada lagi di komputer ini');
    }
    const h = await hashFile(file);
    if (job.sha256 && h.sha256 !== job.sha256) {
      // Ekspor baru sudah menimpa file lama sebelum sempat diarsipkan. Jangan dipindah:
      // memindahkannya justru akan membuang versi BARU yang baru saja dirender.
      log(`Arsip "${job.file_name}": versi lama sudah tertimpa ekspor baru — tidak dipindah.`);
      return { state: 'overwritten', path: null };
    }

    const dir = path.join(mixdownDir(file), CANCEL_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const name = path.basename(file);
    let dest = path.join(dir, name);

    if (fs.existsSync(dest)) {
      const dh = await hashFile(dest);
      if (dh.sha256 === h.sha256) {
        // Sudah pernah diarsipkan (misalnya agent mati setelah menyalin). Tinggal buang sumbernya.
        fs.unlinkSync(file);
        log(`Arsip "${name}": sudah ada di ${CANCEL_DIR}, sumbernya dibersihkan.`);
        return { state: 'done', path: dest };
      }
      // Nama sama tapi isi berbeda: taruh di subfolder bertanggal supaya tidak ada yang hilang.
      const day = new Date().toISOString().slice(0, 10);
      let n = 2;
      while (fs.existsSync(path.join(dir, `${day} v${n}`, name))) n++;
      const sub = path.join(dir, `${day} v${n}`);
      fs.mkdirSync(sub, { recursive: true });
      dest = path.join(sub, name);
    }

    moveNoOverwrite(file, dest);
    // Verifikasi sebelum menghapus sumber (jalur salin) dan sebelum melapor berhasil.
    const after = await hashFile(dest);
    if (after.sha256 !== h.sha256) throw new Error('verifikasi arsip gagal: isi file di tujuan berbeda');
    if (fs.existsSync(file)) fs.unlinkSync(file);
    log(`Arsip "${name}": dipindahkan ke ${CANCEL_DIR}.`);
    return { state: 'done', path: dest };
  }

  return { run, mixdownDir, CANCEL_DIR };
}

module.exports = { createArchiver, mixdownDir, CANCEL_DIR };
