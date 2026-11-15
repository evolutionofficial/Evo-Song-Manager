// Web Push tanpa library: enkripsi isi pesan (RFC 8291, aes128gcm), tanda pengenal server (VAPID, RFC 8292),
// dan pengiriman ke layanan push (RFC 8030). Hanya memakai WebCrypto + fetch, jadi jalan sama di Deno
// (Supabase Edge Function) dan Node (untuk pengujian: webpush.test.mjs).
//
// Sengaja kecil dan tanpa ketergantungan: library `web-push` memakai modul Node yang tidak ada di edge.

const enc = new TextEncoder();

export function b64u(buf: ArrayBuffer | Uint8Array): string {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s: string): Uint8Array {
  const p = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(p);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, bytes * 8));
}

/**
 * Enkripsi `payload` untuk satu langganan (kunci p256dh + rahasia auth dari browser).
 * `opts.salt` dan `opts.senderKeys` hanya untuk pengujian dengan contoh dari RFC 8291; di produksi
 * keduanya dibuat acak setiap pengiriman.
 */
export async function encryptPayload(
  payload: Uint8Array, p256dh: string, authSecret: string,
  opts: { salt?: Uint8Array; senderKeys?: CryptoKeyPair } = {},
): Promise<Uint8Array> {
  const uaPublic = unb64u(p256dh);
  const auth = unb64u(authSecret);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4) throw new Error('bad p256dh');
  if (auth.length !== 16) throw new Error('bad auth');
  if (payload.length > 3800) throw new Error('payload too large');

  const sender = opts.senderKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, sender.privateKey, 256));

  const ikm = await hkdf(auth, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // Satu record saja; byte 0x02 penanda record terakhir.
  const aes = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aes, concat(payload, new Uint8Array([2]))));

  const recordSize = new Uint8Array([0, 0, 0x10, 0]);          // 4096, big-endian
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, body);
}

export type Vapid = { publicKey: string; privateJwk: JsonWebKey };

/** Pasangan kunci server untuk VAPID. Kunci publik (65 byte, base64url) dipakai browser saat berlangganan. */
export async function generateVapid(): Promise<Vapid> {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64u(await crypto.subtle.exportKey('raw', kp.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

/** Header Authorization untuk layanan push. Berlaku 12 jam (batas RFC: 24 jam). */
export async function vapidHeader(
  endpoint: string, subject: string, v: Vapid, nowSec = Math.floor(Date.now() / 1000),
): Promise<string> {
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSec + 12 * 3600, sub: subject })));
  const key = await crypto.subtle.importKey('jwk', v.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${v.publicKey}`;
}

export type Sub = { endpoint: string; p256dh: string; auth: string };
export type SendOpts = { vapid: Vapid; subject: string; ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; fetch?: typeof fetch };

/** Kirim satu pesan. 404/410 berarti langganan sudah tidak berlaku (perangkat mencabutnya). */
export async function sendPush(sub: Sub, payload: string, o: SendOpts): Promise<{ status: number; ok: boolean; text: string }> {
  const body = await encryptPayload(enc.encode(payload), sub.p256dh, sub.auth);
  const res = await (o.fetch ?? fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, o.subject, o.vapid),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(o.ttl ?? 60),
      Urgency: o.urgency ?? 'high',
    },
    body,
  });
  return { status: res.status, ok: res.ok, text: res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200) };
}
