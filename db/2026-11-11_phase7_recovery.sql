-- Fase 7 (11 Nov 2026) — pemulihan otomatis dan satu halaman untuk melihat kesehatan sistem.
--
-- Sebagian besar pemulihan sudah melekat di tiap pekerja: semuanya aman diulang (cek dulu apakah
-- file sudah ada di R2/Drive sebelum mengunggah), sewa pekerjaan habis sendiri kalau komputernya
-- mati, dan unggahan yang macet lebih dari 30 menit diambil lagi. Yang ditambahkan di sini:
--   1. Pemeriksaan berkala bahwa file yang tercatat ADA benar-benar masih ada di R2 dan Drive.
--      Dibatasi beberapa berkas per putaran supaya tidak membebani layanan; semuanya kebagian
--      secara bergilir.
--   2. Halaman "System" di admin: komputer, pekerjaan macet, dan temuan yang perlu diurus.
alter table public.song_versions add column if not exists verified_at   timestamptz;
alter table public.song_versions add column if not exists m4a_missing_at timestamptz;
alter table public.wav_uploads   add column if not exists verified_at   timestamptz;

-- Agent meminta beberapa berkas untuk diperiksa; yang paling lama tidak diperiksa didahulukan.
create or replace function public.claim_verify(p_secret text, p_device uuid, p_limit int default 20)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_out jsonb; v_n int := greatest(1, least(coalesce(p_limit, 20), 50));
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  with pick_v as (
    select id from public.song_versions
     where status = 'active' and m4a_key is not null
       and (verified_at is null or verified_at < now() - interval '12 hours')
     order by verified_at nulls first limit v_n for update skip locked
  ), upd_v as (
    update public.song_versions v set verified_at = now() from pick_v p where v.id = p.id
    returning v.id, v.m4a_key
  ), pick_w as (
    select id from public.wav_uploads
     where status = 'complete' and drive_file_id is not null and drive_deleted_at is null
       and (verified_at is null or verified_at < now() - interval '12 hours')
     order by verified_at nulls first limit v_n for update skip locked
  ), upd_w as (
    update public.wav_uploads w set verified_at = now() from pick_w p where w.id = p.id
    returning w.id, w.drive_file_id, w.md5, w.size_bytes
  )
  select jsonb_build_object(
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'key', m4a_key)) from upd_v), '[]'::jsonb),
    'uploads', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'drive_file_id', drive_file_id,
                                 'md5', md5, 'size', size_bytes)) from upd_w), '[]'::jsonb))
  into v_out;
  return v_out;
end $function$;
revoke all on function public.claim_verify(text, uuid, int) from public;
grant execute on function public.claim_verify(text, uuid, int) to anon, authenticated;

-- Hasil pemeriksaan. Hanya kepastian yang dicatat: agent melaporkan "hilang" hanya kalau layanan
-- menjawab 404, bukan kalau jaringan sedang bermasalah.
create or replace function public.verify_report(p_secret text, p_device uuid, p_results jsonb)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r jsonb; v_missing int := 0; v_ok int := 0;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb))
  loop
    if (r->>'kind') = 'version' then
      if (r->>'ok')::boolean then
        update public.song_versions set m4a_missing_at = null where id = (r->>'id')::uuid;
        v_ok := v_ok + 1;
      else
        update public.song_versions set m4a_missing_at = coalesce(m4a_missing_at, now())
         where id = (r->>'id')::uuid and status = 'active';
        v_missing := v_missing + 1;
      end if;
    elsif (r->>'kind') = 'upload' then
      if (r->>'ok')::boolean then
        v_ok := v_ok + 1;
      else
        -- File sudah benar-benar tidak ada di Drive: tandai supaya tidak ditawarkan untuk diunduh.
        update public.wav_uploads set drive_deleted_at = now(), updated_at = now()
         where id = (r->>'id')::uuid and drive_deleted_at is null;
        insert into public.job_events (kind, upload_id, detail)
        values ('verify_drive_missing', (r->>'id')::uuid, jsonb_build_object('device', p_device));
        v_missing := v_missing + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('ok', v_ok, 'missing', v_missing);
end $function$;
revoke all on function public.verify_report(text, uuid, jsonb) from public;
grant execute on function public.verify_report(text, uuid, jsonb) to anon, authenticated;

-- Halaman System di admin.
create or replace function public.system_report()
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when not public.is_admin() then null else jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'platform', d.platform, 'sources', d.sources,
        'sync_seen', d.sync_seen, 'media_seen', d.media_seen,
        'version', d.media_info->>'version') order by d.name) from public.devices d), '[]'::jsonb),
    -- Pekerjaan yang butuh perhatian: berhenti, atau tersangkut lebih dari sejam.
    'jobs', coalesce((select jsonb_agg(jsonb_build_object(
        'id', j.id, 'kind', j.kind, 'status', j.status, 'stage', j.stage, 'attempts', j.attempts,
        'error', j.last_error, 'updated_at', j.updated_at,
        'song', s.title, 'song_id', s.id, 'device', d.name)
        order by j.updated_at)
      from public.jobs j
      left join public.songs s on s.id = j.song_id
      left join public.devices d on d.id = j.target_device
      where j.status = 'needs_admin'
         or (j.status in ('queued','running','failed') and j.updated_at < now() - interval '1 hour')
      ), '[]'::jsonb),
    -- Unggahan WAV yang berhenti dan menunggu admin.
    'wav', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'vocalist', v.display_name,
        'status', w.status, 'error', w.last_error, 'attempts', w.attempts)
        order by w.updated_at)
      from public.wav_uploads w
      join public.songs s on s.id = w.song_id
      join public.vocalists v on v.id = w.vocalist_id
      where w.status = 'needs_admin' or (w.status = 'failed' and w.attempts >= 8)
      ), '[]'::jsonb),
    -- Audio yang tercatat ada tapi ternyata sudah tidak ada di R2.
    'audio_missing', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'vocalist', v.display_name, 'since', av.m4a_missing_at))
      from public.song_versions av
      join public.songs s on s.id = av.song_id
      join public.vocalists v on v.id = s.vocalist_id
      where av.status = 'active' and av.m4a_missing_at is not null), '[]'::jsonb),
    -- Arsip Cancel Song yang belum selesai lebih dari sejam.
    'archive_pending', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'state', av.archive_state, 'since', av.ended_at))
      from public.song_versions av join public.songs s on s.id = av.song_id
      where av.archive_state = 'pending' and av.ended_at < now() - interval '1 hour'), '[]'::jsonb),
    -- File sumber yang hilang dari komputer.
    'missing_files', (select count(*) from public.songs where missing and not deleted),
    'counts', jsonb_build_object(
      'songs', (select count(*) from public.songs where not deleted),
      'versions', (select count(*) from public.song_versions where status = 'active'),
      'with_audio', (select count(*) from public.song_versions where status = 'active' and m4a_key is not null),
      'jobs_running', (select count(*) from public.jobs where status in ('queued','running')),
      'verified_12h', (select count(*) from public.song_versions
                        where status = 'active' and verified_at > now() - interval '12 hours'))
  ) end;
$function$;
revoke all on function public.system_report() from public, anon;
grant execute on function public.system_report() to authenticated;
