-- Fase 12 — Merapikan halaman admin.
--
-- Empat hal, semuanya kecil dan tidak menyentuh audio:
--   1. Nama yang bukan vokalis (misal "Gelfy") bisa disembunyikan permanen dari
--      daftar "Perlu dicek". Disimpan sebagai NAMA, bukan path, supaya file baru
--      dengan nama yang sama juga tidak muncul lagi besok.
--   2. Admin bisa menyingkirkan baris job yang sudah mati dari halaman System.
--   3. Job sisa fitur Finalize ditutup — fiturnya sendiri sudah dihapus.
--   4. Judul: buang akhiran rev / revisi / fix / (New).

-- ─────────────────────────────────────────────────────────── 1. Nama diabaikan

create table if not exists public.ignored_prefixes (
  prefix     text primary key,
  created_at timestamptz not null default now()
);
alter table public.ignored_prefixes enable row level security;
drop policy if exists admin_all on public.ignored_prefixes;
create policy admin_all on public.ignored_prefixes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- sync_files: SATU baris tambahan di bagian unmatched (lihat tanda "FASE 12").
-- Sisanya salinan persis dari fungsi yang sedang berjalan.
create or replace function public.sync_files(p_secret text, p_folders text[], p_files jsonb, p_source text default 'pc'::text, p_archive boolean default false, p_device uuid default null::uuid)
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
    file_size bigint, file_mtime timestamptz, sha256 text, md5 text,
    m4a_name text, m4a_size bigint, m4a_mtime timestamptz, m4a_sha256 text, m4a_md5 text, vid uuid
  ) on commit drop;
  delete from pg_temp._sync_files where true;
  insert into pg_temp._sync_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime,
                                   sha256, md5, m4a_name, m4a_size, m4a_mtime, m4a_sha256, m4a_md5)
  select case when p_source = 'pc' then x.rel_path else p_source || ':' || x.rel_path end,
         x.file_name, x.prefix, x.title, x.session_label, x.file_size, x.file_mtime,
         lower(nullif(x.sha256, '')), lower(nullif(x.md5, '')),
         nullif(x.m4a_name, ''), x.m4a_size, x.m4a_mtime, lower(nullif(x.m4a_sha256, '')), lower(nullif(x.m4a_md5, ''))
  from jsonb_to_recordset(p_files) as x(rel_path text, file_name text, prefix text, title text,
                                        session_label text, file_size bigint, file_mtime timestamptz,
                                        sha256 text, md5 text, m4a_name text, m4a_size bigint,
                                        m4a_mtime timestamptz, m4a_sha256 text, m4a_md5 text);
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

  if p_device is not null then
    insert into public.devices (id, name, sync_seen) values (p_device, 'Komputer', now())
    on conflict (id) do update set sync_seen = now();

    insert into public.file_candidates (song_id, device_id, source, rel_path, file_name, size_bytes, file_mtime,
                                        sha256, md5, m4a_name, m4a_size, m4a_mtime, m4a_sha256, m4a_md5)
    select s.id, p_device, p_source, f.rel_path, f.file_name, f.file_size, f.file_mtime, f.sha256, f.md5,
           f.m4a_name, f.m4a_size, f.m4a_mtime, f.m4a_sha256, f.m4a_md5
    from pg_temp._sync_files f
    join public.songs s on s.rel_path = f.rel_path
    where f.vid is not null and f.sha256 is not null and f.md5 is not null
    on conflict (rel_path, sha256) do update set
      song_id = excluded.song_id, device_id = excluded.device_id, file_name = excluded.file_name,
      size_bytes = excluded.size_bytes, file_mtime = excluded.file_mtime, md5 = excluded.md5,
      m4a_name = excluded.m4a_name, m4a_size = excluded.m4a_size, m4a_mtime = excluded.m4a_mtime,
      m4a_sha256 = excluded.m4a_sha256, m4a_md5 = excluded.m4a_md5,
      present = true, last_seen = now();
    get diagnostics v_candidates = row_count;

    update public.file_candidates c set present = false
     where c.source = p_source and c.present
       and not exists (
         select 1 from pg_temp._sync_files f
          where f.rel_path = c.rel_path and (f.sha256 is null or f.sha256 = c.sha256));
  end if;

  delete from public.unmatched_files where source = p_source;
  if not p_archive then
    insert into public.unmatched_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime, source)
    select f.rel_path, f.file_name, f.prefix, f.title, f.session_label, f.file_size, f.file_mtime, p_source
      from pg_temp._sync_files f
     where f.vid is null
       -- FASE 12: nama yang sudah dinyatakan "bukan vokalis" tidak usah ditanyakan lagi.
       and not exists (select 1 from public.ignored_prefixes ip where ip.prefix = lower(btrim(f.prefix)))
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

-- Admin: sembunyikan / munculkan kembali sebuah nama.
create or replace function public.ignore_prefix(p_prefix text)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare n int; v_p text := lower(btrim(coalesce(p_prefix, '')));
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if v_p = '' then raise exception 'name is empty'; end if;

  insert into public.ignored_prefixes (prefix) values (v_p) on conflict (prefix) do nothing;

  delete from public.unmatched_files u where lower(btrim(u.prefix)) = v_p;
  get diagnostics n = row_count;
  return n;
end $function$;
revoke all on function public.ignore_prefix(text) from public, anon;
grant execute on function public.ignore_prefix(text) to authenticated;

create or replace function public.unignore_prefix(p_prefix text)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from public.ignored_prefixes where prefix = lower(btrim(coalesce(p_prefix, '')));
end $function$;
revoke all on function public.unignore_prefix(text) from public, anon;
grant execute on function public.unignore_prefix(text) to authenticated;

-- ─────────────────────────────────────────── 2. Singkirkan baris job yang mati

create or replace function public.dismiss_job(p_job uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.jobs set status = 'cancelled', updated_at = now()
   where id = p_job and status in ('failed', 'needs_admin');
  if not found then raise exception 'only a failed or stuck job can be dismissed'; end if;
end $function$;
revoke all on function public.dismiss_job(uuid) from public, anon;
grant execute on function public.dismiss_job(uuid) to authenticated;

-- ──────────────────────────────── 3. Tombol Play di admin

-- Lagu mana saja yang benar-benar bisa diputar, menurut aturan yang SAMA dengan yang
-- dipakai halaman vokalis. Sengaja MEMANGGIL get_audio_key, bukan menyalin isinya, supaya
-- tombol Play di admin tidak akan pernah berbeda dengan kenyataan di sisi vokalis.
create or replace function public.admin_playable(p_vocalist uuid)
 returns uuid[] language sql stable security definer set search_path to ''
as $function$
  select case when not public.is_admin() then null else coalesce((
    select array_agg(s.id)
      from public.songs s
      join public.vocalists v on v.id = s.vocalist_id
     where s.vocalist_id = p_vocalist and not s.deleted
       and public.get_audio_key(v.share_token, s.id) is not null), '{}'::uuid[]) end;
$function$;
revoke all on function public.admin_playable(uuid) from public, anon;
grant execute on function public.admin_playable(uuid) to authenticated;

-- ──────────────────────────────── 4. Pembersihan satu kali (sudah dijalankan 13 Nov)

-- a. "Gelfy" bukan vokalis di aplikasi ini.
insert into public.ignored_prefixes (prefix) values ('gelfy') on conflict (prefix) do nothing;
delete from public.unmatched_files where lower(btrim(prefix)) = 'gelfy';

-- b. Job sisa fitur Finalize yang sudah dihapus.
update public.jobs
   set status = 'cancelled', updated_at = now(),
       last_error = left(coalesce(last_error || ' | ', '') || 'ditutup: fitur Finalize sudah dihapus', 500)
 where kind = 'finalize' and status in ('queued', 'running', 'failed', 'needs_admin');

-- c. Carla: versi lama "Zhi Shao Hai You Ni" (26 Okt) dipindah ke trash atas permintaan Jeffry.
--    Soft delete saja - file di komputer utuh, audio di R2 utuh, bisa dikembalikan kapan saja.
update public.songs set deleted = true, deleted_at = now()
 where id = '5228766a-d37b-440c-bd3a-3ca483cfc227' and not deleted;

-- d. Judul: buang akhiran rev / revisi / fix / (New).
--    Punya Cia "Ai Wo de Ren He Wo Ai de Ren revisi" SENGAJA tidak diubah - kata Jeffry
--    itu lagu yang memang berbeda, bukan revisi dari yang satunya.
update public.songs set title = 'Zhi Shao Hai You Ni'                  where id = '60651199-7f5c-41f8-a4ef-17cf75d7d94a';
update public.songs set title = 'Xing Yu Xin Yuan'                     where id = '0cc5e181-c0d2-4c55-aee7-ceebe5c10dc0';
update public.songs set title = 'Bukan Rayuan Gombal'                  where id = 'ad0589c3-8729-494b-ab85-1555b0120430';
update public.songs set title = 'Nothing Gonna Change My Love For You' where id = '5b69bdf9-8885-4abd-ad3c-ce9c1ac9569b';
update public.songs set title = 'Abracadabra'                          where id = '67da98ae-afd9-41a1-b223-1972e827fd3d';
update public.songs set title = 'Swalla'                               where id = '7d2c4fbd-603e-4415-92e6-8ea079b5e13b';

-- e. Cia: dua berkas "Ai Jiang Shan Geng Ai Mei Ren", beda sehari. Kata Jeffry yang (Rvs)
--    yang dipertahankan; yang lama ke trash, judul yang bertahan dibersihkan.
update public.songs set deleted = true, deleted_at = now()
 where id = '8299c9c1-31e5-4476-85a6-059b9ccdd4f7' and not deleted;
update public.songs set title = 'Ai Jiang Shan Geng Ai Mei Ren'
 where id = 'ad8dcb21-4dc4-470a-b37f-b6b069ebb67e';
