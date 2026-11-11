'use strict';
// MEDIA — pekerja finalisasi. Berjalan HANYA setelah admin menekan "Selesaikan & Upload".
// Mendeteksi file tidak lagi memicu apa pun.
//
// Tahapan (masing-masing dicatat di database, jadi kalau mati di tengah bisa dilanjutkan):
//   VALIDATE  WAV + M4A ada, ukurannya tidak berubah-ubah, header WAV benar,
//             dan sidik jari keduanya sama persis dengan yang dipilih admin
//   UPLOAD    M4A apa adanya ke R2 (Jeffry merendernya bersama WAV dari Studio One)
//   VERIFY    file di R2 dibaca ulang: ukuran dan MD5 harus sama
//   ACTIVATE  database menjadikannya versi aktif; versi lama jadi "superseded"
//   CLEANUP   M4A di komputer dihapus (salinannya sudah aman di R2)
//
// Kesalahan yang tidak akan sembuh sendiri (file hilang, sidik jari berbeda, M4A tidak ada)
// langsung dilaporkan sebagai "perlu admin", bukan dicoba berulang kali.
const fs = require('fs');
const path = require('path');
const { hashFile } = require('../../sync/lib/fingerprint');
const { log } = require('./log');

const SETTLE_MS = 5000;

/** Kesalahan yang perlu keputusan admin, bukan dicoba lagi. */
class NeedsAdmin extends Error {}

/** Cek sederhana bahwa ini benar-benar file WAV yang utuh, bukan render yang terpotong. */
function checkWavHeader(file, size) {
  const fd = fs.openSync(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(65536, size));
    fs.readSync(fd, head, 0, head.length, 0);
    if (head.length < 44 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') {
      throw new NeedsAdmin('file ini bukan WAV yang benar');
    }
    let off = 12;
    while (off + 8 <= head.length) {
      const id = head.toString('latin1', off, off + 4);
      const len = head.readUInt32LE(off + 4);
      if (id === 'data') {
        if (len === 0) throw new NeedsAdmin('WAV kosong (render belum selesai?)');
        if (off + 8 + len > size) throw new NeedsAdmin('WAV terpotong: isinya lebih pendek dari yang tertulis di header');
        return;
      }
      off += 8 + len + (len % 2);
    }
    // Bagian "data" tidak ketemu di 64 KB pertama: biarkan lewat, sidik jari tetap menjaga isinya.
  } finally { fs.closeSync(fd); }
}

function createFinalizer(cfg, jobs, r2) {
  const sources = new Map((cfg.sources || []).map((s) => [s.name, s]));
  const settle = Number.isFinite(cfg.settleMs) ? cfg.settleMs : SETTLE_MS;

  function localPath(job) {
    const src = sources.get(job.source);
    if (!src) throw new NeedsAdmin(`folder sumber "${job.source}" tidak dikenal di komputer ini`);
    const prefix = job.source + ':';   // sumber selain "pc" memakai awalan di rel_path
    const rel = job.rel_path.startsWith(prefix) ? job.rel_path.slice(prefix.length) : job.rel_path;
    return path.join(src.root, ...rel.split('/'));
  }

  /** Ukuran + waktu ubah harus sama dua kali berturut-turut: file yang sedang ditulis ditolak. */
  async function stable(file, what) {
    let a;
    try { a = fs.statSync(file); } catch (_) { throw new NeedsAdmin(`${what} tidak ada di komputer ini`); }
    await new Promise((r) => setTimeout(r, settle));
    let b;
    try { b = fs.statSync(file); } catch (_) { throw new NeedsAdmin(`${what} hilang saat diperiksa`); }
    if (a.size !== b.size || a.mtimeMs !== b.mtimeMs) throw new Error(`${what} masih berubah (sedang dirender?)`);
    return b;
  }

  async function validate(job) {
    const wav = localPath(job);
    const st = await stable(wav, 'WAV');
    checkWavHeader(wav, st.size);
    const h = await hashFile(wav);
    if (h.sha256 !== job.sha256) {
      throw new NeedsAdmin('WAV di komputer sudah berbeda dari file yang dipilih admin — pilih file yang sekarang lalu finalisasi lagi');
    }
    if (!job.m4a_name) throw new NeedsAdmin('lagu ini tidak punya M4A — render ulang WAV + M4A dari DAW');
    const m4a = path.join(path.dirname(wav), job.m4a_name);
    const mst = await stable(m4a, 'M4A');
    const mh = await hashFile(m4a);
    if (job.m4a_sha256 && mh.sha256 !== job.m4a_sha256) {
      throw new NeedsAdmin('M4A sudah berbeda dari yang dipilih admin — finalisasi ulang dengan file yang sekarang');
    }
    return { m4a, size: mst.size, md5: mh.md5 };
  }

  async function run(job) {
    const say = async (stage) => (await jobs.progress(job.id, stage)) !== 'lost';
    if (!(await say('validating'))) return 'lost';

    const m = await validate(job);
    if (!(await say('validated'))) return 'lost';

    // Sudah ada di R2 dengan isi yang sama (misalnya agent mati setelah unggah) → tidak diulang.
    const before = await r2.head(job.m4a_key);
    if (!(before && before.etag === m.md5 && before.size === m.size)) {
      if (!(await say('uploading'))) return 'lost';
      log(`Finalisasi "${job.file_name}": mengunggah ${job.m4a_name} (${(m.size / 1048576).toFixed(1)} MB)…`);
      await r2.put(job.m4a_key, fs.readFileSync(m.m4a), m.md5, 'audio/mp4');
    }
    const after = await r2.head(job.m4a_key);
    if (!after || after.size !== m.size || after.etag !== m.md5) {
      throw new Error('verifikasi gagal: file di R2 tidak sama dengan file di komputer');
    }
    if (!(await say('verified'))) return 'lost';

    const res = await jobs.activate(job.id, job.m4a_key, m.md5, m.size);
    if (res === 'lost') return 'lost';
    if (res === 'stale') {
      // Dibatalkan admin saat kita mengunggah: buang file yang baru terunggah.
      await r2.remove(job.m4a_key).catch(() => {});
      log(`Finalisasi "${job.file_name}" dibatalkan admin; file yang terlanjur terunggah dihapus.`);
      return 'stale';
    }
    try { fs.unlinkSync(m.m4a); } catch (_) { /* sudah tidak ada: tidak apa-apa */ }
    log(`Siap: "${job.file_name}" sekarang versi aktif; vokalis bisa mendengarkan.`);
    return 'done';
  }

  return { run, NeedsAdmin, checkWavHeader, localPath };
}

module.exports = { createFinalizer, NeedsAdmin };
