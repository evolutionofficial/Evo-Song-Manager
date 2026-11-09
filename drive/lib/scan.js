'use strict';
// MEDIA — mencari file "Nama - Judul.m4a" di folder Mixdown yang punya pasangan .wav bernama sama.
const fs = require('fs');
const path = require('path');

const SKIP_DIRS = new Set(['cache', 'history', '.git', 'node_modules', '$recycle.bin', 'system volume information']);
const NAME_RE = /^\s*([^-]+?)\s*-\s*(.+?)\s*\.m4a$/i;
const SETTLE_MS = 15000; // file yang berubah < 15 detik lalu dianggap masih dirender

function scanM4a(root, source = 'pc') {
  const pre = source === 'pc' ? '' : source + ':';
  const found = [];
  let pending = 0;
  const now = Date.now();
  let top;
  try { top = fs.readdirSync(root, { withFileTypes: true }); }
  catch (e) { throw new Error(`Tidak bisa membuka folder ${root}: ${e.message}`); }

  const walk = (dir, segs) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    const names = new Map(entries.filter((e) => e.isFile()).map((e) => [e.name.toLowerCase(), e.name]));
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!SKIP_DIRS.has(ent.name.toLowerCase())) walk(full, segs.concat(ent.name));
        continue;
      }
      if (!ent.isFile() || !NAME_RE.test(ent.name) || ent.name.startsWith('._')) continue;
      if (!segs.some((s) => s.toLowerCase() === 'mixdown')) continue;
      let st;
      try { st = fs.statSync(full); } catch (_) { continue; }
      if (now - st.mtimeMs < SETTLE_MS) { pending++; continue; }
      const wavLower = ent.name.replace(/\.m4a$/i, '.wav').toLowerCase();
      const wavName = names.get(wavLower) || null;
      found.push({
        full,
        fileName: ent.name,
        wavName,
        relWav: pre + segs.concat(wavName || ent.name.replace(/\.m4a$/i, '.wav')).join('/'),
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  };

  for (const ent of top) {
    if (!ent.isDirectory() || /^[._$]/.test(ent.name)) continue;
    try { walk(path.join(root, ent.name), [ent.name]); } catch (_) { /* lewati folder ini */ }
  }
  return { found, pending };
}

module.exports = { scanM4a };
