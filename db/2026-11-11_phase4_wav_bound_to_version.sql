-- Fase 4 (11 Nov 2026) — WAV yang dikirim ke Google Drive dijamin file yang difinalisasi admin.
--
-- Sebelumnya agent mencari WAV lewat nama file saja. Kalau file itu dirender ulang antara Accept
-- dan unggah, versi yang salah bisa sampai ke operator tanpa ada yang tahu.
-- Sekarang: sebelum mengunggah, agent menghitung ulang sidik jari file dan membandingkannya dengan
-- sidik jari versi yang di-Accept. Tidak cocok = BERHENTI dan minta admin, bukan dicoba berulang.
--
-- Catatan desain: tidak ada "sewa" (lease) di sini seperti pada tabel jobs, karena pekerjaan WAV
-- sudah terbagi berdasarkan sumber folder (pc & backup di PC, mac di MacBook) sehingga dua komputer
-- tidak pernah memperebutkan pekerjaan yang sama. Penghapusan file Drive boleh dikerjakan komputer
-- mana pun dan memang aman diulang.
alter table public.wav_uploads drop constraint if exists wav_uploads_status_check;
alter table public.wav_uploads add constraint wav_uploads_status_check
  check (status in ('waiting','uploading','complete','failed','cancelled','needs_admin'));

-- Pekerjaan untuk agent: tambah sidik jari yang diharapkan dan daftar tempat lain file itu berada
-- (kalau filenya dipindah tapi isinya sama, agent tetap menemukannya).
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
      'revision', w.revision, 'attempts', w.attempts, 'drive_file_id', w.drive_file_id,
      'version_id', w.version_id, 'expected_sha256', w.expected_sha256,
      -- Tempat lain di sumber yang sama dengan ISI yang persis sama.
      'alt_paths', coalesce((
        select jsonb_agg(distinct c.rel_path) from public.file_candidates c
         where c.sha256 = w.expected_sha256 and c.present
           and public._src_of(c.rel_path) = public._src_of(w.rel_path)
           and c.rel_path <> w.rel_path), '[]'::jsonb))
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

-- Laporan agent: tambah status 'needs_admin' untuk kesalahan yang tidak akan sembuh sendiri.
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
  elsif p_status = 'needs_admin' then
    if w.status = 'cancelled' then return 'cancelled'; end if;
    update public.wav_uploads set status = 'needs_admin', last_error = left(p_error, 500),
           next_attempt_at = null, updated_at = now() where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('wav_needs_admin', p_id, w.song_id, jsonb_build_object('error', left(p_error, 500)));
  elsif p_status = 'failed' then
    if w.status = 'cancelled' then return 'cancelled'; end if;
    update public.wav_uploads set status = 'failed', last_error = left(p_error, 500), updated_at = now(),
      next_attempt_at = now() + make_interval(mins => backoff[least(greatest(attempts, 1), 8)])
    where id = p_id;
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('wav_upload_failed', p_id, w.song_id, jsonb_build_object('error', left(p_error, 500)));
  elsif p_status = 'deleted' then
    if w.status = 'cancelled' or w.cleanup_eligible_at is not null then
      update public.wav_uploads set drive_deleted_at = now(), updated_at = now() where id = p_id;
      insert into public.job_events (kind, upload_id, song_id, detail) values ('wav_drive_deleted', p_id, w.song_id, null);
    end if;
  else
    raise exception 'unknown status';
  end if;
  return (select status from public.wav_uploads where id = p_id);
end $function$;

-- Admin bisa mengulang unggahan yang berhenti, termasuk yang berstatus needs_admin.
create or replace function public.retry_wav(p_song uuid)
 returns int language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  update public.wav_uploads w set status = 'waiting', attempts = 0, last_error = null, next_attempt_at = null, updated_at = now()
    from public.songs s
   where s.id = p_song and w.song_id = s.id and w.revision = s.revision and w.status in ('failed', 'needs_admin');
  get diagnostics n = row_count;
  if n = 0 then raise exception 'no stopped upload for this song'; end if;
  insert into public.job_events (kind, song_id, detail) values ('wav_retry', p_song, null);
  return n;
end $function$;
