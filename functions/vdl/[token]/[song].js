// UNDUH VOKALIS — /vdl/<tokenVokalis>/<idLagu>
// Vokalis mengunduh WAV lagunya sendiri (cadangan pribadi), selama file masih ada di Drive.
// Tidak mengubah status kirim/unduh FC.
import { UUID_RE, page, rpc, configured, streamDriveFile } from '../../../edge/drive.js';

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return page(405, 'Not allowed', 'This link only downloads files.');
  const token = String(params.token || '');
  const song = String(params.song || '');
  if (!token || token.length > 200 || !UUID_RE.test(song)) return page(404, 'Not found', 'This download link is not valid.');
  if (!configured(env)) return page(503, 'Download not set up yet', 'Please try again later.');
  let info;
  try { info = await rpc('vocalist_download', { p_token: token, p_song: song }); }
  catch (e) {
    if (/link not found/.test(e.message)) return page(404, 'Link not valid', 'This link has changed. Ask the studio for the new link.');
    if (/not available/.test(e.message)) return page(410, 'File not available', 'The WAV for this song is not stored right now. Ask the studio if you need it.');
    return page(502, 'Something went wrong', 'Could not check the file. Please try again in a moment.');
  }
  return streamDriveFile(request, env, info.drive_file_id, info.file_name);
}
