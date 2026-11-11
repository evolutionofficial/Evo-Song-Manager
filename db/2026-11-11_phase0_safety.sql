-- Fase 0 (pengaman dasar), 2026-11-11. Lihat docs/IMPLEMENTATION_ROADMAP.md.
-- 1. accept_song: Accept setelah Revision TIDAK lagi langsung memakai file Drive lama (celah G2).
--    Baris kembali ke 'waiting'; agent pemilik file mencari file Drive lewat label evoUploadId dan
--    hanya memakainya lagi kalau MD5-nya sama dengan WAV di komputer saat ini. Kalau beda, file lama
--    dihapus dan WAV yang sekarang diunggah.
-- 2. wav_report: laporan 'deleted' yang datang terlambat (lagu sudah di-Accept lagi) diabaikan;
--    laporan 'complete' membersihkan tanda "sudah dihapus dari Drive".
-- 3. retry_wav: admin bisa mengulang unggahan WAV yang berhenti setelah 8 kali gagal.
create or replace function public.accept_song(p_token text, p_song uuid)
 returns timestamptz language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  update public.songs set accepted_at = coalesce(accepted_at, now()), revision_requested_at = null, revision_note = null
   where id = p_song and vocalist_id = v_id and not deleted
   returning * into s;
  if s.id is null then raise exception 'song not found'; end if;
  insert into public.wav_uploads (song_id, vocalist_id, song_title, revision, rel_path, accepted_at, upload_date)
  values (s.id, s.vocalist_id, s.title, s.revision, s.rel_path, s.accepted_at,
          (s.accepted_at at time zone 'Asia/Jakarta')::date)
  on conflict (song_id, revision) do update set
    status = 'waiting', drive_file_id = null, size_bytes = null, md5 = null, uploaded_at = null,
    drive_deleted_at = null, cleanup_eligible_at = null,
    sent_at = null, downloaded_at = null, download_count = 0,
    attempts = 0, last_error = null, next_attempt_at = null, updated_at = now(),
    accepted_at = excluded.accepted_at, upload_date = excluded.upload_date,
    rel_path = excluded.rel_path, song_title = excluded.song_title
  where public.wav_uploads.status = 'cancelled';
  insert into public.job_events (kind, song_id, detail)
  values ('accept', s.id, jsonb_build_object('revision', s.revision, 'title', s.title));
  return s.accepted_at;
end $function$;

create or replace function public.wav_report(
  p_secret text, p_id uuid, p_status text, p_drive_file_id text, p_size bigint, p_md5 text, p_error text)
 returns text language plpgsql security definer set search_path to ''
as $function$
declare w public.wav_uploads; backoff int[] := array[1, 2, 5, 15, 30, 60, 120, 240];
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  select * into w from public.wav_uploads where id = p_id for update;
  if w.id is null then raise exception 'upload not found'; end if;
  if p_status = 'uploading' then
    if w.status = 'cancelled' then return 'cancelled'; end if;
    update public.wav_uploads set status = 'uploading', attempts = attempts + 1, last_error = null, updated_at = now() where id = p_id;
  elsif p_status = 'complete' then
    update public.wav_uploads set
      status = case when w.status = 'cancelled' then 'cancelled' else 'complete' end,
      drive_file_id = p_drive_file_id, size_bytes = p_size, md5 = p_md5,
      uploaded_at = now(), last_error = null, drive_deleted_at = null, updated_at = now()
    where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('wav_upload', p_id, w.song_id, jsonb_build_object('size', p_size, 'drive_file_id', p_drive_file_id));
    perform public._enforce_wav_limit(w.vocalist_id);
  elsif p_status = 'failed' then
    if w.status = 'cancelled' then return 'cancelled'; end if;
    update public.wav_uploads set status = 'failed', last_error = left(p_error, 500), updated_at = now(),
      next_attempt_at = now() + make_interval(mins => backoff[least(greatest(attempts, 1), 8)])
    where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('wav_upload_failed', p_id, w.song_id, jsonb_build_object('error', left(p_error, 500)));
  elsif p_status = 'deleted' then
    -- Hanya sah untuk baris yang memang diminta dihapus. Kalau lagunya sudah di-Accept lagi,
    -- laporan ini terlambat dan diabaikan.
    if w.status = 'cancelled' or w.cleanup_eligible_at is not null then
      update public.wav_uploads set drive_deleted_at = now(), updated_at = now() where id = p_id;
      insert into public.job_events (kind, upload_id, song_id, detail) values ('wav_drive_deleted', p_id, w.song_id, null);
    end if;
  else
    raise exception 'unknown status';
  end if;
  return (select status from public.wav_uploads where id = p_id);
end $function$;

create or replace function public.retry_wav(p_song uuid)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.wav_uploads w set status = 'waiting', attempts = 0, last_error = null, next_attempt_at = null, updated_at = now()
    from public.songs s
   where s.id = p_song and w.song_id = s.id and w.revision = s.revision and w.status = 'failed';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no failed upload for this song'; end if;
  insert into public.job_events (kind, song_id, detail) values ('wav_retry', p_song, null);
  return n;
end $function$;
revoke all on function public.retry_wav(uuid) from public, anon;
grant execute on function public.retry_wav(uuid) to authenticated;
