// Segmen CORE — notifikasi panggilan (Web Push). Dipakai panel Meeting di halaman admin dan vokalis.
//
// Pengirimnya Edge Function `ring` di Supabase (supabase/functions/ring). Modul ini hanya:
// mendaftarkan perangkat ini, mencabutnya lagi, dan meminta fungsi itu mendering lawan bicara.
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const FN = SUPABASE_URL + '/functions/v1/ring';

const ua = () => navigator.userAgent || '';
const isIOS = () => /iPad|iPhone|iPod/.test(ua()) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => !!(window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true);
export const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/**
 * Keadaan perangkat ini:
 *  'unsupported' — peramban tidak bisa menerima push
 *  'install'     — iPhone/iPad: harus dipasang ke Layar Utama dulu (aturan Apple)
 *  'denied'      — izin ditolak di pengaturan peramban
 *  'off' | 'on'
 */
export async function status() {
  if (isIOS() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    return sub && Notification.permission === 'granted' ? 'on' : 'off';
  } catch (_) { return 'off'; }
}

const toBytes = (b64u) => {
  const p = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4);
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0));
};
const sameKey = (sub, b64u) => {
  const k = sub.options?.applicationServerKey;
  if (!k) return false;
  const a = new Uint8Array(k), b = toBytes(b64u);
  return a.length === b.length && a.every((x, i) => x === b[i]);
};

async function call(body, jwt) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + (jwt || SUPABASE_KEY) },
    body: JSON.stringify(body),
    keepalive: true,
  });
  if (!res.ok) throw new Error('ring ' + res.status);
  return res.json();
}

async function sessionJwt() {
  const { sb } = await import('/js/core/supabase.js');
  const { data } = await sb.auth.getSession();
  return data?.session?.access_token || null;
}

/** Daftarkan perangkat ini. HARUS dipanggil dari klik (izin notifikasi hanya boleh diminta oleh tindakan orang). */
export async function enable({ token = '' } = {}) {
  if (isIOS() && !standalone()) return 'install';
  if (!supported()) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  await navigator.serviceWorker.ready;
  const { key } = await call({ action: 'key' });

  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(key) });

  await save(sub, token);
  return 'on';
}

async function save(sub, token) {
  const j = sub.toJSON();
  const { sb } = await import('/js/core/supabase.js');
  const { error } = await sb.rpc('push_subscribe', {
    p_token: token || '', p_endpoint: j.endpoint, p_p256dh: j.keys?.p256dh, p_auth: j.keys?.auth, p_ua: ua().slice(0, 300),
  });
  if (error) throw error;
}

/** Perangkat yang sudah berlangganan memperbarui catatannya (alamat push kadang berganti sendiri). */
export async function resync({ token = '' } = {}) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    const sub = await reg?.pushManager.getSubscription();
    if (sub && Notification.permission === 'granted') await save(sub, token);
  } catch (_) { /* tidak penting: dicoba lagi lain kali */ }
}

export async function disable({ token = '' } = {}) {
  const reg = await navigator.serviceWorker.getRegistration('/');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return 'off';
  const { sb } = await import('/js/core/supabase.js');
  await sb.rpc('push_unsubscribe', { p_token: token || '', p_endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
  return 'off';
}

/**
 * Dering lawan bicara. Dipanggil saat tombol Call ditekan dan lawan bicara belum ada di ruang.
 *  role 'host'  = admin menelepon vokalis `vocalistId`
 *  role 'guest' = vokalis (dengan `token`-nya) menelepon admin
 * Gagal tidak boleh mengganggu panggilan, jadi kesalahan ditelan di pemanggil.
 */
export async function ring({ role, token = '', vocalistId = '' }) {
  const jwt = role === 'host' ? await sessionJwt() : null;
  return call(role === 'host' ? { action: 'ring', role, vocalist_id: vocalistId } : { action: 'ring', role, token }, jwt);
}

/** Tutup notifikasi dering yang masih menempel (panggilan sudah dijawab atau berakhir). */
export async function clearRinging() {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    for (const n of (await reg?.getNotifications({ tag: 'evo-call' })) || []) n.close();
  } catch (_) { /* tidak penting */ }
}
