-- Fase 3 (Manual Finalization), 2026-11-11.
-- Mendeteksi file TIDAK lagi memicu upload. Upload M4A ke R2 hanya berjalan setelah admin memilih
-- satu kandidat dan menekan "Selesaikan & Upload". M4A dirender Jeffry bersama WAV dari Studio One
-- (keputusan K1), jadi sistem tidak mengonversi apa pun — hanya mengunggah M4A yang sudah ada.
-- Semua perilaku baru dijaga saklar app_settings.manual_finalization (default mati).

-- 1. Kandidat menyimpan sidik jari M4A pasangannya.
alter table public.file_candidates
  add column if not exists m4a_name   text,
  add column if not exists m4a_size   bigint,
  add column if not exists m4a_mtime  timestamptz,
  add column if not exists m4a_sha256 text,
  add column if not exists m4a_md5    text;

drop function if exists public.sync_files(text, text[], jsonb, text, boolean, uuid);
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

-- 2. Versi menyimpan nama + sidik jari M4A yang DIHARAPKAN (diisi saat finalisasi dimulai).
--    m4a_md5 diisi belakangan, setelah file benar-benar terverifikasi ada di R2.
alter table public.song_versions
  add column if not exists m4a_name   text,
  add column if not exists m4a_sha256 text;

-- 3. Admin: daftar kandidat satu lagu.
create or replace function public.list_candidates(p_song uuid)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when not public.is_admin() then null else coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'file_name', c.file_name, 'rel_path', c.rel_path, 'source', c.source,
      'device', d.name, 'device_id', c.device_id,
      'size', c.size_bytes, 'mtime', c.file_mtime, 'sha256', c.sha256, 'present', c.present,
      'm4a_name', c.m4a_name, 'm4a_size', c.m4a_size, 'm4a_mtime', c.m4a_mtime,
      -- M4A jauh lebih lama dari WAV = kemungkinan hanya WAV yang dirender ulang (K10)
      'm4a_stale', (c.m4a_mtime is not null and c.file_mtime - c.m4a_mtime > interval '2 minutes'),
      'active', (c.sha256 = v.sha256 and v.status = 'active'),
      'finalizing', (c.sha256 = f.sha256))
      order by c.present desc, c.file_mtime desc)
    from public.file_candidates c
    left join public.devices d on d.id = c.device_id
    left join public.song_versions v on v.song_id = c.song_id and v.status = 'active'
    left join public.song_versions f on f.song_id = c.song_id and f.status = 'finalizing'
    where c.song_id = p_song), '[]'::jsonb) end;
$function$;
revoke all on function public.list_candidates(uuid) from public, anon;
grant execute on function public.list_candidates(uuid) to authenticated;

-- 4. Admin menekan "Selesaikan & Upload". Idempoten: klik dua kali, request ganda, atau dua tab
--    menghasilkan pekerjaan yang sama, bukan upload kedua.
create or replace function public.finalize_song(p_song uuid, p_candidate uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.songs; c public.file_candidates; v public.song_versions; j public.jobs; v_id uuid; v_key text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into s from public.songs where id = p_song for update;
  if s.id is null or s.deleted then raise exception 'song not found'; end if;
  select * into c from public.file_candidates where id = p_candidate and song_id = p_song;
  if c.id is null then raise exception 'file not found for this song'; end if;
  if not c.present then raise exception 'that file is no longer on the computer'; end if;
  if c.m4a_name is null or c.m4a_sha256 is null then
    raise exception 'there is no M4A next to this WAV — render both from the DAW, then try again';
  end if;

  -- Sudah aktif dengan isi yang sama → tidak ada yang perlu dikerjakan.
  select * into v from public.song_versions where song_id = p_song and sha256 = c.sha256 and status = 'active';
  if v.id is not null then
    return jsonb_build_object('state', 'already_active', 'version', v.id);
  end if;
  -- Sedang difinalisasi dengan isi yang sama → kembalikan pekerjaan yang sudah ada.
  select * into v from public.song_versions where song_id = p_song and sha256 = c.sha256 and status = 'finalizing';
  if v.id is not null then
    select * into j from public.jobs where version_id = v.id and kind = 'finalize';
    return jsonb_build_object('state', 'already_running', 'version', v.id, 'job', j.id);
  end if;
  -- Finalisasi lain sedang berjalan untuk lagu ini.
  if exists (select 1 from public.song_versions where song_id = p_song and status = 'finalizing') then
    raise exception 'another file for this song is still being finalized; cancel it first';
  end if;
  if s.accepted_at is not null then
    raise exception 'the vocalist accepted this song (locked); unlock it first';
  end if;

  insert into public.song_versions (song_id, version_no, candidate_id, device_id, source, rel_path,
    file_name, size_bytes, sha256, md5, status, m4a_name, m4a_sha256)
  values (p_song,
    (select coalesce(max(version_no), 0) + 1 from public.song_versions where song_id = p_song),
    c.id, c.device_id, c.source, c.rel_path, c.file_name, c.size_bytes, c.sha256, c.md5,
    'finalizing', c.m4a_name, c.m4a_sha256)
  returning id into v_id;

  v_key := 'finalize:' || v_id::text;
  insert into public.jobs (kind, song_id, version_id, target_device, idempotency_key)
  values ('finalize', p_song, v_id, c.device_id, v_key)
  on conflict (idempotency_key) do update set updated_at = now()
  returning * into j;

  insert into public.job_events (kind, song_id, detail)
  values ('finalize_start', p_song, jsonb_build_object('version', v_id, 'file', c.file_name, 'sha', left(c.sha256, 12)));
  return jsonb_build_object('state', 'queued', 'version', v_id, 'job', j.id);
end $function$;
revoke all on function public.finalize_song(uuid, uuid) from public, anon;
grant execute on function public.finalize_song(uuid, uuid) to authenticated;

-- 5. Admin: batalkan / coba lagi.
create or replace function public.cancel_finalize(p_song uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v public.song_versions;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into v from public.song_versions where song_id = p_song and status = 'finalizing' for update;
  if v.id is null then raise exception 'nothing is being finalized for this song'; end if;
  update public.song_versions set status = 'cancelled', cancel_reason = 'admin', ended_at = now() where id = v.id;
  update public.jobs set status = 'cancelled', updated_at = now()
   where version_id = v.id and kind = 'finalize' and status in ('queued','running','failed','needs_admin');
  insert into public.job_events (kind, song_id, detail) values ('finalize_cancel', p_song, jsonb_build_object('version', v.id));
end $function$;
revoke all on function public.cancel_finalize(uuid) from public, anon;
grant execute on function public.cancel_finalize(uuid) to authenticated;

create or replace function public.retry_job(p_job uuid)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.jobs set status = 'queued', attempts = 0, last_error = null, next_attempt_at = null,
         lease_owner = null, lease_until = null, updated_at = now()
   where id = p_job and status in ('failed','needs_admin');
  if not found then raise exception 'this job cannot be retried'; end if;
end $function$;
revoke all on function public.retry_job(uuid) from public, anon;
grant execute on function public.retry_job(uuid) to authenticated;

-- 6. Agent mengambil pekerjaan. Kunci berupa "sewa" (lease) di database, bukan kunci lokal di
--    komputer, supaya dua komputer tidak pernah mengerjakan pekerjaan yang sama.
create or replace function public.claim_jobs(p_secret text, p_device uuid, p_kinds text[], p_limit int default 3)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_out jsonb;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  if p_device is null then raise exception 'device id required'; end if;
  -- CTE yang mengubah data harus berada di tingkat teratas, jadi hasilnya diambil dengan SELECT ... INTO.
  with pick as (
    select j.id from public.jobs j
    where j.kind = any (coalesce(p_kinds, array['finalize','archive_wav','drive_remove','r2_remove']))
      and j.status in ('queued','running','failed')
      and (j.target_device is null or j.target_device = p_device)
      and coalesce(j.next_attempt_at, now()) <= now()
      and coalesce(j.not_before, now()) <= now()
      and (j.lease_until is null or j.lease_until < now() or j.lease_owner = p_device)
      and j.attempts < 8
    order by j.created_at
    limit greatest(1, least(coalesce(p_limit, 3), 10))
    for update skip locked
  ), upd as (
    update public.jobs j
       set status = 'running', lease_owner = p_device, lease_until = now() + interval '5 minutes',
           attempts = j.attempts + 1, updated_at = now()
      from pick where j.id = pick.id
    returning j.*
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', u.id, 'kind', u.kind, 'stage', u.stage, 'attempts', u.attempts,
    'song_id', u.song_id, 'version_id', u.version_id,
    'source', v.source, 'rel_path', v.rel_path, 'file_name', v.file_name,
    'size', v.size_bytes, 'sha256', v.sha256,
    'm4a_name', v.m4a_name, 'm4a_sha256', v.m4a_sha256,
    'm4a_key', coalesce(v.m4a_key, 'm4a/' || u.song_id::text || '/' || u.version_id::text || '.m4a'),
    'archive_path', v.archive_path)
    order by u.created_at), '[]'::jsonb) into v_out
  from upd u left join public.song_versions v on v.id = u.version_id;
  return v_out;
end $function$;
revoke all on function public.claim_jobs(text, uuid, text[], int) from public;
grant execute on function public.claim_jobs(text, uuid, text[], int) to anon, authenticated;

-- 7. Agent melaporkan kemajuan dan memperpanjang sewa. Kalau sewanya sudah diambil komputer lain,
--    jawabannya 'lost' dan agent berhenti supaya tidak ada pekerjaan ganda.
create or replace function public.job_progress(p_secret text, p_device uuid, p_job uuid, p_stage text, p_lease int default 300)
 returns text language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  update public.jobs set stage = coalesce(p_stage, stage), updated_at = now(),
         lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease, 300), 1800)))
   where id = p_job and lease_owner = p_device and lease_until > now() and status = 'running';
  if not found then return 'lost'; end if;
  return (select coalesce(v.status, 'ok') from public.jobs j left join public.song_versions v on v.id = j.version_id where j.id = p_job);
end $function$;
revoke all on function public.job_progress(text, uuid, uuid, text, int) from public;
grant execute on function public.job_progress(text, uuid, uuid, text, int) to anon, authenticated;

-- 8. Agent menutup pekerjaan. Kesalahan yang tidak akan sembuh sendiri (file hilang, sidik jari
--    berbeda, M4A tidak ada) langsung needs_admin, tidak dicoba berulang kali.
create or replace function public.job_finish(
  p_secret text, p_device uuid, p_job uuid, p_status text, p_result jsonb, p_error text)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare j public.jobs; backoff int[] := array[1, 2, 5, 15, 30, 60, 120, 240]; v_status text;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'job not found'; end if;
  if j.lease_owner is distinct from p_device then return 'lost'; end if;
  if j.status = 'cancelled' then return 'cancelled'; end if;

  if p_status = 'done' then
    update public.jobs set status = 'done', last_error = null, result = p_result,
           lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
    v_status := 'done';
  elsif p_status = 'needs_admin' then
    update public.jobs set status = 'needs_admin', last_error = left(p_error, 500),
           lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
    update public.song_versions set status = 'failed', cancel_reason = left(p_error, 200), ended_at = now()
     where id = j.version_id and status = 'finalizing';
    v_status := 'needs_admin';
  else
    if j.attempts >= 8 then
      update public.jobs set status = 'needs_admin', last_error = left(p_error, 500),
             lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
      update public.song_versions set status = 'failed', cancel_reason = 'too many failures', ended_at = now()
       where id = j.version_id and status = 'finalizing';
      v_status := 'needs_admin';
    else
      update public.jobs set status = 'failed', last_error = left(p_error, 500),
             next_attempt_at = now() + make_interval(mins => backoff[least(greatest(j.attempts, 1), 8)]),
             lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
      v_status := 'failed';
    end if;
  end if;
  insert into public.job_events (kind, song_id, detail)
  values ('job_' || v_status, j.song_id, jsonb_build_object('job', p_job, 'kind', j.kind, 'error', left(p_error, 300)));
  return v_status;
end $function$;
revoke all on function public.job_finish(text, uuid, uuid, text, jsonb, text) from public;
grant execute on function public.job_finish(text, uuid, uuid, text, jsonb, text) to anon, authenticated;

-- 9. Puncak finalisasi: satu transaksi yang menjadikan versi baru aktif. Dijalankan agent HANYA
--    setelah file di R2 terbukti ada dengan ukuran dan MD5 yang benar.
create or replace function public.activate_version(
  p_secret text, p_device uuid, p_job uuid, p_key text, p_md5 text, p_size bigint)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare j public.jobs; v public.song_versions; old public.song_versions;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  select * into j from public.jobs where id = p_job for update;
  if j.id is null then raise exception 'job not found'; end if;
  if j.lease_owner is distinct from p_device then return 'lost'; end if;
  select * into v from public.song_versions where id = j.version_id for update;
  if v.id is null then raise exception 'version not found'; end if;
  -- Dibatalkan admin saat agent sedang mengunggah → file yang baru diunggah harus dibuang.
  if v.status <> 'finalizing' then return 'stale'; end if;

  select * into old from public.song_versions where song_id = v.song_id and status = 'active' for update;
  if old.id is not null then
    update public.song_versions set status = 'superseded', ended_at = now() where id = old.id;
    -- Objek R2 lama dihapus belakangan (24 jam), bukan sekarang.
    if old.m4a_key is not null and old.m4a_key <> p_key then
      insert into public.jobs (kind, song_id, version_id, idempotency_key, not_before)
      values ('r2_remove', v.song_id, old.id, 'r2_remove:' || old.id::text, now() + interval '24 hours')
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  update public.song_versions set status = 'active', m4a_key = p_key, m4a_md5 = p_md5, m4a_size = p_size,
         activated_at = now() where id = v.id;
  update public.songs set active_version_id = v.id, revision = revision + 1, replaced_at = now()
   where id = v.song_id;
  update public.jobs set status = 'done', stage = 'activated', last_error = null,
         lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
  insert into public.job_events (kind, song_id, detail)
  values ('finalize_done', v.song_id, jsonb_build_object('version', v.id, 'key', p_key, 'size', p_size));
  return 'ok';
end $function$;
revoke all on function public.activate_version(text, uuid, uuid, text, text, bigint) from public;
grant execute on function public.activate_version(text, uuid, uuid, text, text, bigint) to anon, authenticated;

-- 10. Yang didengar vokalis selalu berasal dari VERSI AKTIF. Lagu warisan yang belum punya versi
--     tetap memakai audio_files seperti sebelumnya, jadi tidak ada yang berubah bagi vokalis.
create or replace function public.get_audio_key(p_token text, p_song uuid)
 returns text language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select v.m4a_key
       from public.vocalists vo
       join public.songs s on s.vocalist_id = vo.id and s.id = p_song and not s.deleted
       join public.song_versions v on v.id = s.active_version_id
      where vo.share_token = p_token and length(p_token) > 0 and v.m4a_key is not null),
    (select a.r2_key
       from public.vocalists vo
       join public.songs s on s.vocalist_id = vo.id and s.id = p_song and not s.deleted
       join public.audio_files a on a.song_id = s.id and a.revision <= s.revision
      where vo.share_token = p_token and length(p_token) > 0
      order by a.revision desc, a.uploaded_at desc limit 1));
$function$;

create or replace function public.get_vocalist_report(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when v.id is null then null else jsonb_build_object(
    'name', v.display_name,
    'photo', v.photo_path,
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'session', s.session_label, 'mtime', s.sort_date,
        'price', s.price, 'paid', s.paid, 'paid_at', s.paid_at, 'revision', s.revision,
        'accepted_at', s.accepted_at, 'revision_requested_at', s.revision_requested_at,
        'wav', w.status,
        'on_drive', (w.drive_file_id is not null and w.drive_deleted_at is null and w.cleanup_eligible_at is null),
        'sent_at', w.sent_at, 'fc_downloaded_at', w.downloaded_at,
        'audio', coalesce(left(av.m4a_md5, 10),
                 (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                   where a.song_id = s.id and a.revision <= s.revision
                   order by a.revision desc, a.uploaded_at desc limit 1)))
        order by s.sort_date nulls last, s.title)
      from public.songs s
      left join public.wav_uploads w on w.song_id = s.id and w.revision = s.revision
      left join public.song_versions av on av.id = s.active_version_id
      where s.vocalist_id = v.id and not s.deleted), '[]'::jsonb),
    'all_songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vocalist', v2.display_name, 'mine', v2.id = v.id, 'title', s.title,
        'session', s.session_label, 'mtime', s.sort_date)
        order by v2.display_name, s.sort_date nulls last, s.title)
      from public.songs s join public.vocalists v2 on v2.id = s.vocalist_id where not s.deleted), '[]'::jsonb)
  ) end
  from (select 1) d left join public.vocalists v on v.share_token = p_token;
$function$;

-- 11. Saat saklar menyala, lagu yang belum difinalisasi tidak bisa di-Accept.
create or replace function public.accept_song(p_token text, p_song uuid)
 returns timestamptz language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; v_manual boolean;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted for update;
  if s.id is null then raise exception 'song not found'; end if;
  select manual_finalization into v_manual from public.app_settings where id = 1;
  if coalesce(v_manual, false) and s.active_version_id is null then
    raise exception 'this song is not ready yet';
  end if;

  update public.songs set accepted_at = coalesce(accepted_at, now()), revision_requested_at = null, revision_note = null
   where id = p_song returning * into s;
  insert into public.wav_uploads (song_id, vocalist_id, song_title, revision, rel_path, accepted_at, upload_date,
                                  version_id, expected_sha256, device_id)
  select s.id, s.vocalist_id, s.title, s.revision, s.rel_path, s.accepted_at,
         (s.accepted_at at time zone 'Asia/Jakarta')::date, av.id, av.sha256, av.device_id
    from (select 1) x left join public.song_versions av on av.id = s.active_version_id
  on conflict (song_id, revision) do update set
    status = 'waiting', drive_file_id = null, size_bytes = null, md5 = null, uploaded_at = null,
    drive_deleted_at = null, cleanup_eligible_at = null,
    sent_at = null, downloaded_at = null, download_count = 0,
    attempts = 0, last_error = null, next_attempt_at = null, updated_at = now(),
    accepted_at = excluded.accepted_at, upload_date = excluded.upload_date,
    rel_path = excluded.rel_path, song_title = excluded.song_title,
    version_id = excluded.version_id, expected_sha256 = excluded.expected_sha256, device_id = excluded.device_id
  where public.wav_uploads.status = 'cancelled';
  insert into public.job_events (kind, song_id, detail)
  values ('accept', s.id, jsonb_build_object('revision', s.revision, 'title', s.title));
  return s.accepted_at;
end $function$;

-- 12. Pengaturan yang perlu diketahui agent.
create or replace function public.agent_config(p_secret text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  return (select jsonb_build_object('manual_finalization', coalesce(manual_finalization, false))
            from public.app_settings where id = 1);
end $function$;
revoke all on function public.agent_config(text) from public;
grant execute on function public.agent_config(text) to anon, authenticated;
