-- Fase 1 (identitas perangkat + sidik jari isi file), 2026-11-11.
-- Hanya mengumpulkan data. Tidak ada perilaku yang berubah bagi vokalis maupun operator.
--   devices        : satu baris per komputer (PC, MacBook)
--   file_candidates: satu baris per ISI file WAV yang pernah terlihat. Nama sama dengan isi
--                    berbeda = dua kandidat. Inilah yang membuat sistem tahu ada versi baru
--                    walaupun nama filenya persis sama.
create table if not exists public.devices (
  id          uuid primary key,
  name        text not null,
  platform    text,
  sources     text[] not null default '{}',
  sync_seen   timestamptz,
  media_seen  timestamptz,
  media_info  jsonb,
  created_at  timestamptz not null default now()
);
alter table public.devices enable row level security;
drop policy if exists admin_all on public.devices;
create policy admin_all on public.devices for all using (public.is_admin());

create table if not exists public.file_candidates (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid references public.songs(id) on delete cascade,
  device_id   uuid references public.devices(id),
  source      text not null,
  rel_path    text not null,                -- sama persis dengan songs.rel_path (berawalan sumber)
  file_name   text not null,                -- nama asli; tidak pernah diubah sistem
  size_bytes  bigint not null,
  file_mtime  timestamptz not null,
  sha256      text not null,
  md5         text not null,
  present     boolean not null default true,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (rel_path, sha256)
);
create index if not exists file_candidates_song on public.file_candidates (song_id);
create index if not exists file_candidates_sha on public.file_candidates (sha256);
alter table public.file_candidates enable row level security;
drop policy if exists admin_all on public.file_candidates;
create policy admin_all on public.file_candidates for all using (public.is_admin());

-- Pendaftaran komputer. Dipanggil kedua program; p_agent menentukan kolom "terakhir terlihat".
create or replace function public.device_hello(
  p_secret text, p_device uuid, p_name text, p_platform text, p_sources text[], p_agent text, p_info jsonb)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  if p_device is null then return; end if;
  insert into public.devices (id, name, platform, sources, sync_seen, media_seen, media_info)
  values (p_device, coalesce(nullif(trim(p_name), ''), 'Komputer'), p_platform, coalesce(p_sources, '{}'),
          case when p_agent = 'sync' then now() end,
          case when p_agent = 'media' then now() end,
          case when p_agent = 'media' then p_info end)
  on conflict (id) do update set
    name = coalesce(nullif(trim(excluded.name), ''), public.devices.name),
    platform = coalesce(excluded.platform, public.devices.platform),
    sources = case when array_length(excluded.sources, 1) is null then public.devices.sources else excluded.sources end,
    sync_seen  = case when p_agent = 'sync'  then now() else public.devices.sync_seen end,
    media_seen = case when p_agent = 'media' then now() else public.devices.media_seen end,
    media_info = case when p_agent = 'media' then excluded.media_info else public.devices.media_info end;
end $function$;
revoke all on function public.device_hello(text, uuid, text, text, text[], text, jsonb) from public;
grant execute on function public.device_hello(text, uuid, text, text, text[], text, jsonb) to anon, authenticated;

-- sync_files: tambahan p_device dan sidik jari per file (keduanya opsional, jadi program versi
-- lama tetap berjalan). Perilaku terhadap tabel songs TIDAK berubah.
-- Tanda tangan berubah, jadi versi lama harus dibuang dulu.
drop function if exists public.sync_files(text, text[], jsonb, text, boolean);
create or replace function public.sync_files(
  p_secret text, p_folders text[], p_files jsonb,
  p_source text default 'pc', p_archive boolean default false, p_device uuid default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_new_vocalists int := 0; v_new_songs int := 0; v_missing int := 0; v_unmatched int := 0;
        v_skipped int := 0; v_candidates int := 0;
begin
  if not exists (select 1 from public.sync_secret where secret = p_secret) then raise exception 'invalid sync secret'; end if;
  if p_source !~ '^[a-z][a-z0-9-]{0,30}$' then raise exception 'invalid source name'; end if;

  if p_source = 'pc' then
    insert into public.vocalists (folder_name, display_name)
    select distinct on (lower(f)) f, initcap(lower(f)) from unnest(p_folders) f
    where trim(f) <> '' and not exists (select 1 from public.vocalists v where lower(v.folder_name) = lower(f));
    get diagnostics v_new_vocalists = row_count;
    update public.vocalists v set active = exists (select 1 from unnest(p_folders) f where lower(f) = lower(v.folder_name)) where v.id is not null;
  end if;

  create temp table if not exists _sync_files (
    rel_path text, file_name text, prefix text, title text, session_label text,
    file_size bigint, file_mtime timestamptz, sha256 text, md5 text, vid uuid
  ) on commit drop;
  delete from pg_temp._sync_files where true;
  insert into pg_temp._sync_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime, sha256, md5)
  select case when p_source = 'pc' then x.rel_path else p_source || ':' || x.rel_path end,
         x.file_name, x.prefix, x.title, x.session_label, x.file_size, x.file_mtime,
         lower(nullif(x.sha256, '')), lower(nullif(x.md5, ''))
  from jsonb_to_recordset(p_files) as x(rel_path text, file_name text, prefix text, title text,
                                        session_label text, file_size bigint, file_mtime timestamptz,
                                        sha256 text, md5 text);
  delete from pg_temp._sync_files f where exists (select 1 from public.ignored_paths i where i.rel_path = f.rel_path);

  update pg_temp._sync_files f set vid = (
    select v.id from public.vocalists v
    where lower(v.folder_name) = lower(trim(f.prefix)) or lower(trim(f.prefix)) = any (v.aliases)
    order by (lower(v.folder_name) = lower(trim(f.prefix))) desc limit 1)
  where true;

  if p_archive then
    delete from pg_temp._sync_files where vid is null;
    get diagnostics v_skipped = row_count;
  end if;

  with up as (
    insert into public.songs (vocalist_id, rel_path, file_name, title, session_label, file_size, file_mtime, sort_date, source, paid)
    select vid, rel_path, file_name, title, session_label, file_size, file_mtime, file_mtime, p_source, p_archive
    from pg_temp._sync_files where vid is not null
    on conflict (rel_path) do update set
      file_name = excluded.file_name, file_size = excluded.file_size, file_mtime = excluded.file_mtime,
      missing = false, last_seen = now()
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted) into v_new_songs from up;

  update public.songs s set missing = true
  where s.source = p_source and not s.missing
    and not exists (select 1 from pg_temp._sync_files f where f.rel_path = s.rel_path and f.vid is not null);
  get diagnostics v_missing = row_count;

  -- Kandidat: satu baris per isi file. Hanya untuk program yang sudah mengirim sidik jari.
  if p_device is not null then
    -- Perangkat didaftarkan di sini juga, supaya sync tidak pernah gagal hanya karena
    -- pendaftaran (device_hello) belum sempat terkirim.
    insert into public.devices (id, name, sync_seen) values (p_device, 'Komputer', now())
    on conflict (id) do update set sync_seen = now();

    insert into public.file_candidates (song_id, device_id, source, rel_path, file_name, size_bytes, file_mtime, sha256, md5)
    select s.id, p_device, p_source, f.rel_path, f.file_name, f.file_size, f.file_mtime, f.sha256, f.md5
    from pg_temp._sync_files f
    join public.songs s on s.rel_path = f.rel_path
    where f.vid is not null and f.sha256 is not null and f.md5 is not null
    on conflict (rel_path, sha256) do update set
      song_id = excluded.song_id, device_id = excluded.device_id, file_name = excluded.file_name,
      size_bytes = excluded.size_bytes, file_mtime = excluded.file_mtime, md5 = excluded.md5,
      present = true, last_seen = now();
    get diagnostics v_candidates = row_count;

    -- Kandidat yang isinya sudah tidak ada lagi di sumber ini. File yang sidik jarinya BELUM
    -- sempat dihitung (sha256 null) tidak dianggap hilang.
    update public.file_candidates c set present = false
     where c.source = p_source and c.present
       and not exists (
         select 1 from pg_temp._sync_files f
          where f.rel_path = c.rel_path and (f.sha256 is null or f.sha256 = c.sha256));
  end if;

  delete from public.unmatched_files where source = p_source;
  if not p_archive then
    insert into public.unmatched_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime, source)
    select rel_path, file_name, prefix, title, session_label, file_size, file_mtime, p_source from pg_temp._sync_files where vid is null
    on conflict (rel_path) do nothing;
    get diagnostics v_unmatched = row_count;
  end if;

  if p_source = 'pc' then
    update public.app_settings set last_sync = now(), last_sync_files = jsonb_array_length(p_files) where id = 1;
  end if;
  insert into public.agent_heartbeats (agent, last_seen, info)
  values ('sync:' || p_source, now(), jsonb_build_object('files', jsonb_array_length(p_files), 'new_songs', v_new_songs))
  on conflict (agent) do update set last_seen = now(), info = excluded.info;

  return jsonb_build_object('new_vocalists', v_new_vocalists, 'new_songs', v_new_songs,
    'newly_missing', v_missing, 'unmatched', v_unmatched, 'skipped', v_skipped,
    'candidates', v_candidates, 'files', jsonb_array_length(p_files));
end $function$;
revoke all on function public.sync_files(text, text[], jsonb, text, boolean, uuid) from public;
grant execute on function public.sync_files(text, text[], jsonb, text, boolean, uuid) to anon, authenticated;
