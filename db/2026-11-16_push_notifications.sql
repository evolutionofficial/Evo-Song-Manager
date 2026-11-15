-- Notifikasi panggilan meeting (16 Nov 2026).
-- Saat satu pihak menekan Call, pihak lain mendapat notifikasi di HP/laptop (Web Push) dan bisa
-- langsung membuka tab Meeting. Sudah diterapkan ke Supabase sebagai migrasi `push_notifications`.
-- Hanya MENAMBAH tabel dan fungsi baru; tidak ada tabel atau fungsi lama yang diubah.
--
-- Semua tabel RLS menyala TANPA kebijakan: klien (anon/authenticated) tidak bisa membaca atau menulis
-- langsung. Satu-satunya jalan masuk dari halaman web adalah push_subscribe / push_unsubscribe di bawah.
-- Pengirim notifikasinya Edge Function `ring` (supabase/functions/ring) yang memakai service role.

-- Satu baris = satu perangkat/browser yang mau menerima notifikasi.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('admin', 'vocalist')),
  vocalist_id uuid references public.vocalists(id) on delete cascade,
  admin_email text,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count integer not null default 0,
  last_error text,
  check ((kind = 'vocalist' and vocalist_id is not null) or (kind = 'admin' and admin_email is not null))
);
create index if not exists push_subscriptions_vocalist_idx on public.push_subscriptions (vocalist_id) where kind = 'vocalist';
alter table public.push_subscriptions enable row level security;

-- Kunci server (VAPID). Dibuat sendiri oleh Edge Function saat pertama dipakai; kunci privatnya tidak
-- pernah keluar dari database dan tidak ada di GitHub.
create table if not exists public.push_vapid (
  id integer primary key default 1 check (id = 1),
  public_key text not null,
  private_jwk jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.push_vapid enable row level security;

-- Catatan setiap dering: dipakai untuk membatasi (maks. satu dering per 10 detik per arah per vokalis).
create table if not exists public.push_rings (
  id bigint generated always as identity primary key,
  vocalist_id uuid not null references public.vocalists(id) on delete cascade,
  dir text not null check (dir in ('to_vocalist', 'to_admin')),
  at timestamptz not null default now(),
  sent integer not null default 0
);
create index if not exists push_rings_recent_idx on public.push_rings (vocalist_id, dir, at desc);
alter table public.push_rings enable row level security;

-- Perangkat mendaftar. Vokalis dikenali dari share_token; admin dari login (is_admin()).
create or replace function public.push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text, p_ua text default null)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare v_voc uuid; v_email text;
begin
  if p_endpoint !~ '^https://' or length(coalesce(p_endpoint, '')) < 20 or length(coalesce(p_p256dh, '')) < 20
     or length(coalesce(p_auth, '')) < 8 then
    raise exception 'bad subscription';
  end if;

  select id into v_voc from public.vocalists where share_token = p_token and length(coalesce(p_token, '')) > 0;
  if v_voc is not null then
    insert into public.push_subscriptions (kind, vocalist_id, endpoint, p256dh, auth, user_agent)
    values ('vocalist', v_voc, p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
    on conflict (endpoint) do update set kind = 'vocalist', vocalist_id = excluded.vocalist_id, admin_email = null,
      p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
      last_seen_at = now(), fail_count = 0, last_error = null;
    return 'vocalist';
  end if;

  if public.is_admin() then
    v_email := lower(auth.jwt() ->> 'email');
    insert into public.push_subscriptions (kind, admin_email, endpoint, p256dh, auth, user_agent)
    values ('admin', v_email, p_endpoint, p_p256dh, p_auth, left(p_ua, 300))
    on conflict (endpoint) do update set kind = 'admin', admin_email = excluded.admin_email, vocalist_id = null,
      p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent,
      last_seen_at = now(), fail_count = 0, last_error = null;
    return 'admin';
  end if;

  raise exception 'not allowed';
end $function$;

-- Perangkat berhenti berlangganan. Hanya pemilik (vokalis yang sama / admin) yang bisa mencabut.
create or replace function public.push_unsubscribe(p_token text, p_endpoint text)
 returns boolean language plpgsql security definer set search_path to ''
as $function$
declare v_voc uuid; n int;
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(coalesce(p_token, '')) > 0;
  if v_voc is not null then
    delete from public.push_subscriptions where endpoint = p_endpoint and kind = 'vocalist' and vocalist_id = v_voc;
  elsif public.is_admin() then
    delete from public.push_subscriptions where endpoint = p_endpoint and kind = 'admin';
  else
    raise exception 'not allowed';
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $function$;
