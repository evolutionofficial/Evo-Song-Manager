-- Fase 5 (11 Nov 2026) — alur Revision yang lengkap.
--
-- Sebelumnya Revision hanya membatalkan Accept dan menghapus file di Drive. Audio lama masih bisa
-- diputar vokalis, WAV lama tetap di folder Mixdown dan bisa tertimpa ekspor berikutnya tanpa jejak,
-- dan lagu yang sudah dikirim masih nongkrong di halaman operator.
--
-- Sekarang satu transaksi mencabut semuanya sekaligus:
--   - lagu masuk status On Revision; Accept dibatalkan
--   - versi aktif dibatalkan → lagu tidak punya versi aktif → putar/unduh/kirim langsung mati
--   - status "sudah dikirim ke FC" dicabut supaya lagunya hilang dari halaman operator
--   - unggahan WAV dibatalkan; file yang sudah telanjur di Drive dipindahkan ke Trash oleh agent
--   - WAV lama di komputer dipindahkan ke folder "Cancel Song" oleh agent
--   - audio lama di R2 dijadwalkan dihapus 24 jam kemudian
--
-- Penghapusan file Drive tetap memakai jalur lama (wav_jobs melihat baris 'cancelled' yang masih
-- punya drive_file_id) supaya tidak ada dua jalur penghapusan yang harus dijaga.

-- Batalkan antrean unggah + cabut status kirim ke FC.
create or replace function public._cancel_wav_upload(p_song uuid, p_revision integer)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  delete from public.wav_uploads w
   where w.song_id = p_song and w.revision = p_revision and w.status in ('waiting','failed','needs_admin')
     and w.drive_file_id is null
     and not exists (select 1 from public.deliveries d where d.upload_id = w.id);
  update public.wav_uploads set status = 'cancelled', sent_at = null, updated_at = now()
   where song_id = p_song and revision = p_revision and status <> 'cancelled';
end $function$;

-- Vokalis menekan Revision.
create or replace function public.request_revision(p_token text, p_song uuid, p_note text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; av public.song_versions;
        v_note text := nullif(left(trim(coalesce(p_note, '')), 500), '');
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted for update;
  if s.id is null then raise exception 'song not found'; end if;

  select * into av from public.song_versions where id = s.active_version_id for update;

  update public.songs set accepted_at = null, revision_requested_at = now(), revision_note = v_note,
         active_version_id = null
   where id = p_song returning * into s;

  perform public._cancel_wav_upload(s.id, s.revision);

  if av.id is not null then
    update public.song_versions
       set status = 'cancelled', cancel_reason = 'revision', ended_at = now(),
           archive_state = case when av.legacy then null else 'pending' end
     where id = av.id;

    -- WAV lama dipindahkan ke "Cancel Song" oleh komputer yang memegangnya.
    -- Versi warisan tidak diarsipkan: file itu masih satu-satunya salinan lagu tersebut.
    if not av.legacy then
      insert into public.jobs (kind, song_id, version_id, target_device, idempotency_key)
      values ('archive_wav', s.id, av.id, av.device_id, 'archive:' || av.id::text)
      on conflict (idempotency_key) do nothing;
    end if;

    -- Audio lama di R2 dibuang belakangan, bukan sekarang, supaya pemutaran yang sedang
    -- berlangsung tidak putus di tengah jalan.
    if av.m4a_key is not null then
      insert into public.jobs (kind, song_id, version_id, idempotency_key, not_before)
      values ('r2_remove', s.id, av.id, 'r2_remove:' || av.id::text, now() + interval '24 hours')
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  insert into public.job_events (kind, song_id, detail)
  values ('revision_request', s.id, jsonb_build_object('revision', s.revision, 'title', s.title,
          'note', v_note, 'version', av.id));
  return jsonb_build_object('revision_requested_at', s.revision_requested_at, 'note', v_note);
end $function$;

-- Selama On Revision, lagu tidak bisa dikirim ke FC.
create or replace function public.send_to_fc(p_token text, p_song uuid)
 returns timestamptz language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; w public.wav_uploads;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted;
  if s.id is null then raise exception 'song not found'; end if;
  if s.revision_requested_at is not null then raise exception 'this song is on revision'; end if;
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

-- Selama On Revision, vokalis tidak bisa mengunduh WAV versi lama.
create or replace function public.vocalist_download(p_token text, p_song uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; w public.wav_uploads;
begin
  select id into v_id from public.vocalists where share_token = p_token and length(p_token) > 0;
  if v_id is null then raise exception 'link not found'; end if;
  select * into s from public.songs where id = p_song and vocalist_id = v_id and not deleted;
  if s.id is null then raise exception 'file not available'; end if;
  if s.revision_requested_at is not null then raise exception 'file not available'; end if;
  select * into w from public.wav_uploads where song_id = s.id and revision = s.revision;
  if w.id is null or w.status <> 'complete' or w.drive_file_id is null
     or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null then
    raise exception 'file not available';
  end if;
  insert into public.job_events (kind, upload_id, song_id, detail) values ('vocalist_download', w.id, s.id, null);
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''), 'size', w.size_bytes);
end $function$;

-- Laporan vokalis: tambahkan penanda status supaya halaman bisa mematikan tombol dengan jelas.
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
        'on_drive', (w.drive_file_id is not null and w.drive_deleted_at is null
                     and w.cleanup_eligible_at is null and s.revision_requested_at is null),
        'sent_at', w.sent_at, 'fc_downloaded_at', w.downloaded_at,
        'audio', coalesce(left(av.m4a_md5, 10),
                 (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                   where a.song_id = s.id and a.revision <= s.revision and s.active_version_id is not null
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

-- job_finish: hasil pekerjaan arsip disalin ke versinya supaya admin bisa melihat statusnya.
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

-- PENTING: jalur cadangan ke audio_files (dipakai lagu warisan) juga harus tertutup saat revisi.
-- Tanpa baris ini, lagu lama tetap bisa diputar vokalis walau versinya sudah dicabut.
create or replace function public.get_audio_key(p_token text, p_song uuid)
 returns text language sql stable security definer set search_path to ''
as $function$
  select coalesce(
    (select v.m4a_key
       from public.vocalists vo
       join public.songs s on s.vocalist_id = vo.id and s.id = p_song
        and not s.deleted and s.revision_requested_at is null
       join public.song_versions v on v.id = s.active_version_id
      where vo.share_token = p_token and length(p_token) > 0 and v.m4a_key is not null),
    (select a.r2_key
       from public.vocalists vo
       join public.songs s on s.vocalist_id = vo.id and s.id = p_song
        and not s.deleted and s.revision_requested_at is null and s.active_version_id is not null
       join public.audio_files a on a.song_id = s.id and a.revision <= s.revision
      where vo.share_token = p_token and length(p_token) > 0
      order by a.revision desc, a.uploaded_at desc limit 1));
$function$;

-- Versi baru aktif = revisi selesai. Tanda revisi dibersihkan di sini secara eksplisit, tidak
-- mengandalkan efek samping trigger songs_clear_revision_flag, supaya niatnya terbaca jelas.
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
  if v.status <> 'finalizing' then return 'stale'; end if;

  select * into old from public.song_versions where song_id = v.song_id and status = 'active' for update;
  if old.id is not null then
    update public.song_versions set status = 'superseded', ended_at = now() where id = old.id;
    if old.m4a_key is not null and old.m4a_key <> p_key then
      insert into public.jobs (kind, song_id, version_id, idempotency_key, not_before)
      values ('r2_remove', v.song_id, old.id, 'r2_remove:' || old.id::text, now() + interval '24 hours')
      on conflict (idempotency_key) do nothing;
    end if;
  end if;

  update public.song_versions set status = 'active', m4a_key = p_key, m4a_md5 = p_md5, m4a_size = p_size,
         activated_at = now() where id = v.id;
  update public.songs
     set active_version_id = v.id, revision = revision + 1, replaced_at = now(),
         revision_requested_at = null, revision_note = null
   where id = v.song_id;
  update public.jobs set status = 'done', stage = 'activated', last_error = null,
         lease_owner = null, lease_until = null, updated_at = now() where id = p_job;
  insert into public.job_events (kind, song_id, detail)
  values ('finalize_done', v.song_id, jsonb_build_object('version', v.id, 'key', p_key, 'size', p_size));
  return 'ok';
end $function$;
