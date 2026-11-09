// UNDUH — /dl/<tokenOperator>/<idUpload>
// Mengambil WAV langsung dari Google Drive (akun evolution.official.id) dan mengirimkannya ke
// operator sebagai unduhan bernama "Vokalis - Judul.wav". Operator tidak pernah melihat Drive,
// file di Drive tetap privat.
// Kunci Google ada di pengaturan rahasia Cloudflare (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN), tidak pernah dikirim ke halaman web.
// Unduhan pertama sebuah lagu juga memicu pembersihan: WAV lama vokalis yang sama (tanggal lebih
// awal) dihapus dari Drive (aturan opsi B).
import { SUPABASE_URL, SUPABASE_KEY } from '../../../web/js/core/config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let cached = { token: null, exp: 0 };

function page(status, title, msg) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e8eefc;font:16px system-ui,sans-serif">
<div style="max-width:420px;padding:24px;text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#9aa7bd;margin:0 0 18px">${msg}</p>
<a href="javascript:history.back()" style="color:#6fb6ff">← Back</a></div></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

async function rpc(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + SUPABASE_KEY },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return text ? JSON.parse(text) : null;
}

async function googleToken(env) {
  if (cached.token && Date.now() < cached.exp - 60000) return cached.token;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN, grant_type: 'refresh_token' }),
  });
  if (!res.ok) throw new Error('google token ' + res.status);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in || 3600) * 1000 };
  return cached.token;
}

async function cleanup(env, token, list) {
  if (!list || !list.length) return;
  const done = [];
  const at = await googleToken(env);
  for (const f of list) {
    try {
      const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.drive_file_id)}`, {
        method: 'DELETE', headers: { authorization: 'Bearer ' + at },
      });
      if (r.ok || r.status === 404) done.push(f.id); // 404 = sudah tidak ada
    } catch (_) { /* dicoba lagi oleh program di PC/Mac */ }
  }
  if (done.length) await rpc('cleanup_done', { p_token: token, p_ids: done });
}

export async function onRequest({ request, env, params, waitUntil }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return page(405, 'Not allowed', 'This link only downloads files.');
  const token = String(params.token || '');
  const id = String(params.id || '');
  if (!token || token.length > 200 || !UUID_RE.test(id)) return page(404, 'Not found', 'This download link is not valid.');
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    return page(503, 'Download not set up yet', 'The studio has not finished connecting the download service. Please try again later.');
  }

  let info;
  try { info = await rpc('operator_download', { p_token: token, p_upload: id }); }
  catch (e) {
    if (/link not found/.test(e.message)) return page(404, 'Link not valid', 'This page link has changed. Ask the studio for the new link.');
    if (/not available/.test(e.message)) return page(410, 'File no longer available', 'This song has been replaced or cleaned up. Ask the studio if you still need it.');
    return page(502, 'Something went wrong', 'Could not check the file. Please try again in a moment.');
  }

  let res;
  try {
    const at = await googleToken(env);
    const h = { authorization: 'Bearer ' + at };
    const range = request.headers.get('range');
    if (range) h.range = range;
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(info.drive_file_id)}?alt=media`, { headers: h });
  } catch (_) {
    return page(502, 'Something went wrong', 'Could not reach the file storage. Please try again in a moment.');
  }
  if (res.status === 404) return page(410, 'File no longer available', 'This song is no longer stored. Ask the studio if you still need it.');
  if (!res.ok && res.status !== 206) return page(502, 'Something went wrong', `File storage answered ${res.status}. Please try again in a moment.`);

  if (info.cleanup && info.cleanup.length) waitUntil(cleanup(env, token, info.cleanup).catch(() => {}));

  const name = String(info.file_name || 'song.wav');
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  const out = new Headers({
    'content-type': 'audio/wav',
    'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'accept-ranges': 'bytes',
    'cache-control': 'private, no-store',
    'x-content-type-options': 'nosniff',
  });
  for (const k of ['content-length', 'content-range']) { const v = res.headers.get(k); if (v) out.set(k, v); }
  return new Response(request.method === 'HEAD' ? null : res.body, { status: res.status, headers: out });
}
