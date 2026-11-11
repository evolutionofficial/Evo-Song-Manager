'use strict';
// MEDIA — klien Google Drive tanpa library (izin drive.file: hanya file buatan aplikasi ini).
// Kunci: client_secret.json (dari Google Cloud) dan google-token.json (hasil login-google.js).
// Isi kunci tidak pernah ditulis ke log.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = path.join(__dirname, '..');
const CLIENT_PATH = path.join(DIR, 'client_secret.json');
const TOKEN_PATH = path.join(DIR, 'google-token.json');
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const BASE = process.env.EVO_GOOGLE_BASE || 'https://www.googleapis.com'; // diganti hanya saat pengujian
const TOKEN_URL = process.env.EVO_GOOGLE_BASE ? BASE + '/token' : 'https://oauth2.googleapis.com/token';
const API = BASE + '/drive/v3';
const UPLOAD = BASE + '/upload/drive/v3';
const CHUNK = 16 * 1024 * 1024; // kelipatan 256 KB
const TIMEOUT_MS = 120000;

function readClient() {
  let j;
  try { j = JSON.parse(fs.readFileSync(CLIENT_PATH, 'utf8')); }
  catch (e) { throw new Error('client_secret.json tidak ditemukan / rusak di folder drive'); }
  const c = j.installed || j.web || j;
  if (!c.client_id || !c.client_secret) throw new Error('client_secret.json tidak berisi client_id / client_secret');
  return c;
}
const hasToken = () => fs.existsSync(TOKEN_PATH);

async function req(url, opt = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opt.timeout || TIMEOUT_MS);
  try { return await fetch(url, { ...opt, signal: ctrl.signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw new Error('Google tidak menjawab (timeout)');
    throw new Error('tidak bisa terhubung ke Google: ' + (e.cause?.code || e.message));
  } finally { clearTimeout(timer); }
}
async function fail(res, what) {
  const t = await res.text().catch(() => '');
  let msg = t.slice(0, 200);
  try { const j = JSON.parse(t); msg = j.error_description || j.error?.message || j.error || msg; } catch (_) {}
  return new Error(`${what}: HTTP ${res.status} ${msg}`);
}

function createDrive() {
  let access = null, exp = 0;
  const folders = new Map(); // "parentId/nama" -> id

  async function token() {
    if (access && Date.now() < exp - 60000) return access;
    if (!hasToken()) throw new Error('belum login Google — jalankan login-google');
    const c = readClient();
    const { refresh_token } = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
    const res = await req(TOKEN_URL, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: c.client_id, client_secret: c.client_secret, refresh_token, grant_type: 'refresh_token' }),
    });
    if (!res.ok) {
      const e = await fail(res, 'izin Google');
      if (/invalid_grant/.test(e.message)) e.message = 'izin Google sudah tidak berlaku — jalankan login-google lagi';
      throw e;
    }
    const j = await res.json();
    access = j.access_token; exp = Date.now() + (j.expires_in || 3600) * 1000;
    return access;
  }
  const auth = async (h = {}) => ({ ...h, authorization: 'Bearer ' + (await token()) });
  const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

  async function list(query, fields = 'files(id,name,md5Checksum,size)') {
    const u = `${API}/files?q=${encodeURIComponent(query)}&fields=${encodeURIComponent(fields)}&spaces=drive&pageSize=50`;
    const res = await req(u, { headers: await auth() });
    if (!res.ok) throw await fail(res, 'Drive (cari)');
    return (await res.json()).files || [];
  }

  async function folder(name, parent) {
    const k = (parent || 'root') + '/' + name;
    if (folders.has(k)) return folders.get(k);
    const found = await list(`name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${parent || 'root'}' in parents and trashed = false`, 'files(id,name)');
    let id = found[0]?.id;
    if (!id) {
      const res = await req(`${API}/files?fields=id`, {
        method: 'POST', headers: await auth({ 'content-type': 'application/json' }),
        body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }),
      });
      if (!res.ok) throw await fail(res, 'Drive (buat folder)');
      id = (await res.json()).id;
    }
    folders.set(k, id);
    return id;
  }

  /** Folder bertingkat, mis. ['Evo Song Manager', 'Guna', '2026-11-09']. */
  async function folderPath(parts) {
    let parent = null;
    for (const p of parts) parent = await folder(p, parent);
    return parent;
  }

  /** File yang sudah pernah diunggah untuk pekerjaan ini (kalau agent mati di tengah jalan). */
  async function findByJob(jobId) {
    const f = await list(`appProperties has { key='evoUploadId' and value='${q(jobId)}' } and trashed = false`);
    return f[0] || null;
  }

  /** Upload resumable per 16 MB. Mengembalikan { id, md5Checksum, size }. */
  async function upload(file, name, parentId, jobId) {
    const size = fs.statSync(file).size;
    const start = await req(`${UPLOAD}/files?uploadType=resumable&fields=id,md5Checksum,size`, {
      method: 'POST',
      headers: await auth({ 'content-type': 'application/json; charset=UTF-8', 'x-upload-content-type': 'audio/wav', 'x-upload-content-length': String(size) }),
      body: JSON.stringify({ name, parents: [parentId], mimeType: 'audio/wav', appProperties: { evoUploadId: jobId } }),
    });
    if (!start.ok) throw await fail(start, 'Drive (mulai upload)');
    const session = start.headers.get('location');
    if (!session) throw new Error('Drive tidak memberi alamat upload');

    const fd = fs.openSync(file, 'r');
    try {
      let off = 0;
      if (size === 0) throw new Error('file WAV kosong');
      while (off < size) {
        const len = Math.min(CHUNK, size - off);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, off);
        const res = await req(session, {
          method: 'PUT', timeout: 300000,
          headers: await auth({ 'content-length': String(len), 'content-range': `bytes ${off}-${off + len - 1}/${size}` }),
          body: buf,
        });
        if (res.status === 308) {
          const r = res.headers.get('range'); // "bytes=0-N"
          off = r ? Number(r.split('-')[1]) + 1 : off + len;
          continue;
        }
        if (!res.ok) throw await fail(res, 'Drive (upload)');
        return await res.json();
      }
      throw new Error('upload berhenti sebelum selesai');
    } finally { fs.closeSync(fd); }
  }

  /**
   * Pindahkan ke Trash, bukan hapus permanen (keputusan K2): masih bisa dikembalikan 30 hari
   * kalau ternyata salah. Dipakai untuk WAV yang dicabut karena Revision atau batas 40 file.
   */
  async function trash(id) {
    const res = await req(`${API}/files/${encodeURIComponent(id)}?supportsAllDrives=true`, {
      method: 'PATCH',
      headers: { ...(await auth()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ trashed: true }),
    });
    if (res.status === 404) return false; // sudah tidak ada
    if (!res.ok) throw await fail(res, 'Drive (ke Trash)');
    await res.json().catch(() => {});
    return true;
  }

  /** Hapus permanen. Hanya untuk sampah kita sendiri: sisa unggahan yang gagal/terpotong. */
  async function remove(id) {
    const res = await req(`${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE', headers: await auth() });
    if (res.status === 404) return false; // sudah tidak ada
    if (!res.ok && res.status !== 204) throw await fail(res, 'Drive (hapus)');
    return true;
  }

  return { token, folderPath, findByJob, upload, remove, trash };
}

/** MD5 file tanpa memuat seluruh file ke memori. */
function md5File(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('md5');
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

module.exports = { createDrive, md5File, readClient, hasToken, SCOPE, TOKEN_PATH, CLIENT_PATH };
