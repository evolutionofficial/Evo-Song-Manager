-- Order lagu: vokalis menempelkan link YouTube, admin menerima, PC mengunduh mp3 ke
-- D:\FIRST CLUB\<folder vokalis>\<tanggal, mis. 22 Nov>.
--
-- Antreannya ada di tabel ini sendiri (bukan tabel jobs): jobs terikat ke lagu dan versi,
-- dan claim_jobs/job_finish dipakai pekerjaan penting (finalisasi, arsip), jadi tidak disentuh.
--
-- Status:  waiting -> accepted ("Waiting for PC") -> downloading -> done
--                                                       \-> failed (fail_count + 1)
--          waiting -> rejected
-- Gagal kurang dari 3 kali: admin bisa Try again. Gagal 3 kali: tombolnya jadi Copy link
-- (unduh manual di web); retry_order menolak supaya tidak mengulang tanpa akhir.

create table if not exists public.song_orders (
  id uuid primary key default gen_random_uuid(),
  vocalist_id uuid not null references public.vocalists(id) on delete cascade,
  url text not null,
  video_id text not null,
  status text not null default 'waiting'
    check (status in ('waiting','accepted','downloading','done','failed','rejected')),
  fail_count int not null default 0,
  last_error text,
  progress int,
  date_folder text,
  result jsonb,
  lease_owner uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Satu video hanya boleh aktif satu kali per vokalis (yang ditolak boleh dipesan lagi).
create unique index if not exists song_orders_active_uniq
  on public.song_orders (vocalist_id, video_id) where status <> 'rejected';
create index if not exists song_orders_status_idx on public.song_orders (status, created_at);

alter table public.song_orders enable row level security;
drop policy if exists admin_all on public.song_orders;
create policy admin_all on public.song_orders for all using (public.is_admin());

-- Ambil id video 11 karakter dari link YouTube. Null kalau bukan link satu video.
create or replace function public._yt_video_id(p_url text)
 returns text language sql immutable set search_path to ''
as $f$
  select coalesce(
    substring(p_url from '^https?://(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})(?:[&#]|$)'),
    substring(p_url from '^https?://youtu\.be/([A-Za-z0-9_-]{11})(?:[/?#]|$)'),
    substring(p_url from '^https?://(?:www\.|m\.)?youtube\.com/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})(?:[/?#]|$)')
  );
$f$;

-- Vokalis memesan lewat link pribadinya (token).
create or replace function public.place_order(p_token text, p_url text)
 returns jsonb language plpgsql security definer set search_path to ''
as $f$
declare v_voc uuid; v_url text := btrim(coalesce(p_url, '')); v_vid text; r public.song_orders;
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(p_token) > 0 and active;
  if v_voc is null then raise exception 'link not found'; end if;
  if length(v_url) > 300 then raise exception 'link too long'; end if;
  v_vid := public._yt_video_id(v_url);
  if v_vid is null then raise exception 'not a YouTube video link'; end if;
  if (select count(*) from public.song_orders where vocalist_id = v_voc and status = 'waiting') >= 20 then
    raise exception 'too many waiting orders';
  end if;
  if exists (select 1 from public.song_orders where vocalist_id = v_voc and video_id = v_vid and status <> 'rejected') then
    raise exception 'already ordered';
  end if;
  insert into public.song_orders (vocalist_id, url, video_id)
  values (v_voc, 'https://www.youtube.com/watch?v=' || v_vid, v_vid) returning * into r;
  return jsonb_build_object('id', r.id, 'url', r.url, 'status', r.status, 'created_at', r.created_at);
end $f$;
revoke all on function public.place_order(text, text) from public;
grant execute on function public.place_order(text, text) to anon, authenticated;

-- Daftar order milik vokalis itu sendiri (status disederhanakan di layar).
create or replace function public.my_orders(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'url', o.url, 'status', o.status, 'created_at', o.created_at,
      'date_folder', o.date_folder) order by o.created_at desc), '[]'::jsonb)
  from public.song_orders o join public.vocalists v on v.id = o.vocalist_id
  where v.share_token = p_token and length(p_token) > 0;
$f$;
revoke all on function public.my_orders(text) from public;
grant execute on function public.my_orders(text) to anon, authenticated;

-- Admin: terima. Nama folder tanggal ("22 Nov") dihitung di sini, zona Jakarta, supaya sama
-- di mana pun admin membukanya.
create or replace function public.accept_order(p_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $f$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.song_orders
     set status = 'accepted', accepted_at = now(), updated_at = now(), progress = null, last_error = null,
         date_folder = to_char(now() at time zone 'Asia/Jakarta', 'DD Mon')
   where id = p_id and status = 'waiting';
  if not found then raise exception 'order is not waiting'; end if;
end $f$;
revoke all on function public.accept_order(uuid) from public, anon;
grant execute on function public.accept_order(uuid) to authenticated;

create or replace function public.reject_order(p_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $f$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.song_orders set status = 'rejected', updated_at = now()
   where id = p_id and status in ('waiting','failed');
  if not found then raise exception 'order cannot be rejected'; end if;
end $f$;
revoke all on function public.reject_order(uuid) from public, anon;
grant execute on function public.reject_order(uuid) to authenticated;

-- Admin: coba lagi, hanya selama gagalnya masih kurang dari 3 kali.
create or replace function public.retry_order(p_id uuid)
 returns void language plpgsql security definer set search_path to ''
as $f$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.song_orders
     set status = 'accepted', updated_at = now(), progress = null, lease_owner = null, lease_until = null
   where id = p_id and status = 'failed' and fail_count < 3;
  if not found then raise exception 'order cannot be retried'; end if;
end $f$;
revoke all on function public.retry_order(uuid) from public, anon;
grant execute on function public.retry_order(uuid) to authenticated;

-- PC: ambil order yang sudah diterima. Sewa 10 menit; sewa yang habis dianggap gagal sekali
-- (PC mati atau program berhenti di tengah unduhan).
create or replace function public.claim_orders(p_secret text, p_device uuid, p_limit int default 2)
 returns jsonb language plpgsql security definer set search_path to ''
as $f$
declare v_out jsonb;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  if p_device is null then raise exception 'device id required'; end if;

  update public.song_orders
     set status = 'failed',
         fail_count = fail_count + 1, last_error = 'download was interrupted',
         lease_owner = null, lease_until = null, updated_at = now()
   where status = 'downloading' and lease_until < now();

  with pick as (
    select o.id from public.song_orders o
    where o.status = 'accepted'
    order by o.accepted_at
    limit greatest(1, least(coalesce(p_limit, 2), 5))
    for update skip locked
  ), upd as (
    update public.song_orders o
       set status = 'downloading', lease_owner = p_device, progress = 0,
           lease_until = now() + interval '10 minutes', updated_at = now()
      from pick where o.id = pick.id
    returning o.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', u.id, 'url', u.url, 'date_folder', u.date_folder,
      'folder', v.folder_name, 'vocalist', v.display_name, 'fail_count', u.fail_count)
      order by u.accepted_at), '[]'::jsonb) into v_out
  from upd u join public.vocalists v on v.id = u.vocalist_id;
  return v_out;
end $f$;
revoke all on function public.claim_orders(text, uuid, int) from public;
grant execute on function public.claim_orders(text, uuid, int) to anon, authenticated;

create or replace function public.order_progress(p_secret text, p_device uuid, p_id uuid, p_pct int)
 returns text language plpgsql security definer set search_path to ''
as $f$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  update public.song_orders
     set progress = greatest(0, least(coalesce(p_pct, 0), 100)), updated_at = now(),
         lease_until = now() + interval '10 minutes'
   where id = p_id and lease_owner = p_device and status = 'downloading';
  if not found then return 'lost'; end if;
  return 'ok';
end $f$;
revoke all on function public.order_progress(text, uuid, uuid, int) from public;
grant execute on function public.order_progress(text, uuid, uuid, int) to anon, authenticated;

-- PC: hasil akhir. Gagal menambah fail_count; yang ketiga kalinya membuat UI memakai Copy link.
create or replace function public.order_finish(
  p_secret text, p_device uuid, p_id uuid, p_ok boolean, p_result jsonb, p_error text)
 returns text language plpgsql security definer set search_path to ''
as $f$
declare o public.song_orders;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  select * into o from public.song_orders where id = p_id for update;
  if o.id is null then raise exception 'order not found'; end if;
  if o.lease_owner is distinct from p_device or o.status <> 'downloading' then return 'lost'; end if;
  if p_ok then
    update public.song_orders set status = 'done', progress = 100, result = p_result, last_error = null,
           lease_owner = null, lease_until = null, updated_at = now() where id = p_id;
    return 'done';
  end if;
  update public.song_orders set status = 'failed', fail_count = fail_count + 1,
         last_error = left(coalesce(p_error, 'unknown error'), 300),
         lease_owner = null, lease_until = null, updated_at = now() where id = p_id;
  return 'failed';
end $f$;
revoke all on function public.order_finish(text, uuid, uuid, boolean, jsonb, text) from public;
grant execute on function public.order_finish(text, uuid, uuid, boolean, jsonb, text) to anon, authenticated;
