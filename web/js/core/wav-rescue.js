// Segmen CORE — rescue WAV dari audio preview (M4A) lalu upload ke Google Drive.
// Dipakai halaman /rescue.html dan menu admin; melempar Error dengan pesan yang bisa dibaca jika gagal.
import { sb } from '/js/core/supabase.js';

// PCM 16-bit little-endian dari AudioBuffer (stereo/mono sesuai sumber).
export function toWav(ab) {
  const ch = ab.numberOfChannels, rate = ab.sampleRate, n = ab.length;
  const data = n * ch * 2;
  const out = new DataView(new ArrayBuffer(44 + data));
  const str = (o, s) => { for (let i = 0; i < s.length; i++) out.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); out.setUint32(4, 36 + data, true); str(8, 'WAVE');
  str(12, 'fmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true);
  out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true);
  str(36, 'data'); out.setUint32(40, data, true);
  const chans = []; for (let c = 0; c < ch; c++) chans.push(ab.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) {
    const v = Math.max(-1, Math.min(1, chans[c][i]));
    out.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); o += 2;
  }
  return new Blob([out.buffer], { type: 'audio/wav' });
}

/** item: { id (upload id), token (share token vokalis), song_id }. say(text) = callback progres. */
export async function rescueWav(item, say = () => {}) {
  say('Downloading preview audio…');
  const r = await fetch(`/audio/${encodeURIComponent(item.token)}/${item.song_id}`);
  if (!r.ok) throw new Error('preview audio not found (' + r.status + ')');
  const m4a = await r.arrayBuffer();

  say('Converting to WAV…');
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) throw new Error('this browser cannot decode audio');
  let ctx; try { ctx = new Ctx({ sampleRate: 44100 }); } catch (_) { ctx = new Ctx(); }
  let ab;
  try {
    ab = await new Promise((res, rej) => { const p = ctx.decodeAudioData(m4a, res, rej); if (p && p.catch) p.catch(rej); });
  } catch (_) {
    throw new Error('could not decode the preview audio');
  } finally {
    ctx.close?.();
  }
  const wav = toWav(ab);

  say(`Uploading to Google Drive (${(wav.size / 1048576).toFixed(1)} MB)…`);
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('not signed in');
  const up = await fetch(`/admin-wav/${item.id}`, { method: 'POST', headers: { authorization: 'Bearer ' + session.access_token, 'content-type': 'audio/wav' }, body: wav });
  const j = await up.json().catch(() => ({}));
  if (!up.ok || j.ok === false) throw new Error(j.error || 'upload failed (' + up.status + ')');
  return j;
}
