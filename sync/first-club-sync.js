#!/usr/bin/env node
// First Club Sync — memantau D:\FIRST CLUB dan mengirim daftar file Mixdown ke database.
// Butuh Node.js 18 atau lebih baru. Tidak perlu npm install.
//
//   node first-club-sync.js          jalan terus (pemantauan + berkala)
//   node first-club-sync.js --once   sync sekali lalu keluar (exit 1 kalau gagal)
//
// Biasanya dijalankan oleh first-club-supervisor.js, yang menyalakannya lagi kalau mati.
'use strict';

const { loadConfig } = require('./lib/config');
const { createAgent } = require('./lib/agent');
const { scan } = require('./lib/scanner');
const { log } = require('./lib/log');

async function main() {
  const cfg = loadConfig();
  const once = process.argv.includes('--once');
  log(`First Club Sync mulai. ${cfg.sources.map((x) => `[${x.name}${x.archive ? ', arsip' : ''}] ${x.root}`).join(' · ')}`);
  const agent = createAgent(cfg);
  const ok = await agent.runOnce('awal');
  if (once) { process.exitCode = ok ? 0 : 1; return; }
  agent.watch();
}

if (require.main === module) {
  main().catch((e) => { log('Berhenti: ' + e.message); process.exit(1); });
}
module.exports = { scan };
