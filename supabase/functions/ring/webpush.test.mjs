// Uji Web Push: enkripsi bolak-balik (RFC 8291), tanda tangan VAPID, dan penolakan masukan buruk.
// Jalankan:  node supabase/functions/ring/webpush.test.mjs     (Node 22+, tanpa paket apa pun)
import assert from 'node:assert/strict';
import { b64u, unb64u, encryptPayload, generateVapid, vapidHeader } from './webpush.ts';

const dec = new TextDecoder();

// --- 1. Bolak-balik: dienkripsi seperti server, dibuka seperti browser (sisi penerima ditulis di sini
// langsung dari RFC 8291). Kecocokan dengan implementasi referensi `http_ece` sudah diperiksa sekali
// secara terpisah (4 pesan acak termasuk 3700 byte dan huruf non-ASCII, plus pesan yang diubah ditolak).
async function receive(body, uaPrivate, uaPublic, authSecret) {
  const salt = body.slice(0, 16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const asKey = await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, uaPrivate, 256));
  const hk = async (s, ikm, info, n) => new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));
  const te = new TextEncoder();
  const cat = (...a) => Uint8Array.from(a.flatMap((x) => [...x]));
  const ikm = await hk(authSecret, ecdh, cat(te.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const cek = await hk(salt, ikm, te.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hk(salt, ikm, te.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ct));
  assert.equal(plain[plain.length - 1], 2, 'penanda record terakhir');
  return dec.decode(plain.slice(0, -1));
}
{
  const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  const texts = ['hi', JSON.stringify({ title: 'Keket is calling', url: '/admin#call=abc', tag: 'evo-call' }), '\u00e9'.repeat(900)];
  for (const t of texts) {
    const body = await encryptPayload(new TextEncoder().encode(t), b64u(uaPublic), b64u(authSecret));
    assert.equal(body[20], 65, 'panjang keyid');
    assert.equal(await receive(body, ua.privateKey, uaPublic, authSecret), t);
  }
  const body = await encryptPayload(new TextEncoder().encode('rahasia'), b64u(uaPublic), b64u(authSecret));
  body[body.length - 3] ^= 1;
  await assert.rejects(receive(body, ua.privateKey, uaPublic, authSecret), 'pesan yang diubah harus ditolak');
  console.log('ok  enkripsi bolak-balik benar; pesan yang diubah ditolak');
}

// --- 2. VAPID: tanda tangan JWT harus lolos diverifikasi dengan kunci publiknya.
{
  const v = await generateVapid();
  assert.equal(unb64u(v.publicKey).length, 65);
  const now = 1_800_000_000;
  const h = await vapidHeader('https://fcm.googleapis.com/fcm/send/abc', 'https://example.org', v, now);
  const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h);
  assert.ok(m, 'format header: ' + h);
  assert.equal(m[4], v.publicKey);
  const claims = JSON.parse(dec.decode(unb64u(m[2])));
  assert.deepEqual(claims, { aud: 'https://fcm.googleapis.com', exp: now + 43200, sub: 'https://example.org' });
  const pub = await crypto.subtle.importKey('raw', unb64u(v.publicKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const okSig = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pub, unb64u(m[3]), new TextEncoder().encode(`${m[1]}.${m[2]}`));
  assert.equal(okSig, true, 'tanda tangan VAPID harus sah');
  console.log('ok  tanda tangan VAPID sah, klaim benar (aud/exp/sub)');
}

// --- 3. Masukan buruk ditolak, bukan diam-diam menghasilkan sampah.
{
  const bad = (p, a) => encryptPayload(new Uint8Array([1]), p, a).then(() => 'tidak ditolak', (e) => e.message);
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pubOk = b64u(await crypto.subtle.exportKey('raw', k.publicKey));
  const authOk = b64u(crypto.getRandomValues(new Uint8Array(16)));
  assert.equal(await bad('AAAA', authOk), 'bad p256dh');
  assert.equal(await bad(pubOk, 'AAAA'), 'bad auth');
  await assert.rejects(encryptPayload(new Uint8Array(4000), pubOk, authOk), /too large/);
  console.log('ok  masukan buruk ditolak');
}
console.log('semua uji lulus');
