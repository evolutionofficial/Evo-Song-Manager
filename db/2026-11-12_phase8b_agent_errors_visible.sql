-- Halaman System hanya menampilkan versi agen, bukan kesalahannya. Akibatnya agen yang terus
-- gagal sama sekali tidak terlihat: pada 11 Nov agen PC mencatat 10 kegagalan selama berjam-jam
-- dan tidak ada apa pun di halaman System yang menunjukkannya.
--
-- Tiga keterangan ditambahkan per komputer: jumlah kegagalan, jumlah M4A yang terunggah tapi
-- file lokalnya masih terkunci (itu BUKAN kegagalan — lagunya sudah aman), dan kesalahan terakhir.
create or replace function public.system_report()
returns jsonb
language sql stable security definer set search_path to '' as $function$
  select case when not public.is_admin() then null else jsonb_build_object(
    'devices', coalesce((select jsonb_agg(jsonb_build_object(
        'name', d.name, 'platform', d.platform, 'sources', d.sources,
        'sync_seen', d.sync_seen, 'media_seen', d.media_seen,
        'version', d.media_info->>'version',
        'failed', (d.media_info->>'failed')::int,
        'locked', (d.media_info->>'locked')::int,
        'last_error', d.media_info->>'lastError') order by d.name) from public.devices d), '[]'::jsonb),
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
    'wav', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'vocalist', v.display_name,
        'status', w.status, 'error', w.last_error, 'attempts', w.attempts)
        order by w.updated_at)
      from public.wav_uploads w
      join public.songs s on s.id = w.song_id
      join public.vocalists v on v.id = w.vocalist_id
      where w.status = 'needs_admin' or (w.status = 'failed' and w.attempts >= 8)
      ), '[]'::jsonb),
    'audio_missing', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'vocalist', v.display_name, 'since', av.m4a_missing_at))
      from public.song_versions av
      join public.songs s on s.id = av.song_id
      join public.vocalists v on v.id = s.vocalist_id
      where av.status = 'active' and av.m4a_missing_at is not null), '[]'::jsonb),
    'archive_pending', coalesce((select jsonb_agg(jsonb_build_object(
        'song', s.title, 'song_id', s.id, 'state', av.archive_state, 'since', av.ended_at))
      from public.song_versions av join public.songs s on s.id = av.song_id
      where av.archive_state = 'pending' and av.ended_at < now() - interval '1 hour'), '[]'::jsonb),
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
