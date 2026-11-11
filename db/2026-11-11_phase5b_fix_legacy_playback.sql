-- Perbaikan (11 Nov 2026) — lagu BARU yang dibuat selagi saklar Manual Finalization masih mati
-- tidak bisa diputar vokalis.
--
-- Penyebabnya syarat "s.active_version_id is not null" yang saya tambahkan pada jalur cadangan
-- ke audio_files. Maksudnya menutup pemutaran saat revisi, padahal itu sudah dijaga oleh
-- "s.revision_requested_at is null". Akibatnya lagu yang diunggah lewat jalur lama — yang menulis
-- audio_files tapi tidak membuat versi — ikut terblokir.
--
-- Syarat itu dibuang. Pemutaran saat revisi tetap tertutup oleh revision_requested_at.
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
        and not s.deleted and s.revision_requested_at is null
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
        'on_drive', (w.drive_file_id is not null and w.drive_deleted_at is null
                     and w.cleanup_eligible_at is null and s.revision_requested_at is null),
        'sent_at', w.sent_at, 'fc_downloaded_at', w.downloaded_at,
        'audio', case when s.revision_requested_at is not null then null else
                 coalesce(left(av.m4a_md5, 10),
                 (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                   where a.song_id = s.id and a.revision <= s.revision
                   order by a.revision desc, a.uploaded_at desc limit 1)) end)
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
