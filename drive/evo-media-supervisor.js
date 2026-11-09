#!/usr/bin/env node
// Evo Media Supervisor — penjaga: menjalankan evo-media-agent.js dan menyalakannya lagi kalau mati.
// Jeda sebelum menyala lagi bertambah (2 dtk → 5 → 15 → 60 → 300) kalau terus-terusan mati,
// dan kembali ke 2 detik setelah program berjalan normal lebih dari 5 menit.
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./lib/log');

const CHILD = path.join(__dirname, 'evo-media-agent.js');
const PID_FILE = path.join(__dirname, 'supervisor.pid');
const BACKOFF = [2, 5, 15, 60, 300];
const HEALTHY_MS = 5 * 60 * 1000;

function alreadyRunning() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8'));
    if (pid && pid !== process.pid) { process.kill(pid, 0); return pid; }
  } catch (_) { /* tidak ada / sudah mati */ }
  return 0;
}

const other = alreadyRunning();
if (other) {
  log(`Penjaga sudah berjalan (PID ${other}); yang ini berhenti.`, 'penjaga');
  process.exit(0);
}
fs.writeFileSync(PID_FILE, String(process.pid));

let child = null;
let failures = 0;
let stopping = false;

function startChild() {
  const startedAt = Date.now();
  child = spawn(process.execPath, [CHILD], { cwd: __dirname, stdio: 'ignore', windowsHide: true });
  child.on('exit', (code, signal) => {
    child = null;
    if (stopping) return;
    if (Date.now() - startedAt > HEALTHY_MS) failures = 0;
    const wait = BACKOFF[Math.min(failures, BACKOFF.length - 1)];
    failures++;
    log(`Media Agent berhenti (kode ${code ?? signal}). Dinyalakan lagi dalam ${wait} detik.`, 'penjaga');
    setTimeout(startChild, wait * 1000);
  });
  child.on('error', (e) => log('Gagal menjalankan Media Agent: ' + e.message, 'penjaga'));
}

function stop() {
  stopping = true;
  try { if (child) child.kill(); } catch (_) {}
  try { if (Number(fs.readFileSync(PID_FILE, 'utf8')) === process.pid) fs.unlinkSync(PID_FILE); } catch (_) {}
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

log('Penjaga mulai.', 'penjaga');
startChild();
