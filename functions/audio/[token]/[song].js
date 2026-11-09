// STREAMING — /audio/<token>/<songId>
// 1. Tanya database: apakah lagu ini milik pemegang link <token>? Kalau ya, kunci file di R2.
// 2. Alirkan file M4A dari bucket R2 (binding AUDIO) dengan dukungan byte-range,
//    yang wajib untuk Safari/iPhone dan untuk menggeser posisi lagu.
// Tidak ada kunci rahasia di sini: database dicek dengan kunci publik (anon) lewat fungsi
// get_audio_key yang memeriksa token sendiri; akses R2 lewat binding Cloudflare.
import { SUPABASE_URL, SUPABASE_KEY } from '../../../web/js/core/config.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY_TTL_MS = 60_000;
const keyCache = new Map(); // token|song -> { key, at } (per isolate, berumur pendek)

function fail(status, msg) {
  return new Response(msg, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

async function lookupKey(token, song) {
  const ck = token + '|' + song;
  const hit = keyCache.get(ck);
  if (hit && Date.now() - hit.at < KEY_TTL_MS) return hit.key;
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/get_audio_key', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + SUPABASE_KEY },
    body: JSON.stringify({ p_token: token, p_song: song }),
  });
  if (!res.ok) throw new Error('database ' + res.status);
  const key = await res.json(); // string atau null
  keyCache.set(ck, { key, at: Date.now() });
  if (keyCache.size > 500) keyCache.delete(keyCache.keys().next().value);
  return key;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return fail(405, 'Method not allowed');
  const token = String(params.token || '');
  const song = String(params.song || '');
  if (!token || token.length > 200 || !UUID_RE.test(song)) return fail(404, 'Not found');
  if (!env.AUDIO) return fail(503, 'Audio storage is not connected');

  let key;
  try { key = await lookupKey(token, song); } catch (e) { return fail(502, 'Could not check the link'); }
  if (!key) return fail(404, 'No audio for this song');

  let obj;
  try {
    obj = request.method === 'HEAD'
      ? await env.AUDIO.head(key)
      : await env.AUDIO.get(key, { range: request.headers, onlyIf: request.headers });
  } catch (e) {
    return fail(416, 'Range not satisfiable');
  }
  if (!obj) return fail(404, 'Audio file missing');

  const h = new Headers();
  obj.writeHttpMetadata(h);
  if (!h.get('content-type')) h.set('content-type', 'audio/mp4');
  h.set('etag', obj.httpEtag);
  h.set('accept-ranges', 'bytes');
  h.set('cache-control', 'private, max-age=3600');
  h.set('x-content-type-options', 'nosniff');

  if (request.method === 'HEAD') {
    h.set('content-length', String(obj.size));
    return new Response(null, { status: 200, headers: h });
  }
  if (!('body' in obj) || !obj.body) return new Response(null, { status: 304, headers: h }); // If-None-Match cocok

  const size = obj.size;
  const r = obj.range;
  const ranged = request.headers.has('range') && r && (r.offset !== undefined || r.suffix !== undefined);
  if (!ranged) {
    h.set('content-length', String(size));
    return new Response(obj.body, { status: 200, headers: h });
  }
  let start, len;
  if (r.suffix !== undefined) { len = Math.min(r.suffix, size); start = size - len; }
  else { start = r.offset || 0; len = r.length !== undefined ? r.length : size - start; }
  h.set('content-range', `bytes ${start}-${start + len - 1}/${size}`);
  h.set('content-length', String(len));
  return new Response(obj.body, { status: 206, headers: h });
}
