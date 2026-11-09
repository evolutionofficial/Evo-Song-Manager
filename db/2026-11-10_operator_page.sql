-- Halaman operator FC: lagu muncul setelah vokalis menekan Send to FC, diunduh langsung dari
-- Google Drive lewat server Cloudflare. Pembersihan (opsi B): saat operator PERTAMA kali mengunduh
-- lagu bertanggal D milik vokalis V, semua WAV V di Drive dengan tanggal < D dihapus dari Drive.
-- Lagu bertanggal sama tetap disimpan. WAV asli di komputer tidak pernah dihapus.
alter table public.app_settings add column if not exists fc_token text
  not null default encode(gen_random_bytes(18), 'hex');
alter table public.wav_uploads add column if not exists sent_at timestamptz;
alter table public.wav_uploads add column if not exists downloaded_at timestamptz;
alter table public.wav_uploads add column if not exists download_count int not null default 0;

-- Vokalis: Send to FC (lagu harus sudah di-Accept dan WAV-nya sudah ada di Drive).
create or replace function public.send_to_fc(p_token text, p_song uuid)
 returns timestamptz language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; w public.wav_uploads;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted;
  if s.id is null then raise exception 'song not found'; end if;
  if s.accepted_at is null then raise exception 'accept the song first'; end if;
  select * into w from public.wav_uploads where song_id = s.id and revision = s.revision for update;
  if w.id is null or w.status <> 'complete' or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null then
    raise exception 'the file is not ready yet';
  end if;
  update public.wav_uploads set sent_at = coalesce(sent_at, now()), updated_at = now() where id = w.id returning * into w;
  insert into public.job_events (kind, upload_id, song_id, detail)
  values ('send_to_fc', w.id, s.id, jsonb_build_object('revision', s.revision, 'title', s.title));
  return w.sent_at;
end $function$;

-- Operator: daftar lagu yang bisa diunduh.
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
        and w.drive_deleted_at is null and w.cleanup_eligible_at is null and not s.deleted), '[]'::jsonb))
  end;
$function$;

-- Server unduhan (Cloudflare): cek token + lagu, catat unduhan, dan kembalikan daftar file lama
-- yang harus dihapus dari Drive (aturan pembersihan opsi B).
create or replace function public.operator_download(p_token text, p_upload uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare w public.wav_uploads; first boolean; v_clean jsonb := '[]'::jsonb;
begin
  if not exists (select 1 from public.app_settings where id = 1 and fc_token = p_token and length(p_token) > 0) then
    raise exception 'link not found';
  end if;
  select * into w from public.wav_uploads where id = p_upload for update;
  if w.id is null or w.sent_at is null or w.status <> 'complete' or w.drive_file_id is null
     or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null then
    raise exception 'file not available';
  end if;
  first := w.downloaded_at is null;
  update public.wav_uploads set downloaded_at = coalesce(downloaded_at, now()), download_count = download_count + 1, updated_at = now()
   where id = w.id;
  if first then
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('fc_download', w.id, w.song_id, jsonb_build_object('title', w.song_title));
    with old as (
      update public.wav_uploads o set cleanup_eligible_at = now(), updated_at = now()
       where o.vocalist_id = w.vocalist_id and o.upload_date < w.upload_date
         and o.drive_file_id is not null and o.drive_deleted_at is null and o.cleanup_eligible_at is null
         and o.status in ('complete', 'cancelled')
      returning o.id, o.drive_file_id, o.song_title)
    select coalesce(jsonb_agg(jsonb_build_object('id', id, 'drive_file_id', drive_file_id, 'title', song_title)), '[]'::jsonb)
      into v_clean from old;
  end if;
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''),
    'size', w.size_bytes, 'cleanup', v_clean);
end $function$;

-- Server unduhan: laporan file lama yang sudah dihapus dari Drive.
create or replace function public.cleanup_done(p_token text, p_ids uuid[])
 returns int language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  if not exists (select 1 from public.app_settings where id = 1 and fc_token = p_token and length(p_token) > 0) then
    raise exception 'link not found';
  end if;
  update public.wav_uploads set drive_deleted_at = now(), updated_at = now()
   where id = any (p_ids) and cleanup_eligible_at is not null and drive_deleted_at is null;
  get diagnostics n = row_count;
  insert into public.job_events (kind, detail) values ('wav_cleanup', jsonb_build_object('count', n));
  return n;
end $function$;

revoke all on function public.send_to_fc(text, uuid) from public;
revoke all on function public.get_operator_report(text) from public;
revoke all on function public.operator_download(text, uuid) from public;
revoke all on function public.cleanup_done(text, uuid[]) from public;
grant execute on function public.send_to_fc(text, uuid) to anon, authenticated;
grant execute on function public.get_operator_report(text) to anon, authenticated;
grant execute on function public.operator_download(text, uuid) to anon, authenticated;
grant execute on function public.cleanup_done(text, uuid[]) to anon, authenticated;

-- Agent di PC/Mac: cadangan pembersihan (kalau penghapusan dari Cloudflare gagal),
-- dan tetap menghapus file lagu yang di-Revision.
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
    where public._src_of(w.rel_path) = any (p_sources)
      and (
        (w.status = 'waiting')
        or (w.status = 'failed' and w.attempts < 8 and coalesce(w.next_attempt_at, now()) <= now())
        or (w.status = 'uploading' and w.updated_at < now() - interval '30 minutes')
        or ((w.status = 'cancelled' or w.cleanup_eligible_at < now() - interval '10 minutes')
            and w.drive_file_id is not null and w.drive_deleted_at is null)
      )), '[]'::jsonb);
end $function$;

-- Laporan vokalis: status kirim ke FC.
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
        'audio', (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                  where a.song_id = s.id and a.revision <= s.revision
                  order by a.revision desc, a.uploaded_at desc limit 1))
        order by s.sort_date nulls last, s.title)
      from public.songs s
      left join public.wav_uploads w on w.song_id = s.id and w.revision = s.revision
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

-- Accept lagi setelah Revision (revisi sama): status kirim ke FC direset.
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
                       and public.wav_uploads.cleanup_eligible_at is null
                  then 'complete' else 'waiting' end,
    drive_file_id = case when public.wav_uploads.drive_deleted_at is null and public.wav_uploads.cleanup_eligible_at is null
                         then public.wav_uploads.drive_file_id end,
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
