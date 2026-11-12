-- FASE 10 — Musnahkan permanen: buang audio di R2 dan file di Google Drive untuk lagu yang
-- sudah dibuang dari daftar.
--
-- Ini satu-satunya jalur di aplikasi yang MENGHANCURKAN data dan tidak bisa dibatalkan, jadi
-- dibuat dua tahap dengan sengaja:
--
--   Tahap 1 — "Remove from list" (sudah ada): lagu hilang dari halaman vokalis tapi SEMUA
--             filenya masih utuh, dan bisa dikembalikan kapan saja.
--   Tahap 2 — purge_song (ini): baru menghapus isinya, dan hanya untuk lagu yang sudah ada di
--             tahap 1. Jadi tidak ada satu klik pun yang bisa langsung memusnahkan lagu aktif.
--
-- File WAV/M4A di komputer Jeffry TIDAK disentuh. Itu miliknya dan sumber aslinya; agen tidak
-- pernah menghapus file sumber di luar jalur arsip yang sudah ada.

-- Pekerjaan penghapusan perlu membawa kunci/ID-nya sendiri: lagu lama menyimpan audionya di
-- audio_files (bukan di song_versions), jadi kuncinya tidak selalu bisa diturunkan dari versi.
alter table public.jobs add column if not exists payload jsonb;
alter table public.songs add column if not exists purged_at timestamptz;

-- ---------------------------------------------------------------------------
-- claim_jobs: ikut mengirim payload supaya agen tahu apa yang harus dihapus.
-- ---------------------------------------------------------------------------
create or replace function public.claim_jobs(p_secret text, p_device uuid, p_kinds text[], p_limit int default 3)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_out jsonb;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  if p_device is null then raise exception 'device id required'; end if;
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
    'archive_path', v.archive_path,
    'payload', u.payload)
    order by u.created_at), '[]'::jsonb) into v_out
  from upd u left join public.song_versions v on v.id = u.version_id;
  return v_out;
end $function$;
revoke all on function public.claim_jobs(text, uuid, text[], int) from public;
grant execute on function public.claim_jobs(text, uuid, text[], int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- purge_song — antrikan penghapusan isi untuk SATU lagu yang sudah dibuang dari daftar.
-- ---------------------------------------------------------------------------
create or replace function public.purge_song(p_song uuid)
returns jsonb
language plpgsql security definer set search_path to '' as $function$
declare
  v_song public.songs;
  v_key text; v_up record;
  v_r2 int := 0; v_drive int := 0;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into v_song from public.songs where id = p_song;
  if v_song.id is null then raise exception 'song not found'; end if;
  -- Pengaman utama: hanya lagu yang SUDAH dibuang dari daftar yang boleh dimusnahkan.
  if not coalesce(v_song.deleted, false) then
    raise exception 'remove the song from the list first';
  end if;

  -- Versi dibatalkan DULU. Agen punya pengaman "jangan hapus audio yang masih dipakai" yang
  -- membaca status versi; tanpa langkah ini pekerjaannya akan dilewati diam-diam dan filenya
  -- tetap ada di R2 padahal aplikasi bilang sudah dihapus.
  update public.song_versions
     set status = 'cancelled', ended_at = coalesce(ended_at, now()),
         cancel_reason = coalesce(cancel_reason, 'song purged')
   where song_id = p_song and status in ('active','finalizing');

  -- Semua kunci R2 milik lagu ini, dari kedua model penyimpanan: song_versions (baru) dan
  -- audio_files (lama). Lagu lama hanya punya yang kedua.
  -- Kunci yang masih dipakai lagu LAIN yang hidup tidak boleh ikut dihapus. Kalau dua lagu
  -- pernah menunjuk objek yang sama, menghapusnya akan membungkam lagu yang tidak diapa-apakan.
  for v_key in
    select distinct t.k from (
      select m4a_key as k from public.song_versions where song_id = p_song and m4a_key is not null
      union
      select r2_key from public.audio_files where song_id = p_song and r2_key is not null
    ) t
    where not exists (
      select 1 from public.song_versions sv2
        join public.songs s2 on s2.id = sv2.song_id
       where sv2.m4a_key = t.k and s2.id <> p_song and not coalesce(s2.deleted, false))
      and not exists (
      select 1 from public.audio_files af2
        join public.songs s2 on s2.id = af2.song_id
       where af2.r2_key = t.k and s2.id <> p_song and not coalesce(s2.deleted, false))
  loop
    insert into public.jobs (kind, song_id, idempotency_key, payload)
    values ('r2_remove', p_song, 'purge_r2:' || v_key,
            jsonb_build_object('key', v_key, 'purge', true))
    on conflict (idempotency_key) do nothing;
    v_r2 := v_r2 + 1;
  end loop;

  -- File di Google Drive yang belum dibuang.
  for v_up in
    select id, drive_file_id from public.wav_uploads
     where song_id = p_song and drive_file_id is not null and drive_deleted_at is null
  loop
    insert into public.jobs (kind, song_id, idempotency_key, payload)
    values ('drive_remove', p_song, 'purge_drive:' || v_up.id::text,
            jsonb_build_object('drive_file_id', v_up.drive_file_id, 'upload_id', v_up.id, 'purge', true))
    on conflict (idempotency_key) do nothing;
    v_drive := v_drive + 1;
  end loop;

  -- Kuncinya dikosongkan sekarang juga, bukan nanti setelah agen selesai. Kalau lagunya
  -- dikembalikan dari "Deleted", tombol putarnya harus jujur bilang tidak ada audio, bukan
  -- menunjuk file yang sudah dihapus. Barisnya sendiri tetap disimpan sebagai sejarah.
  update public.song_versions set m4a_key = null where song_id = p_song;
  update public.audio_files set r2_key = null where song_id = p_song;
  update public.songs set purged_at = now(), active_version_id = null where id = p_song;

  insert into public.job_events (kind, song_id, detail)
  values ('song_purged', p_song, jsonb_build_object('r2', v_r2, 'drive', v_drive, 'title', v_song.title));

  return jsonb_build_object('r2', v_r2, 'drive', v_drive, 'title', v_song.title);
end $function$;

-- ---------------------------------------------------------------------------
-- job_finish — tambahan: drive_remove yang berhasil menandai file Drive-nya sudah hilang,
-- supaya verifikasi berkala tidak mencarinya lagi dan melaporkannya sebagai hilang.
-- ---------------------------------------------------------------------------
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
    if j.kind = 'archive_wav' and j.version_id is not null then
      update public.song_versions
         set archive_state = coalesce(p_result->>'state', 'done'), archive_path = p_result->>'path'
       where id = j.version_id;
    end if;
    if j.kind = 'drive_remove' and (j.payload ? 'upload_id') then
      update public.wav_uploads set drive_deleted_at = now()
       where id = (j.payload->>'upload_id')::uuid;
    end if;
    v_status := 'done';
  elsif p_status = 'needs_admin' then
    update public.jobs set status = 'needs_admin', last_error = left(p_error, 500),
           lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
    update public.song_versions set status = 'failed', cancel_reason = left(p_error, 200), ended_at = now()
     where id = j.version_id and status = 'finalizing';
    if j.kind = 'archive_wav' and j.version_id is not null then
      update public.song_versions set archive_state = 'missing' where id = j.version_id;
    end if;
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

-- ---------------------------------------------------------------------------
-- purge_status — apa yang sudah dimusnahkan dan apa yang masih dikerjakan, untuk halaman admin.
-- ---------------------------------------------------------------------------
create or replace function public.purge_status()
returns jsonb
language sql stable security definer set search_path to '' as $function$
  select case when not public.is_admin() then null else coalesce((
    select jsonb_object_agg(song_id::text, info) from (
      select j.song_id,
             jsonb_build_object(
               'pending', count(*) filter (where j.status in ('queued','running','failed')),
               'done',    count(*) filter (where j.status = 'done'),
               'stuck',   count(*) filter (where j.status = 'needs_admin')) as info
        from public.jobs j
       where j.kind in ('r2_remove','drive_remove') and j.payload ? 'purge'
       group by j.song_id) t
  ), '{}'::jsonb) end;
$function$;

grant execute on function public.purge_song(uuid) to authenticated;
grant execute on function public.purge_status() to authenticated;
