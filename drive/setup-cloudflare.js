#!/usr/bin/env node
// Sekali saja: menyimpan kunci Google ke pengaturan RAHASIA Cloudflare (proyek evo-song-manager),
// supaya halaman unduhan operator FC bisa mengambil WAV dari Google Drive.
// Kunci dibaca dari client_secret.json dan google-token.json di folder ini dan dikirim langsung
// ke Cloudflare lewat Wrangler (alat resmi Cloudflare). Isi kunci tidak ditampilkan di layar.
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PROJECT = 'evo-song-manager';
const WRANGLER = ['--yes', 'wrangler@4'];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function run(args, input) {
  const r = spawnSync(npx, [...WRANGLER, ...args], {
    input, stdio: [input === undefined ? 'inherit' : 'pipe', 'inherit', 'inherit'], shell: process.platform === 'win32',
  });
  return r.status === 0;
}

function main() {
  const dir = __dirname;
  let client, token;
  try { const j = JSON.parse(fs.readFileSync(path.join(dir, 'client_secret.json'), 'utf8')); client = j.installed || j.web || j; }
  catch (_) { throw new Error('client_secret.json tidak ditemukan di folder drive'); }
  try { token = JSON.parse(fs.readFileSync(path.join(dir, 'google-token.json'), 'utf8')); }
  catch (_) { throw new Error('google-token.json belum ada — jalankan login-google.bat dulu'); }
  if (!client.client_id || !client.client_secret || !token.refresh_token) throw new Error('isi file kunci tidak lengkap');

  console.log('1) Login Cloudflare. Browser akan terbuka — login dengan akun evolution.official.id lalu klik Allow.\n');
  if (!run(['login'])) throw new Error('login Cloudflare gagal / dibatalkan');

  const secrets = {
    GOOGLE_CLIENT_ID: client.client_id,
    GOOGLE_CLIENT_SECRET: client.client_secret,
    GOOGLE_REFRESH_TOKEN: token.refresh_token,
  };
  console.log('\n2) Menyimpan kunci ke Cloudflare (proyek ' + PROJECT + ')…');
  for (const [k, v] of Object.entries(secrets)) {
    process.stdout.write(`   - ${k} … `);
    if (!run(['pages', 'secret', 'put', k, '--project-name', PROJECT], v + '\n')) throw new Error(`gagal menyimpan ${k}`);
  }
  console.log('\nBerhasil. Kunci tersimpan di Cloudflare. Kabari Claude supaya situsnya diperbarui.');
}

try { main(); } catch (e) { console.error('\nGAGAL: ' + e.message); process.exit(1); }
