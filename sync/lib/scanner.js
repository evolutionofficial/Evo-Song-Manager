'use strict';
// SYNC — Scanner: membaca D:\FIRST CLUB dan mengenali file "Nama - Judul.wav" di folder Mixdown.
// Hanya membaca disk; tidak tahu apa-apa soal jaringan atau database.
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['cache', 'history', '.git', 'node_modules', '$recycle.bin', 'system volume information']);
const MONTHS = '(jan|januari|feb|februari|mar|maret|apr|april|mei|may|jun|juni|jul|juli|agu|agt|ags|agustus|aug|august|sep|sept|september|okt|oktober|oct|october|nov|november|des|desember|dec|december)';
const DATE_RE = new RegExp('\\b(\\d{1,2})\\s*' + MONTHS + '\\b', 'i');
const NAME_RE = /^\s*([^-]+?)\s*-\s*(.+?)\s*\.wav$/i;
const SETTLE_MS = 15000; // file yang berubah < 15 detik lalu dianggap masih dirender

function isVocalistFolder(name) {
  return !/^[._$]/.test(name);
}

function sessionLabel(segments) {
  for (const seg of segments) {
    const m = seg.match(DATE_RE);
    if (m) {
      const mon = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
      return `${Number(m[1])} ${mon}`;
    }
  }
  return null;
}

function scan(root) {
  const folders = [];
  const files = [];
  let pending = 0;
  const now = Date.now();

  let top;
  try {
    top = fs.readdirSync(root, { withFileTypes: true });
  } catch (e) {
    throw new Error(`Tidak bisa membuka folder ${root}: ${e.message}`);
  }

  for (const ent of top) {
    if (ent.isDirectory() && isVocalistFolder(ent.name)) folders.push(ent.name);
  }

  const walk = (dir, segs) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name.toLowerCase())) continue;
        walk(full, segs.concat(ent.name));
      } else if (ent.isFile() && /\.wav$/i.test(ent.name)) {
        if (!segs.some((s) => s.toLowerCase() === 'mixdown')) continue;
        const m = ent.name.match(NAME_RE);
        if (!m) continue;
        let st;
        try { st = fs.statSync(full); } catch (_) { continue; }
        if (now - st.mtimeMs < SETTLE_MS) { pending++; continue; }
        files.push({
          rel_path: segs.concat(ent.name).join('/'),
          file_name: ent.name,
          prefix: m[1].replace(/\s+/g, ' ').trim(),
          title: m[2].replace(/\s+/g, ' ').trim(),
          session_label: sessionLabel(segs),
          file_size: st.size,
          file_mtime: new Date(st.mtimeMs).toISOString(),
        });
      }
    }
  };

  // Satu folder vokalis yang bermasalah tidak menghentikan yang lain.
  for (const f of folders) {
    try { walk(path.join(root, f), [f]); } catch (_) { /* lewati folder ini */ }
  }
  files.sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  return { folders, files, pending };
}

module.exports = { scan, sessionLabel, isVocalistFolder };
