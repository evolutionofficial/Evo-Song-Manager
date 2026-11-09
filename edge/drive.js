// EDGE — bagian bersama untuk unduhan WAV dari Google Drive (dipakai /dl dan /vdl).
// Kunci Google ada di pengaturan rahasia Cloudflare (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
// GOOGLE_REFRESH_TOKEN), tidak pernah dikirim ke halaman web.
import { SUPABASE_URL, SUPABASE_KEY } from '../web/js/core/config.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
let cached = { token: null, exp: 0 };

export function page(status, title, msg) {
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0f17;color:#e8eefc;font:16px system-ui,sans-serif">
<div style="max-width:420px;padding:24px;text-align:center"><h2 style="margin:0 0 8px">${title}</h2><p style="color:#9aa7bd;margin:0 0 18px">${msg}</p>
<a href="javascript:history.back()" style="color:#6fb6ff">← Back</a></div></body>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

export async function rpc(name, args) {
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

export const configured = (env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN);

export async function googleToken(env) {
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

/** Alirkan file Drive sebagai unduhan bernama `fileName` (mendukung Range untuk melanjutkan unduhan). */
export async function streamDriveFile(request, env, driveFileId, fileName) {
  let res;
  try {
    const at = await googleToken(env);
    const h = { authorization: 'Bearer ' + at };
    const range = request.headers.get('range');
    if (range) h.range = range;
    res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveFileId)}?alt=media`, { headers: h });
  } catch (_) {
    return page(502, 'Something went wrong', 'Could not reach the file storage. Please try again in a moment.');
  }
  if (res.status === 404) return page(410, 'File no longer available', 'This song is no longer stored. Ask the studio if you still need it.');
  if (!res.ok && res.status !== 206) return page(502, 'Something went wrong', `File storage answered ${res.status}. Please try again in a moment.`);
  const name = String(fileName || 'song.wav');
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
