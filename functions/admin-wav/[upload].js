// DARURAT WAV — POST /admin-wav/<idUpload>   (hanya admin, body = file WAV)
// Dipakai halaman /rescue.html saat komputer pemilik file mati: browser admin membuat WAV dari
// M4A di R2, lalu fungsi ini mengunggahnya ke Google Drive (folder "First Club/<Vokalis>", sama
// seperti Media Agent) dan menandai pekerjaan complete. Setelah itu vokalis bisa Send to FC.
// Hak admin dicek di database (is_admin) memakai token login admin yang diteruskan apa adanya.
import { SUPABASE_URL, SUPABASE_KEY } from '../../web/js/core/config.js';
import { UUID_RE, configured, googleToken } from '../../edge/drive.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const ROOT_FOLDER = 'First Club';
const MAX_BYTES = 95 * 1024 * 1024;

const json = (status, body) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function rpcAs(jwt, name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + jwt },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text; try { msg = JSON.parse(text).message || text; } catch (_) {}
    const e = new Error(msg); e.status = res.status; throw e;
  }
  return text ? JSON.parse(text) : null;
}

const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function folder(at, name, parent) {
  const query = `name = '${q(name)}' and mimeType = 'application/vnd.google-apps.folder' and '${parent || 'root'}' in parents and trashed = false`;
  const r = await fetch(`${API}/files?q=${encodeURIComponent(query)}&fields=files(id)&spaces=drive&pageSize=5`, { headers: { authorization: 'Bearer ' + at } });
  if (!r.ok) throw new Error('Drive search ' + r.status);
  const found = (await r.json()).files || [];
  if (found[0]) return found[0].id;
  const c = await fetch(`${API}/files?fields=id`, {
    method: 'POST', headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: parent ? [parent] : undefined }),
  });
  if (!c.ok) throw new Error('Drive folder ' + c.status);
  return (await c.json()).id;
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'POST') return json(405, { error: 'POST only' });
  const id = String(params.upload || '');
  if (!UUID_RE.test(id)) return json(404, { error: 'bad id' });
  if (!configured(env)) return json(503, { error: 'Google Drive is not connected on the server' });
  const jwt = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'login required' });

  let info;
  try { info = await rpcAs(jwt, 'admin_rescue_info', { p_upload: id }); }
  catch (e) { return json(/not admin|JWT/i.test(e.message) ? 403 : 409, { error: e.message }); }

  const buf = await request.arrayBuffer();
  const size = buf.byteLength;
  if (size < 44 || size > MAX_BYTES) return json(413, { error: `file size ${size} not allowed` });
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, 12));
  if (!head.startsWith('RIFF') || !head.endsWith('WAVE')) return json(400, { error: 'not a WAV file' });

  const base = String(info.rel_path || 'song.wav').split('/').pop().replace(/^mac:/, '');
  const name = `${info.upload_date ? info.upload_date + ' ' : ''}${base}`;

  let file;
  try {
    const at = await googleToken(env);
    const root = await folder(at, ROOT_FOLDER, null);
    const parent = await folder(at, info.vocalist, root);
    const start = await fetch(`${UPLOAD}/files?uploadType=resumable&fields=id,md5Checksum,size`, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + at, 'content-type': 'application/json; charset=UTF-8',
        'x-upload-content-type': 'audio/wav', 'x-upload-content-length': String(size) },
      body: JSON.stringify({ name, parents: [parent], mimeType: 'audio/wav',
        appProperties: { evoUploadId: id, evoRescue: 'm4a' } }),
    });
    if (!start.ok) throw new Error('Drive start ' + start.status + ' ' + (await start.text()).slice(0, 200));
    const session = start.headers.get('location');
    if (!session) throw new Error('Drive gave no upload URL');
    const put = await fetch(session, { method: 'PUT', headers: { 'content-length': String(size) }, body: buf });
    if (!put.ok) throw new Error('Drive upload ' + put.status + ' ' + (await put.text()).slice(0, 200));
    file = await put.json();
  } catch (e) {
    return json(502, { error: e.message });
  }
  if (Number(file.size) !== size) return json(502, { error: `Drive size mismatch (${file.size} vs ${size})` });

  try {
    await rpcAs(jwt, 'admin_rescue_complete', { p_upload: id, p_drive_file_id: file.id, p_size: size, p_md5: file.md5Checksum });
  } catch (e) {
    return json(409, { error: 'uploaded to Drive but status not saved: ' + e.message, drive_file_id: file.id });
  }
  return json(200, { ok: true, drive_file_id: file.id, size, name });
}
