// TURN — /turn?room=<kode ruang>
//
// Panggilan suara WebRTC menyambung langsung antara dua browser kalau jaringannya mengizinkan.
// Di banyak jaringan seluler tidak bisa (NAT bersama operator), jadi perlu server relay: TURN.
// Kredensialnya berumur pendek dan dibuat di sini, supaya kunci TURN yang panjang umur TIDAK
// pernah sampai ke browser.
//
// Dijaga oleh kode ruang: TURN dibayar per GB, jadi hanya orang yang benar-benar sedang berada
// di ruang menyimak yang boleh mendapatkannya. Tanpa penjagaan ini siapa pun yang menemukan
// alamat /turn bisa memakai kuota Jeffry.
//
// Kalau kunci TURN belum dipasang, endpoint ini TIDAK gagal: ia mengembalikan STUN saja dengan
// relay:false, dan antarmukanya menjelaskan bahwa panggilan mungkin tidak nyambung di data
// seluler. Lebih baik begitu daripada tombol panggil yang mati tanpa keterangan.
import { SUPABASE_URL, SUPABASE_KEY } from '../web/js/core/config.js';

const TTL_S = 4 * 3600;        // seumur ruang menyimak
const ROOM_RE = /^lr_[0-9a-f]{32}$/;
const CACHE_MS = 60_000;
const roomCache = new Map();   // kode -> { live, at }

// STUN publik Cloudflare: tidak perlu kredensial, dan cukup untuk jaringan yang ramah.
const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478'] }];

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function roomIsLive(code) {
  const hit = roomCache.get(code);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.live;
  const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/listen_room_live', {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + SUPABASE_KEY },
    body: JSON.stringify({ p_code: code }),
  });
  if (!res.ok) throw new Error('database ' + res.status);
  const live = (await res.json()) === true;
  roomCache.set(code, { live, at: Date.now() });
  if (roomCache.size > 200) roomCache.delete(roomCache.keys().next().value);
  return live;
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);

  const room = String(new URL(request.url).searchParams.get('room') || '');
  if (!ROOM_RE.test(room)) return json({ error: 'Not found' }, 404);

  let live;
  try { live = await roomIsLive(room); }
  catch (e) { return json({ error: 'Could not check the room' }, 502); }
  if (!live) return json({ error: 'That listening room is not open' }, 404);

  // Belum dipasang kuncinya → tetap jalan, tapi katakan apa adanya.
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
    return json({ iceServers: STUN_ONLY, relay: false, reason: 'no_turn_key' });
  }

  let res;
  try {
    res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(env.TURN_KEY_ID)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.TURN_KEY_API_TOKEN },
        // customIdentifier menandai pemakaian per ruang, supaya pemakaian relay bisa ditelusuri.
        body: JSON.stringify({ ttl: TTL_S, customIdentifier: room }),
      },
    );
  } catch (e) {
    return json({ iceServers: STUN_ONLY, relay: false, reason: 'turn_unreachable' });
  }
  if (!res.ok) return json({ iceServers: STUN_ONLY, relay: false, reason: 'turn_error_' + res.status });

  let data;
  try { data = await res.json(); } catch (e) { return json({ iceServers: STUN_ONLY, relay: false, reason: 'turn_bad_reply' }); }

  const servers = Array.isArray(data?.iceServers) ? data.iceServers : null;
  if (!servers || !servers.length) return json({ iceServers: STUN_ONLY, relay: false, reason: 'turn_empty' });

  // Port 53 diblokir browser dan hanya membuat ICE menunggu sampai kehabisan waktu (saran
  // dokumentasi Cloudflare), jadi dibuang di sini.
  const clean = servers.map((s) => {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => typeof u === 'string' && !/:53(\?|$)/.test(u));
    return { ...s, urls };
  }).filter((s) => s.urls.length);

  const hasRelay = clean.some((s) => s.urls.some((u) => u.startsWith('turn:') || u.startsWith('turns:')));
  return json({ iceServers: clean.length ? clean : STUN_ONLY, relay: hasRelay });
}
