-- FASE 8 — Listen Together: ruang menyimak bersama.
--
-- Ruang dibuka admin untuk satu vokalis dan berumur pendek. Kode ruangnya dipakai dua hal:
--   1. nama saluran realtime tempat perintah play/pause/geser dikirim, dan
--   2. token untuk mengalirkan audio, PERSIS seperti share_token vokalis.
--
-- Nomor 2 itu yang membuat rancangan ini aman tanpa menggandakan aturan: get_audio_key tetap
-- satu-satunya tempat yang memutuskan boleh atau tidak, jadi lagu yang dihapus, yang sedang
-- revisi, atau yang belum punya audio tetap tertutup — tidak ada jalan pintas baru.

create table if not exists public.listen_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  vocalist_id uuid not null references public.vocalists(id) on delete cascade,
  opened_by   uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '4 hours',
  closed_at   timestamptz
);

-- Satu ruang terbuka per vokalis, supaya tidak pernah ada dua ruang yang bersaing.
create unique index if not exists listen_rooms_one_open
  on public.listen_rooms (vocalist_id) where closed_at is null;

create index if not exists listen_rooms_code_open
  on public.listen_rooms (code) where closed_at is null;

-- Tabel ini tidak pernah dibaca langsung dari browser; semua lewat fungsi di bawah.
alter table public.listen_rooms enable row level security;

-- ---------------------------------------------------------------------------
-- Admin: buka, tutup, lihat ruang yang sedang terbuka.
-- ---------------------------------------------------------------------------

create or replace function public.listen_open(p_vocalist uuid)
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path to '' as $$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.vocalists where id = p_vocalist) then
    raise exception 'vocalist not found';
  end if;

  -- Ruang lama ditutup dulu: kalau ada yang masih menyimak di ruang lama, sesinya berakhir
  -- dengan jelas, bukan menggantung tanpa kabar.
  update public.listen_rooms r set closed_at = now()
   where r.vocalist_id = p_vocalist and r.closed_at is null;

  -- Awalan 'lr_' membuat kode ruang tidak mungkin sama dengan share_token vokalis mana pun.
  -- gen_random_uuid dipakai, bukan gen_random_bytes: yang kedua ada di skema 'extensions' di
  -- Supabase, jadi tidak terbaca dari fungsi ber-search_path kosong seperti ini.
  v_code := 'lr_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.listen_rooms (code, vocalist_id, opened_by)
  values (v_code, p_vocalist, auth.uid());

  return query
    select r.code, r.expires_at from public.listen_rooms r where r.code = v_code;
end $$;

create or replace function public.listen_close(p_code text)
returns boolean
language plpgsql security definer set search_path to '' as $$
declare v_n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.listen_rooms r set closed_at = now()
   where r.code = p_code and r.closed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end $$;

create or replace function public.listen_active(p_vocalist uuid)
returns table (code text, expires_at timestamptz)
language sql security definer set search_path to '' as $$
  select r.code, r.expires_at
    from public.listen_rooms r
   where public.is_admin()
     and r.vocalist_id = p_vocalist
     and r.closed_at is null and r.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- Vokalis: apakah ada undangan untuk saya? Dipanggil dengan share_token sendiri,
-- jadi tidak ada yang bisa menanyakan undangan orang lain.
-- ---------------------------------------------------------------------------

create or replace function public.listen_room_for(p_token text)
returns table (code text, expires_at timestamptz)
language sql security definer set search_path to '' as $$
  select r.code, r.expires_at
    from public.vocalists vo
    join public.listen_rooms r on r.vocalist_id = vo.id
   where vo.share_token = p_token and length(p_token) > 0
     and r.closed_at is null and r.expires_at > now();
$$;

-- ---------------------------------------------------------------------------
-- get_audio_key v2 — menerima share_token vokalis ATAU kode ruang.
--
-- Perubahannya hanya di bagian "siapa pemiliknya": sisanya tetap sama kata per kata, jadi
-- aturan boleh-tidaknya memutar lagu tidak digandakan dan tidak bisa menyimpang.
-- ---------------------------------------------------------------------------

create or replace function public.get_audio_key(p_token text, p_song uuid)
returns text
language sql stable security definer set search_path to '' as $$
  with who as (
    select vo.id
      from public.vocalists vo
     where vo.share_token = p_token and length(p_token) > 0
    union
    select r.vocalist_id
      from public.listen_rooms r
     where r.code = p_token and length(p_token) > 0
       and r.closed_at is null and r.expires_at > now()
  )
  select coalesce(
    (select v.m4a_key
       from who
       join public.songs s on s.vocalist_id = who.id and s.id = p_song
        and not s.deleted and s.revision_requested_at is null
       join public.song_versions v on v.id = s.active_version_id
      where v.m4a_key is not null),
    (select a.r2_key
       from who
       join public.songs s on s.vocalist_id = who.id and s.id = p_song
        and not s.deleted and s.revision_requested_at is null
       join public.audio_files a on a.song_id = s.id and a.revision <= s.revision
      order by a.revision desc, a.uploaded_at desc limit 1));
$$;

-- Daftar lagu yang bisa diputar di sebuah ruang, untuk sisi admin (yang belum punya pemutar).
create or replace function public.listen_songs(p_code text)
returns table (id uuid, title text, session_label text, sort_date timestamptz, has_audio boolean)
language sql security definer set search_path to '' as $$
  select s.id, s.title, s.session_label, s.sort_date,
         public.get_audio_key(p_code, s.id) is not null
    from public.listen_rooms r
    join public.songs s on s.vocalist_id = r.vocalist_id and not s.deleted
   where r.code = p_code and r.closed_at is null and r.expires_at > now()
   order by s.sort_date desc nulls last;
$$;

grant execute on function public.listen_open(uuid)        to authenticated;
grant execute on function public.listen_close(text)       to authenticated;
grant execute on function public.listen_active(uuid)      to authenticated;
grant execute on function public.listen_songs(text)       to anon, authenticated;
grant execute on function public.listen_room_for(text)    to anon, authenticated;
