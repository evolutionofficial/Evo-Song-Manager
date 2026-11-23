-- Riwayat balasan antara admin dan vokalis untuk dua hal:
--   kind = 'revision' → ref_id = songs.id          (permintaan revisi lagu)
--   kind = 'order'    → ref_id = song_orders.group_id (order lagu / medley)
--
-- Catatan awal dari vokalis tidak disalin ke tabel ini. Ia tetap di songs.revision_note
-- dan song_orders.note, dan ditampilkan sebagai gelembung pertama.
--
-- Akses:
--   admin      : lewat RLS (admin_all), langsung dari web admin.
--   vokalis    : hanya lewat RPC di bawah, dengan share_token. Tidak ada akses tabel langsung.
--   read_at    : ditandai oleh PEMBACA (admin menandai pesan vokalis, vokalis menandai pesan admin).

create table if not exists public.thread_messages (
  id uuid primary key default gen_random_uuid(),
  vocalist_id uuid not null references public.vocalists(id) on delete cascade,
  kind text not null check (kind in ('revision', 'order')),
  ref_id uuid not null,
  sender text not null check (sender in ('admin', 'vocalist')),
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index if not exists thread_messages_ref_idx on public.thread_messages (kind, ref_id, created_at);
create index if not exists thread_messages_unread_idx on public.thread_messages (vocalist_id) where read_at is null;

alter table public.thread_messages enable row level security;
drop policy if exists admin_all on public.thread_messages;
create policy admin_all on public.thread_messages for all using (public.is_admin()) with check (public.is_admin());

-- Pastikan ref_id memang milik vokalis ini.
create or replace function public._thread_ref_ok(p_vocalist uuid, p_kind text, p_ref uuid)
 returns boolean language sql stable security definer set search_path to ''
as $f$
  select case p_kind
    when 'revision' then exists (select 1 from public.songs s where s.id = p_ref and s.vocalist_id = p_vocalist)
    when 'order' then exists (select 1 from public.song_orders o where o.group_id = p_ref and o.vocalist_id = p_vocalist)
    else false
  end;
$f$;
revoke all on function public._thread_ref_ok(uuid, text, uuid) from public, anon, authenticated;

-- Vokalis membuka riwayat: pesan admin ditandai terbaca.
create or replace function public.vocalist_thread(p_token text, p_kind text, p_ref uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $f$
declare v_voc uuid; v_init jsonb := null; s public.songs; o public.song_orders;
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(p_token) > 0 and active;
  if v_voc is null then raise exception 'link not found'; end if;
  if not public._thread_ref_ok(v_voc, p_kind, p_ref) then raise exception 'not found'; end if;

  if p_kind = 'revision' then
    select * into s from public.songs where id = p_ref;
    if s.revision_note is not null then
      v_init := jsonb_build_object('body', s.revision_note, 'created_at', coalesce(s.revision_requested_at, s.replaced_at));
    end if;
  else
    select * into o from public.song_orders where group_id = p_ref order by created_at limit 1;
    if o.note is not null then
      v_init := jsonb_build_object('body', o.note, 'created_at', o.created_at);
    end if;
  end if;

  update public.thread_messages set read_at = now()
   where vocalist_id = v_voc and kind = p_kind and ref_id = p_ref and sender = 'admin' and read_at is null;

  return jsonb_build_object('initial', v_init, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'sender', m.sender, 'body', m.body, 'created_at', m.created_at) order by m.created_at)
      from public.thread_messages m
     where m.vocalist_id = v_voc and m.kind = p_kind and m.ref_id = p_ref
  ), '[]'::jsonb));
end $f$;

-- Vokalis membalas. Dibatasi 10 pesan per menit per vokalis.
create or replace function public.vocalist_post(p_token text, p_kind text, p_ref uuid, p_body text)
 returns jsonb language plpgsql security definer set search_path to ''
as $f$
declare v_voc uuid; v_body text := btrim(coalesce(p_body, '')); r public.thread_messages;
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(p_token) > 0 and active;
  if v_voc is null then raise exception 'link not found'; end if;
  if not public._thread_ref_ok(v_voc, p_kind, p_ref) then raise exception 'not found'; end if;
  if v_body = '' then raise exception 'message empty'; end if;
  if char_length(v_body) > 1000 then raise exception 'message too long'; end if;
  if (select count(*) from public.thread_messages
       where vocalist_id = v_voc and sender = 'vocalist' and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'too many messages';
  end if;
  insert into public.thread_messages (vocalist_id, kind, ref_id, sender, body)
  values (v_voc, p_kind, p_ref, 'vocalist', v_body) returning * into r;
  return jsonb_build_object('id', r.id, 'sender', r.sender, 'body', r.body, 'created_at', r.created_at);
end $f$;

revoke all on function public.vocalist_thread(text, text, uuid) from public;
revoke all on function public.vocalist_post(text, text, uuid, text) from public;
grant execute on function public.vocalist_thread(text, text, uuid) to anon, authenticated;
grant execute on function public.vocalist_post(text, text, uuid, text) to anon, authenticated;
