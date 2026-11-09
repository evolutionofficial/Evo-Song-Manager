#!/usr/bin/env node
// Login Google (sekali saja per komputer): memberi izin Evo Media Agent mengunggah WAV ke
// Google Drive akun evolution.official.id. Izin yang diminta: drive.file (hanya file buatan
// aplikasi ini). Hasilnya disimpan di google-token.json — JANGAN dibagikan.
'use strict';
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const { exec } = require('child_process');
const { readClient, SCOPE, TOKEN_PATH } = require('./lib/gdrive');

const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function main() {
  const c = readClient();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(12));

  const server = http.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const redirect = `http://127.0.0.1:${server.address().port}`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.client_id, redirect_uri: redirect, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
    login_hint: 'evolution.official.id@gmail.com',
  });

  console.log('Browser akan terbuka. Login dengan evolution.official.id@gmail.com lalu klik Allow / Izinkan.');
  console.log('Kalau browser tidak terbuka sendiri, salin alamat ini ke browser:\n\n' + url + '\n');
  const open = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(open, () => {});

  const code = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('tidak ada jawaban dalam 10 menit')), 600000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== '/') { res.writeHead(404); return res.end(); }
      const err = u.searchParams.get('error');
      const ok = !err && u.searchParams.get('state') === state && u.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<meta charset="utf-8"><body style="font:16px system-ui;background:#0b0f17;color:#e8eefc;display:grid;place-items:center;height:90vh">
        <div style="text-align:center"><h2>${ok ? '✓ Izin Google tersimpan' : 'Login dibatalkan'}</h2><p>${ok ? 'Tab ini boleh ditutup. Kembali ke jendela program.' : 'Jalankan login-google lagi.'}</p></div></body>`);
      clearTimeout(t);
      if (ok) resolve(u.searchParams.get('code')); else reject(new Error(err || 'jawaban tidak valid'));
    });
  });
  server.close();

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, code, code_verifier: verifier, redirect_uri: redirect, grant_type: 'authorization_code' }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.refresh_token) throw new Error('Google menolak: ' + (j.error_description || j.error || res.status));
  if (j.scope && !j.scope.includes('drive.file')) throw new Error('izin Drive tidak dicentang — ulangi dan centang izin Google Drive');
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ refresh_token: j.refresh_token, scope: j.scope, created: new Date().toISOString() }, null, 2), { mode: 0o600 });
  console.log('\nBerhasil. Izin Google Drive tersimpan. Evo Media Agent akan mulai mengunggah WAV setelah Accept.');
}

if (require.main === module) main().catch((e) => { console.error('\nGAGAL: ' + e.message); process.exit(1); });
