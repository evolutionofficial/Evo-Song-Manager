'use strict';
// MEDIA — membuat M4A untuk lagu yang WAV-nya ada tapi belum punya audio untuk didengar.
//
// 126 lagu tidak punya audio sama sekali (Cia seluruhnya, Keket dua pertiga), padahal WAV-nya
// masih ada di komputer. Dulu M4A dibuat Jeffry sendiri saat merender di Studio One; untuk
// lagu-lagu lama itu tidak pernah terjadi. Jadi di sini M4A-nya dibuat dari WAV-nya.
//
// Yang dibuat hanya FILE M4A di sebelah WAV-nya. Unggahan ke R2 tetap lewat jalur yang sudah
// ada dan sudah teruji: pemindai menemukan M4A baru itu, mengunggahnya, mencocokkan MD5-nya,
// mencatatnya, lalu menghapus file sementaranya. Tidak ada jalur unggah kedua.
//
// Aturan yang dipegang:
//   - WAV TIDAK PERNAH disentuh. Itu sumber aslinya.
//   - M4A yang sudah ada TIDAK PERNAH ditimpa.
//   - Lagu yang sudah punya audio tidak pernah masuk daftar (database yang menyaring).
//   - Hasil ditulis ke berkas sementara lalu baru diganti namanya, supaya pemindai tidak
//     pernah menemukan M4A yang masih setengah jadi dan mengunggah file rusak.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { log } = require('./log');

const PER_RUN = 3;              // beberapa saja per putaran, supaya tidak memberatkan saat dipakai kerja
const RENAME_TRIES = 6;         // Windows sering menahan file yang baru ditulis selama sedetik-dua
const TIMEOUT_MS = 10 * 60_000; // lagu terpanjang pun jauh di bawah ini
const BITRATE = '192k';         // AAC stereo; untuk trek latihan ini sudah lebih dari cukup

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Ganti nama dengan beberapa kali percobaan.
 *
 * Di Windows, file yang BARU SAJA ditulis sering masih dipegang pemindai antivirus, dan rename
 * langsung gagal dengan EBUSY. Ini terjadi terus di drive backup G: dan memblokir konversinya.
 * Penantiannya bertambah (100 ms, 200, 400, …) karena tahanan itu hampir selalu lepas dalam
 * satu-dua detik.
 */
async function renameWithRetry(from, to) {
  let wait = 100;
  for (let i = 1; i <= RENAME_TRIES; i++) {
    try { fs.renameSync(from, to); return; }
    catch (e) {
      if (i === RENAME_TRIES || !['EBUSY', 'EPERM', 'EACCES'].includes(e.code)) throw e;
      await sleep(wait);
      wait *= 2;
    }
  }
}

function createTranscoder(cfg, db, ffmpeg) {
  const sources = new Map((cfg.sources || []).map((s) => [s.name, s]));
  let saidNoFfmpeg = false;
  let done = 0;

  /** Jalur file WAV yang sebenarnya di komputer ini. */
  function localPath(it) {
    const src = sources.get(it.source);
    if (!src) return null;
    const prefix = it.source + ':';
    const bare = it.rel_path.startsWith(prefix) ? it.rel_path.slice(prefix.length) : it.rel_path;
    return path.join(src.root, ...bare.split('/'));
  }

  function encode(wav, out) {
    return new Promise((resolve, reject) => {
      execFile(ffmpeg(), [
        '-nostdin', '-hide_banner', '-loglevel', 'error',
        '-y', '-i', wav,
        '-vn',                       // buang gambar/sampul kalau ada
        '-c:a', 'aac', '-b:a', BITRATE,
        '-movflags', '+faststart',   // bisa mulai diputar sebelum terunduh penuh
        // Formatnya disebut eksplisit. Hasilnya ditulis ke berkas berakhiran .part, dan dari
        // ekstensi itu ffmpeg tidak bisa menebak harus membuat M4A — tanpa baris ini setiap
        // konversi gagal dengan "Unable to choose an output format".
        '-f', 'ipod',
        out,
      ], { timeout: TIMEOUT_MS, windowsHide: true }, (err, _so, se) => {
        if (err) return reject(new Error(String(se || err.message).trim().slice(0, 200)));
        resolve();
      });
    });
  }

  async function runOnce() {
    const bin = ffmpeg();
    if (!bin) {
      if (!saidNoFfmpeg) {
        saidNoFfmpeg = true;
        log('Lagu tanpa audio tidak bisa dibuatkan M4A: ffmpeg belum ada di komputer ini.');
      }
      return true;
    }
    saidNoFfmpeg = false;

    // Hanya sumber folder yang benar-benar tersambung. Drive backup bisa dicabut, dan
    // menanyakan lagu di drive yang tidak ada hanya akan menghasilkan kegagalan beruntun.
    const live = (cfg.sources || []).filter((s) => { try { return fs.existsSync(s.root); } catch (_) { return false; } });
    if (!live.length) return true;

    let list;
    try { list = await db.audioNeeded(live.map((s) => s.name), PER_RUN * 5); }
    catch (e) { log('Daftar lagu tanpa audio gagal diambil: ' + e.message); return false; }
    if (!list || !list.length) return true;

    let made = 0;
    for (const it of list) {
      if (made >= PER_RUN) break;
      const wav = localPath(it);
      if (!wav || !fs.existsSync(wav)) continue;

      const m4a = wav.replace(/\.wav$/i, '.m4a');
      if (fs.existsSync(m4a)) continue;        // sudah ada — jalur unggah akan mengambilnya sendiri

      const tmp = m4a + '.part';
      // Sisa percobaan sebelumnya. Kalau tidak bisa dibuang (masih dipegang), lagu ini
      // dilewati dulu — memaksa hanya akan gagal lagi di langkah yang sama.
      if (fs.existsSync(tmp)) {
        try { fs.unlinkSync(tmp); }
        catch (_) { continue; }
      }
      try {
        await encode(wav, tmp);
        const st = fs.statSync(tmp);
        if (!st.size) throw new Error('hasilnya kosong');
        // Baru sekarang namanya menjadi .m4a, jadi pemindai tidak pernah melihat file separuh jadi.
        await renameWithRetry(tmp, m4a);
        made++; done++;
        log(`M4A dibuat dari WAV: ${it.vocalist} — ${it.title} (${(st.size / 1048576).toFixed(1)} MB). Total ${done}.`);
      } catch (e) {
        try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
        log(`GAGAL membuat M4A untuk "${it.title}": ${e.message}`);
      }
    }
    return true;
  }

  return { runOnce, get made() { return done; } };
}

module.exports = { createTranscoder, PER_RUN, BITRATE };
