// Supabase Edge Function `reply-notify` — mengabarkan vokalis bahwa admin membalas catatannya.
//
//   POST { vocalist_id, kind, ref_id }   (header Authorization = sesi login admin)
//        -> { sent, removed, failed, targets }
//
// Hanya admin (email di tabel `admins`) yang boleh memanggil. Pesan itu sendiri dicek di
// tabel thread_messages: harus ada balasan dari admin untuk vokalis dan ref ini, yang dibuat
// dalam 2 menit terakhir. Dengan begitu fungsi ini tidak bisa dipakai untuk mengirim notifikasi
// sembarangan. Isi notifikasinya selalu tetap, tidak mengambil teks dari pemanggil.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { generateVapid, sendPush, type Vapid } from './webpush.ts';

const SUBJECT = 'https://evo-song-manager.pages.dev';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ADMIN_NAME = 'Jeffry';
const RECENT_MS = 2 * 60_000;

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
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: u } = await db.auth.getUser(jwt);
    const email = u?.user?.email?.toLowerCase();
    if (!email) return json({ error: 'not allowed' }, 401);
    const { data: a } = await db.from('admins').select('email').eq('email', email).maybeSingle();
    if (!a) return json({ error: 'not allowed' }, 403);

    const vocalistId = String(body.vocalist_id ?? '');
    const kind = String(body.kind ?? '');
    const refId = String(body.ref_id ?? '');
    if (!UUID_RE.test(vocalistId) || !UUID_RE.test(refId) || !['revision', 'order'].includes(kind)) {
      return json({ error: 'bad request' }, 400);
    }

    // Harus ada balasan admin yang baru saja dibuat untuk vokalis dan ref ini.
    const since = new Date(Date.now() - RECENT_MS).toISOString();
    const { count: recent } = await db.from('thread_messages').select('id', { count: 'exact', head: true })
      .eq('vocalist_id', vocalistId).eq('kind', kind).eq('ref_id', refId)
      .eq('sender', 'admin').gte('created_at', since);
    if ((recent ?? 0) === 0) return json({ error: 'no recent reply' }, 409);

    const { data: v } = await db.from('vocalists').select('id, share_token').eq('id', vocalistId).maybeSingle();
    if (!v) return json({ error: 'vocalist not found' }, 404);

    const vapid = await getVapid(db);
    const { data: subs, error: subErr } = await db.from('push_subscriptions')
      .select('id, endpoint, p256dh, auth').eq('kind', 'vocalist').eq('vocalist_id', v.id);
    if (subErr) throw subErr;

    const payload = JSON.stringify({
      title: `${ADMIN_NAME} replied`,
      body: kind === 'revision' ? 'About your revision request. Tap to read.' : 'About your order. Tap to read.',
      url: `/v/${v.share_token}#messages`,
      tag: 'evo-reply',
      kind: 'reply',
      ts: Date.now(),
    });
    let sent = 0, removed = 0, failed = 0;
    await Promise.all((subs ?? []).map(async (s) => {
      try {
        const r = await sendPush(s, payload, { vapid, subject: SUBJECT, ttl: 3600, urgency: 'normal' });
        if (r.ok) {
          sent++;
          await db.from('push_subscriptions').update({ last_ok_at: new Date().toISOString(), fail_count: 0, last_error: null }).eq('id', s.id);
        } else if (r.status === 404 || r.status === 410) {
          removed++;
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

    return json({ sent, removed, failed, targets: subs?.length ?? 0 });
  } catch (e) {
    console.error('reply-notify failed', e);
    return json({ error: 'server' }, 500);
  }
});
