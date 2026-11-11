// UNDUH OPERATOR — /dl/<tokenOperator>/<idUpload>
// WAV diambil langsung dari Google Drive dan dikirim sebagai unduhan "Vokalis - Judul.wav".
// Operator tidak pernah melihat Drive; file di Drive tetap privat.
// Setelah diunduh, lagu pindah ke folder vokalisnya di halaman operator (filenya tetap di Drive).
import { UUID_RE, page, rpc, configured, streamDriveFile } from '../../../edge/drive.js';

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return page(405, 'Not allowed', 'This link only downloads files.');
  const token = String(params.token || '');
  const id = String(params.id || '');
  if (!token || token.length > 200 || !UUID_RE.test(id)) return page(404, 'Not found', 'This download link is not valid.');
  if (!configured(env)) return page(503, 'Download not set up yet', 'The studio has not finished connecting the download service. Please try again later.');
  let info;
  try { info = await rpc('operator_download', { p_token: token, p_upload: id }); }
  catch (e) {
    if (/link not found/.test(e.message)) return page(404, 'Link not valid', 'This page link has changed. Ask the studio for the new link.');
    if (/not available/.test(e.message)) return page(410, 'File no longer available', 'This song has been replaced or cleaned up. Ask the studio if you still need it.');
    return page(502, 'Something went wrong', 'Could not check the file. Please try again in a moment.');
  }
  return streamDriveFile(request, env, info.drive_file_id, info.file_name);
}
