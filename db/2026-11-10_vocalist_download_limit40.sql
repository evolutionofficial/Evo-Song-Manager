-- Perubahan aturan (2026-11-10):
-- 1. File di Google Drive dibatasi 40 WAV per vokalis. Saat WAV baru selesai terunggah, WAV paling
--    lama milik vokalis itu (di atas 40) ditandai untuk dihapus; program di PC/Mac menghapusnya.
-- 2. Halaman operator tetap hanya menampilkan lagu terbaru: saat operator pertama kali mengunduh
--    lagu bertanggal D, lagu vokalis yang sama bertanggal < D disembunyikan dari operator
--    (operator_hidden_at) tapi filenya TETAP di Drive untuk vokalis.
-- 3. Vokalis bisa mengunduh WAV lagunya sendiri selama masih di Drive (/vdl/<token>/<idLagu>).
alter table public.wav_uploads add column if not exists operator_hidden_at timestamptz;

create or replace function public._enforce_wav_limit(p_vocalist uuid)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  with ranked as (
    select id, row_number() over (order by upload_date desc, coalesce(uploaded_at, accepted_at) desc) as rn
    from public.wav_uploads
    where vocalist_id = p_vocalist and status = 'complete' and drive_file_id is not null
      and drive_deleted_at is null and cleanup_eligible_at is null)
  update public.wav_uploads w set cleanup_eligible_at = now(), updated_at = now()
    from ranked r where w.id = r.id and r.rn > 40;
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.job_events (kind, detail) values ('wav_limit_cleanup', jsonb_build_object('vocalist', p_vocalist, 'count', n));
  end if;
  return n;
end $function$;
revoke all on function public._enforce_wav_limit(uuid) from public, anon, authenticated;

-- wav_report: setelah upload selesai, terapkan batas 40.
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
      uploaded_at = now(), last_error = null, updated_at = now()
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
    update public.wav_uploads set drive_deleted_at = now(), updated_at = now() where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail) values ('wav_drive_deleted', p_id, w.song_id, null);
  else
    raise exception 'unknown status';
  end if;
  return (select status from public.wav_uploads where id = p_id);
end $function$;

-- Agent: hapus file yang melewati batas 40 (komputer mana pun boleh, karena tidak butuh file lokal),
-- dan file lagu yang di-Revision (oleh komputer sumbernya).
create or replace function public.wav_jobs(p_secret text, p_sources text[])
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id,
      'action', case when w.status = 'cancelled' or w.cleanup_eligible_at is not null then 'delete' else 'upload' end,
      'rel_path', w.rel_path, 'source', public._src_of(w.rel_path),
      'vocalist', v.display_name, 'upload_date', w.upload_date, 'title', w.song_title,
      'revision', w.revision, 'attempts', w.attempts, 'drive_file_id', w.drive_file_id)
      order by w.accepted_at)
    from public.wav_uploads w join public.vocalists v on v.id = w.vocalist_id
    where (
        public._src_of(w.rel_path) = any (p_sources) and (
          (w.status = 'waiting')
          or (w.status = 'failed' and w.attempts < 8 and coalesce(w.next_attempt_at, now()) <= now())
          or (w.status = 'uploading' and w.updated_at < now() - interval '30 minutes')
          or (w.status = 'cancelled' and w.drive_file_id is not null and w.drive_deleted_at is null)))
      or (w.cleanup_eligible_at is not null and w.drive_file_id is not null and w.drive_deleted_at is null)
    ), '[]'::jsonb);
end $function$;

-- Operator: lagu yang disembunyikan (lebih lama dari yang sudah diunduh) tidak ditampilkan.
create or replace function public.get_operator_report(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when not exists (select 1 from public.app_settings where id = 1 and fc_token = p_token and length(p_token) > 0)
    then null else jsonb_build_object('songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'vocalist', v.display_name, 'title', w.song_title, 'date', w.upload_date,
        'session', s.session_label, 'sent_at', w.sent_at, 'downloaded_at', w.downloaded_at,
        'size', w.size_bytes, 'revision', w.revision,
        'file_name', regexp_replace(w.rel_path, '^.*/', ''))
        order by w.sent_at desc)
      from public.wav_uploads w
      join public.vocalists v on v.id = w.vocalist_id
      join public.songs s on s.id = w.song_id
      where w.sent_at is not null and w.status = 'complete' and w.drive_file_id is not null
        and w.drive_deleted_at is null and w.cleanup_eligible_at is null and w.operator_hidden_at is null
        and not s.deleted), '[]'::jsonb))
  end;
$function$;

-- Operator mengunduh: tidak lagi menghapus file dari Drive, hanya menyembunyikan lagu lama dari operator.
create or replace function public.operator_download(p_token text, p_upload uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare w public.wav_uploads; first boolean;
begin
  if not exists (select 1 from public.app_settings where id = 1 and fc_token = p_token and length(p_token) > 0) then
    raise exception 'link not found';
  end if;
  select * into w from public.wav_uploads where id = p_upload for update;
  if w.id is null or w.sent_at is null or w.status <> 'complete' or w.drive_file_id is null
     or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null or w.operator_hidden_at is not null then
    raise exception 'file not available';
  end if;
  first := w.downloaded_at is null;
  update public.wav_uploads set downloaded_at = coalesce(downloaded_at, now()), download_count = download_count + 1, updated_at = now()
   where id = w.id;
  if first then
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('fc_download', w.id, w.song_id, jsonb_build_object('title', w.song_title));
    update public.wav_uploads o set operator_hidden_at = now(), updated_at = now()
     where o.vocalist_id = w.vocalist_id and o.upload_date < w.upload_date and o.operator_hidden_at is null;
  end if;
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''),
    'size', w.size_bytes, 'cleanup', '[]'::jsonb);
end $function$;

-- Vokalis mengunduh WAV lagunya sendiri.
create or replace function public.vocalist_download(p_token text, p_song uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; w public.wav_uploads;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted;
  if s.id is null then raise exception 'file not available'; end if;
  select * into w from public.wav_uploads where song_id = s.id and revision = s.revision;
  if w.id is null or w.status <> 'complete' or w.drive_file_id is null
     or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null then
    raise exception 'file not available';
  end if;
  insert into public.job_events (kind, upload_id, song_id, detail) values ('vocalist_download', w.id, s.id, null);
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''), 'size', w.size_bytes);
end $function$;
revoke all on function public.vocalist_download(text, uuid) from public;
grant execute on function public.vocalist_download(text, uuid) to anon, authenticated;
