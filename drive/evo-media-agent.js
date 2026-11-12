#!/usr/bin/env node
// Evo Media Agent — mengunggah audio player (M4A) ke Cloudflare R2.
// Butuh Node.js 18 atau lebih baru. Tidak perlu npm install.
//
//   node evo-media-agent.js          jalan terus
//   node evo-media-agent.js --once   cek pengaturan + proses sekali, lalu keluar (exit 1 kalau gagal)
//
// Alur untuk setiap "Nama - Judul.m4a" di folder Mixdown (yang punya pasangan .wav):
//   1. tanya database: lagu mana? (kalau WAV-nya belum tercatat oleh Sync, tunggu)
//   2. unggah ke R2 → cek file di R2 sama persis (ukuran + MD5)
//   3. catat di database → hapus M4A di PC (permanen)
// Gagal di langkah 1-3 → file di PC TIDAK dihapus, dicoba lagi nanti.
// Kalau unggahannya sudah berhasil dan terverifikasi tapi file lokalnya TERKUNCI (Windows
// menahan file yang masih dibuka Studio One), itu BUKAN kegagalan: lagunya sudah aman di R2.
// File lokalnya ditinggal dan dibereskan putaran berikutnya setelah kuncinya dilepas.
// Biasanya dijalankan oleh evo-media-supervisor.js, yang menyalakannya lagi kalau mati.
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const { loadConfig } = require('./lib/config');
const { createR2 } = require('./lib/r2');
const { createDb } = require('./lib/db');
const { scanM4a } = require('./lib/scan');
const { log } = require('./lib/log');
const { createWavWorker } = require('./lib/wav');
const { createJobs } = require('./lib/jobs');
const { createFinalizer, NeedsAdmin } = require('./lib/finalize');
const { createArchiver } = require('./lib/archive');
const { createReconciler } = require('./lib/reconcile');
const { createTranscoder } = require('./lib/transcode');
const { hasToken } = require('./lib/gdrive');

// Dinaikkan setiap kali perilaku agen berubah, supaya halaman System bisa menunjukkan
// komputer mana yang masih memakai kode lama.
const VERSION = '2.4';
const RETRY_S = [30, 60, 300, 900, 1800];
const HEARTBEAT_MS = 60000;

function createAgent(cfg) {
  const r2 = createR2(cfg.r2, cfg.bucket);
  const db = createDb(cfg);
  const wav = createWavWorker(cfg, db);
  const jobs = createJobs(cfg, db.rpc);
  const finalizer = createFinalizer(cfg, jobs, r2);
  const archiver = createArchiver(cfg);
  const reconciler = createReconciler(cfg, db, r2, wav.drive);
  const drive = wav.drive;
  // ffmpeg dicari belakangan, jadi dibungkus fungsi supaya nilainya dibaca saat dipakai.
  const transcoder = createTranscoder(cfg, db, () => ffmpegPath);
  const retry = new Map();   // full path -> { n, at, sig }
  const said = new Map();    // pesan "menunggu" cukup dicatat sekali per file
  const stats = { uploaded: 0, failed: 0, lastError: null, lastUpload: null, waiting: 0, finalized: 0, locked: 0 };
  let running = false;
  let lastBeat = 0;
  let manual = false;   // saklar Manual Finalization (dibaca dari database tiap putaran)

  const sayOnce = (full, sig, msg) => { if (said.get(full) !== sig + msg) { said.set(full, sig + msg); log(msg); } };

  async function handle(f) {
    const sig = `${f.size}:${f.mtimeMs}`;
    const r = retry.get(f.full);
    if (r && r.sig === sig && Date.now() < r.at) return 'later';
    if (!f.wavName) { sayOnce(f.full, sig, `Menunggu: ${f.fileName} belum punya file WAV bernama sama.`); return 'wait'; }

    const t = await db.target(f.relWav);
    if (!t) { sayOnce(f.full, sig, `Menunggu: ${f.wavName} belum tercatat di database (tunggu Sync).`); return 'wait'; }
    if (t.deleted) { sayOnce(f.full, sig, `Dilewati: lagu ${f.wavName} sudah dihapus di admin. M4A dibiarkan.`); return 'wait'; }

    const buf = fs.readFileSync(f.full);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    const key = `m4a/${t.song_id}/${md5}.m4a`;

    const before = await r2.head(key);
    if (!(before && before.etag === md5 && before.size === buf.length)) {
      await r2.put(key, buf, md5, 'audio/mp4');
    }
    const after = await r2.head(key);
    if (!after || after.size !== buf.length || after.etag !== md5) {
      throw new Error('verifikasi gagal: file di R2 tidak sama dengan file di PC');
    }
    const reg = await db.register({ relPath: f.relWav, key, fileName: f.fileName, size: buf.length, md5 });

    // Hapus hanya kalau file tidak berubah sejak dibaca (misalnya sedang dirender ulang).
    const now = fs.statSync(f.full);
    if (now.size !== f.size || now.mtimeMs !== f.mtimeMs) { log(`${f.fileName} berubah saat diunggah; diproses lagi nanti.`); return 'later'; }
    // Sampai sini unggahannya SUDAH berhasil, sudah dicocokkan dengan R2, dan sudah tercatat.
    // Jadi apa pun yang terjadi pada penghapusan file lokal, ini bukan kegagalan lagu.
    stats.uploaded++; stats.lastUpload = new Date().toISOString();
    const mb = (buf.length / 1048576).toFixed(1);
    const rev = reg?.revision ?? t.revision;

    try {
      fs.unlinkSync(f.full);
    } catch (e) {
      // EBUSY/EPERM di Windows: file masih dibuka program lain (biasanya Studio One).
      // Dulu ini dihitung GAGAL, padahal lagunya sudah aman — jadi halaman System
      // menampilkan kegagalan untuk lagu yang sebenarnya tidak apa-apa.
      stats.locked++;
      sayOnce(f.full, sig, `Terunggah: ${f.fileName} (${mb} MB, revisi ${rev}). ` +
        `M4A di komputer belum bisa dihapus (${e.code || e.message}) — biasanya file masih ` +
        `dibuka Studio One. Lagunya sudah aman; filenya dibereskan nanti setelah ditutup.`);
      retry.delete(f.full);
      return 'kept';
    }

    retry.delete(f.full); said.delete(f.full);
    log(`Terunggah: ${f.fileName} (${mb} MB, revisi ${rev}). M4A di PC dihapus.`);
    return 'done';
  }

  /** Pekerjaan dari admin: "Selesaikan & Upload". */
  async function runJobs() {
    let ok = true;
    let list;
    try { list = await jobs.claim(['finalize', 'archive_wav', 'r2_remove', 'drive_remove'], 3); }
    catch (e) { log('GAGAL mengambil pekerjaan: ' + e.message); return false; }
    for (const job of list || []) {
      try {
        if (job.kind === 'archive_wav') {
          const r = await archiver.run(job);
          await jobs.finish(job.id, 'done', r, null);
          continue;
        }
        if (job.kind === 'r2_remove') {
          // Pengaman terakhir: jangan pernah menghapus audio yang ternyata masih dipakai.
          const st = await jobs.progress(job.id, 'removing');
          if (st === 'lost') continue;
          if (st === 'active') { await jobs.finish(job.id, 'done', { skipped: 'version is active' }, null); continue; }
          // Pemusnahan lagu membawa kuncinya sendiri di payload: lagu lama menyimpan audionya
          // di audio_files, jadi kuncinya tidak selalu bisa diturunkan dari versi.
          const key = job.payload?.key || job.m4a_key;
          if (key) await r2.remove(key);
          if (job.payload?.purge) log(`Audio dibuang dari penyimpanan: ${key}`);
          await jobs.finish(job.id, 'done', { removed: key }, null);
          continue;
        }
        if (job.kind === 'drive_remove') {
          const st = await jobs.progress(job.id, 'removing');
          if (st === 'lost') continue;
          const fileId = job.payload?.drive_file_id;
          if (fileId) {
            // trash(), bukan hapus permanen: file tetap bisa diambil dari Trash Google Drive
            // selama 30 hari kalau ternyata salah buang.
            await drive.trash(fileId);
            log(`File WAV dibuang ke Trash Google Drive: ${fileId}`);
          }
          await jobs.finish(job.id, 'done', { trashed: fileId || null }, null);
          continue;
        }
        const res = await finalizer.run(job);
        if (res === 'done') { stats.finalized++; await jobs.finish(job.id, 'done', { key: job.m4a_key }, null); }
        else if (res === 'stale') await jobs.finish(job.id, 'done', { cancelled: true }, null);
        // 'lost' → sewa diambil komputer lain; tidak melapor apa-apa.
      } catch (e) {
        ok = false;
        const admin = e instanceof NeedsAdmin;
        const what = { archive_wav: 'arsip', r2_remove: 'hapus audio', drive_remove: 'hapus file Drive' }[job.kind] || 'finalisasi';
        log(`${admin ? 'PERLU ADMIN' : 'GAGAL'} ${what} "${job.file_name || job.song_id || job.id}": ${e.message}`);
        await jobs.finish(job.id, admin ? 'needs_admin' : 'failed', null, e.message).catch(() => {});
        if (!admin) { stats.failed++; stats.lastError = `${job.file_name}: ${e.message}`; }
      }
    }
    return ok;
  }

  async function runOnce() {
    if (running) return true;
    running = true;
    let ok = true;
    try {
      try { manual = !!(await db.config())?.manual_finalization; }
      catch (e) { log('Pengaturan tidak terbaca, memakai yang terakhir: ' + e.message); }
      // Saklar menyala: M4A tidak lagi diunggah otomatis — hanya lewat tombol admin.
      if (manual) { stats.waiting = 0; throw { __skipAuto: true }; }
      const found = [];
      for (const src of cfg.sources || [{ name: 'pc', root: cfg.root, main: true }]) {
        if (!src.main && !fs.existsSync(src.root)) continue; // drive backup dicabut
        try { found.push(...scanM4a(src.root, src.name).found); }
        catch (e) { ok = false; log(`GAGAL [${src.name}]: ${e.message}`); }
      }
      stats.waiting = 0; stats.locked = 0;
      for (const f of found) {
        try {
          const res = await handle(f);
          if (res === 'wait') stats.waiting++;
        } catch (e) {
          ok = false;
          const sig = `${f.size}:${f.mtimeMs}`;
          const prev = retry.get(f.full);
          const n = prev && prev.sig === sig ? prev.n + 1 : 0;
          const wait = RETRY_S[Math.min(n, RETRY_S.length - 1)];
          retry.set(f.full, { n, at: Date.now() + wait * 1000, sig });
          stats.failed++; stats.lastError = `${f.fileName}: ${e.message}`;
          log(`GAGAL ${f.fileName}: ${e.message}. File di PC tidak dihapus; dicoba lagi dalam ${wait} detik.`);
        }
      }
      for (const k of retry.keys()) if (!found.some((f) => f.full === k)) retry.delete(k);
    } catch (e) {
      if (!e || !e.__skipAuto) {
        ok = false; stats.lastError = e.message;
        log('GAGAL: ' + e.message);
      }
    } finally {
      running = false;
    }
    if (!(await runJobs())) ok = false;
    if (!(await reconciler.runOnce())) ok = false;
    // Membuat M4A untuk lagu yang belum punya audio. Ditaruh setelah pekerjaan lain supaya
    // tidak pernah menunda unggahan atau penghapusan yang sudah mengantre.
    if (!(await transcoder.runOnce())) ok = false;
    if (!(await wav.runOnce())) ok = false;
    if (Date.now() - lastBeat > HEARTBEAT_MS) {
      lastBeat = Date.now();
      db.heartbeat({ version: VERSION, manual, ffmpeg: ffmpegPath, made: transcoder.made, ...stats }).catch((e) => log('Tanda hidup gagal dikirim: ' + e.message));
    }
    return ok;
  }

  /** Cek awal: kunci database & kunci R2 benar. */
  async function check() {
    await db.heartbeat({ version: VERSION, check: true });
    const probe = Buffer.from('evo media agent check ' + new Date().toISOString());
    const md5 = crypto.createHash('md5').update(probe).digest('hex');
    await r2.put('_agent/check.txt', probe, md5, 'text/plain');
    const h = await r2.head('_agent/check.txt');
    if (!h || h.etag !== md5) throw new Error('R2: file uji tidak terbaca kembali');
    if (hasToken()) {
      await wav.check();
      try { await wav.ensureFolders(await db.vocalists()); } catch (e) { log('Folder Drive belum bisa disiapkan: ' + e.message); }
      log('Google Drive terhubung.');
    }
    else log('Google Drive: belum login (upload WAV belum aktif). Jalankan login-google.');
  }

  function watch() {
    let timer = null;
    try {
      fs.watch(cfg.root, { recursive: true }, (_evt, file) => {
        if (!/\.m4a$/i.test(String(file || ''))) return;
        clearTimeout(timer);
        timer = setTimeout(runOnce, 20000);
      }).on('error', (e) => log('Pemantauan langsung berhenti, lanjut pakai pengecekan berkala: ' + e.message));
    } catch (e) {
      log('Pemantauan langsung tidak tersedia, hanya pakai pengecekan berkala: ' + e.message);
    }
    setInterval(runOnce, cfg.intervalSeconds * 1000);
  }

  return { runOnce, check, watch };
}

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes('--once');
  log(`Evo Media Agent ${VERSION} mulai. Folder: ${cfg.root} → R2 bucket ${cfg.bucket}`);
  const agent = createAgent(cfg);
  try {
    await agent.check();
    log('Cek awal OK: database dan R2 terhubung.');
  } catch (e) {
    log('Cek awal GAGAL: ' + e.message);
    if (once) { process.exitCode = 1; return; }
    throw e;
  }
  const ok = await agent.runOnce();
  if (once) { process.exitCode = ok ? 0 : 1; return; }
  agent.watch();
  probeFfmpeg();
  watchSelf();
}

// Apakah komputer ini punya ffmpeg? Dilaporkan di tanda hidup supaya bisa diketahui dari jauh
// tanpa harus menebak, dan supaya pekerjaan yang membutuhkannya tidak pernah dikirim ke
// komputer yang tidak bisa mengerjakannya.
let ffmpegPath = null;
function probeFfmpeg() {
  const { execFileSync } = require('child_process');
  const path = require('path');
  const tries = ['ffmpeg'];
  if (process.platform === 'win32') {
    // winget memasang ffmpeg lalu menaruh pintasannya di folder Links, dan baru menambahkan
    // PATH untuk shell BARU. Agen yang sudah berjalan tidak akan melihatnya, jadi lokasi
    // winget dicari langsung — kalau tidak, ffmpeg yang baru dipasang seolah tidak ada.
    const local = process.env.LOCALAPPDATA || '';
    if (local) {
      tries.push(path.join(local, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
      try {
        const pkgs = path.join(local, 'Microsoft', 'WinGet', 'Packages');
        for (const d of fs.readdirSync(pkgs)) {
          if (!/^Gyan\.FFmpeg/i.test(d)) continue;
          for (const sub of fs.readdirSync(path.join(pkgs, d))) {
            tries.push(path.join(pkgs, d, sub, 'bin', 'ffmpeg.exe'));
          }
        }
      } catch (_) { /* tidak ada folder winget */ }
    }
    tries.push('C:\\ffmpeg\\bin\\ffmpeg.exe', 'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe');
  } else {
    tries.push('/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg');
  }
  for (const t of tries) {
    try {
      const out = execFileSync(t, ['-version'], { encoding: 'utf8', timeout: 8000, windowsHide: true });
      ffmpegPath = t;
      log('ffmpeg ditemukan: ' + t + ' (' + String(out).split('\n')[0].slice(0, 60) + ')');
      return;
    } catch (_) { /* coba yang berikutnya */ }
  }
  log('ffmpeg tidak ditemukan di komputer ini.');
}

// Kalau file program diperbarui (update dari Claude), keluar dengan rapi; penjaga menyalakan lagi
// dengan versi baru dalam beberapa detik. Jadi update tidak perlu restart manual.
function watchSelf() {
  const path = require('path');
  let t = null;
  const bump = (f) => {
    if (!/\.js$/.test(String(f || ''))) return;
    clearTimeout(t);
    t = setTimeout(() => { log('Program diperbarui — menyalakan ulang dengan versi baru.'); process.exit(0); }, 5000);
  };
  for (const d of [__dirname, path.join(__dirname, 'lib')]) {
    try { fs.watch(d, (_e, f) => bump(f)); } catch (_) { /* tidak didukung: update butuh restart manual */ }
  }
}

if (require.main === module) {
  main().catch((e) => { log('Berhenti: ' + e.message); process.exit(1); });
}
module.exports = { createAgent };
