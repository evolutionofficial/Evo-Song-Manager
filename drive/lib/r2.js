'use strict';
// MEDIA — klien R2 (API S3) tanpa library: tanda tangan AWS SigV4, region "auto".
const crypto = require('crypto');

const sha256 = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
const TIMEOUT_MS = 120000;

function createR2(r2, bucket) {
  const base = new URL(r2.endpoint);
  const host = base.host;

  async function request(method, key, { body, headers = {} } = {}) {
    const path = '/' + enc(bucket) + (key ? '/' + key.split('/').map(enc).join('/') : '');
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = body ? sha256(body) : sha256('');
    const h = { host, 'x-amz-date': amzDate, 'x-amz-content-sha256': payloadHash };
    for (const [k, v] of Object.entries(headers)) h[k.toLowerCase()] = String(v);
    const names = Object.keys(h).sort();
    const canonical = [method, path, '', names.map((n) => `${n}:${h[n].trim()}\n`).join(''), names.join(';'), payloadHash].join('\n');
    const scope = `${day}/auto/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    let k = hmac('AWS4' + r2.secretAccessKey, day);
    k = hmac(k, 'auto'); k = hmac(k, 's3'); k = hmac(k, 'aws4_request');
    const sig = crypto.createHmac('sha256', k).update(toSign).digest('hex');
    const sendHeaders = { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${r2.accessKeyId}/${scope}, SignedHeaders=${names.join(';')}, Signature=${sig}` };
    delete sendHeaders.host;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetch(`${base.origin}${path}`, { method, headers: sendHeaders, body, signal: ctrl.signal });
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`R2 tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`);
      throw new Error('tidak bisa terhubung ke R2: ' + (e.cause?.code || e.message));
    } finally { clearTimeout(timer); }
  }

  const why = async (res) => {
    const t = await res.text().catch(() => '');
    const code = (t.match(/<Code>([^<]+)<\/Code>/) || [])[1];
    if (res.status === 403 || code === 'InvalidAccessKeyId' || code === 'SignatureDoesNotMatch') return `R2 menolak kunci (${code || res.status}). Cek isi r2.txt`;
    if (code === 'NoSuchBucket') return `bucket "${bucket}" tidak ada`;
    return `R2 HTTP ${res.status}${code ? ' ' + code : ''}`;
  };

  return {
    /** Info file di R2, atau null kalau belum ada. */
    async head(key) {
      const res = await request('HEAD', key);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(await why(res));
      return { etag: String(res.headers.get('etag') || '').replace(/"/g, '').toLowerCase(), size: Number(res.headers.get('content-length')) };
    },
    /** Hapus objek. Dipakai untuk membuang audio versi lama (dan sisa unggahan yang batal). */
    async remove(key) {
      const res = await request('DELETE', key);
      if (res.status === 404) return false;
      if (!res.ok && res.status !== 204) throw new Error(await why(res));
      await res.arrayBuffer().catch(() => {});
      return true;
    },
    /** Unggah. R2 sendiri memeriksa Content-MD5, jadi file rusak di jalan ditolak. */
    async put(key, buf, md5hex, contentType) {
      const res = await request('PUT', key, {
        body: buf,
        headers: { 'content-type': contentType, 'content-md5': Buffer.from(md5hex, 'hex').toString('base64') },
      });
      if (!res.ok) throw new Error(await why(res));
      await res.arrayBuffer().catch(() => {});
    },
  };
}

module.exports = { createR2 };
