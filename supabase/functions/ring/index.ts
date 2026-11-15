// Supabase Edge Function `ring` — mengirim notifikasi panggilan meeting ke HP/laptop.
//
//   POST { action: 'key' }
//        -> { key }   kunci publik VAPID; dibuat sendiri saat pertama kali dipakai.
//   POST { action: 'ring', role: 'guest', token }
//        -> vokalis menelepon: notifikasi ke semua perangkat admin.
//   POST { action: 'ring', role: 'host', vocalist_id }      (header Authorization = sesi login admin)
//        -> admin menelepon: notifikasi ke semua perangkat vokalis itu.
//
// Yang boleh memanggil dibuktikan di sini, bukan dipercaya dari halaman: vokalis dengan share_token-nya,
// admin dengan sesi login yang emailnya ada di tabel `admins`. Tabel langganan hanya bisa dibaca
// lewat service role di fungsi ini.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateVapid, sendPush, type Vapid } from './webpush.ts';

const SUBJECT = 'https://evo-song-manager.pages.dev';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_NAME = 'Jeffry';           // nama yang dilihat vokalis di notifikasi
const MIN_GAP_MS = 10_000;             // satu dering per arah per vokalis per 10 detik

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });

// deno-lint-ignore no-explicit-any
async function getVapid(db: any): Promise<Vapid> {
  const read = async () => {
    const { data, error } = await db.from('push_vapid').select('public_key, private_jwk').eq('id', 1).maybeSingle();
    if (error) throw error;
    return data ? { publicKey: data.public_key as string, privateJwk: data.private_jwk as JsonWebKey } : null;
  };
  const have = await read();
  if (have) return have;
  const fresh = await generateVapid();
  // Dua permintaan pertama bisa berlomba: yang kalah dibuang, lalu semua memakai yang menang.
  await db.from('push_vapid').upsert({ id: 1, public_key: fresh.publicKey, private_jwk: fresh.privateJwk }, { onConflict: 'id', ignoreDuplicates: true });
  const won = await read();
  if (!won) throw new Error('vapid unavailable');
  return won;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method' }, 405);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'bad json' }, 400); }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const vapid = await getVapid(db);
    if (body.action === 'key') return json({ key: vapid.publicKey });
    if (body.action !== 'ring') return json({ error: 'unknown action' }, 400);

    let vocalistId: string;
    let dir: 'to_vocalist' | 'to_admin';
    let title: string;
    let url: string;
    // deno-lint-ignore no-explicit-any
    let subsQuery: any;

    if (body.role === 'guest') {
      const token = String(body.token ?? '');
      if (!token || token.length > 200) return json({ error: 'not allowed' }, 403);
      const { data: v } = await db.from('vocalists').select('id, display_name').eq('share_token', token).maybeSingle();
      if (!v) return json({ error: 'not allowed' }, 403);
      vocalistId = v.id; dir = 'to_admin';
      title = `${v.display_name} is calling`;
      url = `/admin#call=${v.id}`;
      subsQuery = db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('kind', 'admin');
    } else if (body.role === 'host') {
      const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
      const { data: u } = await db.auth.getUser(jwt);
      const email = u?.user?.email?.toLowerCase();
      if (!email) return json({ error: 'not allowed' }, 401);
      const { data: a } = await db.from('admins').select('email').eq('email', email).maybeSingle();
      if (!a) return json({ error: 'not allowed' }, 403);
      const id = String(body.vocalist_id ?? '');
      if (!UUID_RE.test(id)) return json({ error: 'vocalist required' }, 400);
      const { data: v } = await db.from('vocalists').select('id, display_name, share_token').eq('id', id).maybeSingle();
      if (!v) return json({ error: 'vocalist not found' }, 404);
      vocalistId = v.id; dir = 'to_vocalist';
      title = `${ADMIN_NAME} is calling you`;
      url = `/v/${v.share_token}#call`;
      subsQuery = db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('kind', 'vocalist').eq('vocalist_id', v.id);
    } else {
      return json({ error: 'role' }, 400);
    }

    // Terlalu rapat dengan dering sebelumnya? Lewati, supaya tombol Call yang ditekan berulang
    // tidak membanjiri HP orang dengan notifikasi.
    const since = new Date(Date.now() - MIN_GAP_MS).toISOString();
    const { count: recent } = await db.from('push_rings').select('id', { count: 'exact', head: true })
      .eq('vocalist_id', vocalistId).eq('dir', dir).gte('at', since);
    if ((recent ?? 0) > 0) return json({ sent: 0, throttled: true });

    const { data: subs, error: subErr } = await subsQuery;
    if (subErr) throw subErr;

    const payload = JSON.stringify({ title, body: 'Tap to open the meeting and answer.', url, tag: 'evo-call', kind: 'call', ts: Date.now() });
    let sent = 0, removed = 0, failed = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        const r = await sendPush(s, payload, { vapid, subject: SUBJECT, ttl: 60, urgency: 'high' });
        if (r.ok) {
          sent++;
          await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0, last_error: null }).eq('id', s.id);
        } else if (r.status === 404 || r.status === 410) {
          removed++;                                   // perangkat sudah mencabut langganannya
          await db.from('push_subscriptions').delete().eq('id', s.id);
        } else {
          failed++;
          await db.from('push_subscriptions').update({ last_error: `${r.status} ${r.text}`.slice(0, 300) }).eq('id', s.id);
        }
      } catch (e) {
        failed++;
        await db.from('push_subscriptions').update({ last_error: String((e as Error)?.message ?? e).slice(0, 300) }).eq('id', s.id);
      }
    }));

    await db.from('push_rings').insert({ vocalist_id: vocalistId, dir, sent });
    await db.from('push_rings').delete().lt('at', new Date(Date.now() - 7 * 86_400_000).toISOString());
    return json({ sent, removed, failed, targets: subs?.length ?? 0 });
  } catch (e) {
    console.error('ring failed', e);
    return json({ error: 'server' }, 500);
  }
});
