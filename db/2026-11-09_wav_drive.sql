-- Tahap 3: upload WAV ke Google Drive setelah Accept.
-- Program di PC/MacBook (Evo Media Agent) mengambil pekerjaan untuk sumber yang ia pegang
-- (pc, backup, mac — dilihat dari awalan rel_path), mengunggah, lalu melapor.
alter table public.wav_uploads add column if not exists next_attempt_at timestamptz;
alter table public.wav_uploads add column if not exists updated_at timestamptz not null default now();

create or replace function public._src_of(p_rel_path text)
 returns text language sql immutable set search_path to ''
as $$ select coalesce(substring(p_rel_path from '^([a-z][a-z0-9-]{0,30}):'), 'pc') $$;

-- Pekerjaan untuk agent: upload (waiting / failed yang sudah waktunya dicoba lagi /
-- uploading yang macet > 30 menit) dan hapus (cancelled yang masih punya file di Drive).
create or replace function public.wav_jobs(p_secret text, p_sources text[])
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'action', case when w.status = 'cancelled' then 'delete' else 'upload' end,
      'rel_path', w.rel_path, 'source', public._src_of(w.rel_path),
      'vocalist', v.display_name, 'upload_date', w.upload_date, 'title', w.song_title,
      'revision', w.revision, 'attempts', w.attempts, 'drive_file_id', w.drive_file_id)
      order by w.accepted_at)
    from public.wav_uploads w join public.vocalists v on v.id = w.vocalist_id
    where public._src_of(w.rel_path) = any (p_sources)
      and (
        (w.status = 'waiting')
        or (w.status = 'failed' and w.attempts < 8 and coalesce(w.next_attempt_at, now()) <= now())
        or (w.status = 'uploading' and w.updated_at < now() - interval '30 minutes')
        or (w.status = 'cancelled' and w.drive_file_id is not null and w.drive_deleted_at is null)
      )), '[]'::jsonb);
end $function$;

-- Laporan agent. p_status: uploading | complete | failed | deleted
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
    -- Kalau sementara itu dibatalkan (Revision), simpan id file supaya dihapus di putaran berikutnya.
    update public.wav_uploads set
      status = case when w.status = 'cancelled' then 'cancelled' else 'complete' end,
      drive_file_id = p_drive_file_id, size_bytes = p_size, md5 = p_md5,
      uploaded_at = now(), last_error = null, updated_at = now()
    where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('wav_upload', p_id, w.song_id, jsonb_build_object('size', p_size, 'drive_file_id', p_drive_file_id));
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

revoke all on function public._src_of(text) from public;
revoke all on function public.wav_jobs(text, text[]) from public;
revoke all on function public.wav_report(text, uuid, text, text, bigint, text, text) from public;
grant execute on function public.wav_jobs(text, text[]) to anon, authenticated;
grant execute on function public.wav_report(text, uuid, text, text, bigint, text, text) to anon, authenticated;

-- Accept lagi setelah Revision pada revisi yang sama: kalau file Drive-nya belum sempat
-- dihapus, langsung dipakai lagi (complete); kalau sudah dihapus, unggah ulang.
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
    status = case when public.wav_uploads.drive_file_id is not null and public.wav_uploads.drive_deleted_at is null
                  then 'complete' else 'waiting' end,
    drive_file_id = case when public.wav_uploads.drive_deleted_at is null then public.wav_uploads.drive_file_id end,
    drive_deleted_at = null,
    attempts = 0, last_error = null, next_attempt_at = null, updated_at = now(),
    accepted_at = excluded.accepted_at, rel_path = excluded.rel_path, song_title = excluded.song_title
  where public.wav_uploads.status = 'cancelled';
  insert into public.job_events (kind, song_id, detail)
  values ('accept', s.id, jsonb_build_object('revision', s.revision, 'title', s.title));
  return s.accepted_at;
end $function$;

-- Laporan vokalis: status WAV untuk revisi yang sedang di-Accept.
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
        'wav', (select w.status from public.wav_uploads w where w.song_id = s.id and w.revision = s.revision),
        'audio', (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                  where a.song_id = s.id and a.revision <= s.revision
                  order by a.revision desc, a.uploaded_at desc limit 1))
        order by s.sort_date nulls last, s.title)
      from public.songs s where s.vocalist_id = v.id and not s.deleted), '[]'::jsonb),
    'all_songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vocalist', v2.display_name, 'mine', v2.id = v.id, 'title', s.title,
        'session', s.session_label, 'mtime', s.sort_date)
        order by v2.display_name, s.sort_date nulls last, s.title)
      from public.songs s join public.vocalists v2 on v2.id = s.vocalist_id where not s.deleted), '[]'::jsonb)
  ) end
  from (select 1) d left join public.vocalists v on v.share_token = p_token;
$function$;
