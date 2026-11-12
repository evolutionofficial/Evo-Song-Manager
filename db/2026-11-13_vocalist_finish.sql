-- Status "Finish" di halaman vokalis: lagu sudah dikirim ke First Club DAN vokalis sudah
-- mengunduh WAV-nya sendiri lewat tombol unduh (/vdl/...).
--
-- Tidak ada kolom baru: unduhan vokalis sudah dicatat oleh vocalist_download() sebagai event
-- 'vocalist_download' di job_events, jadi riwayat lama otomatis ikut terbaca.
-- get_vocalist_report() hanya ditambah satu kunci: vocalist_downloaded_at (waktu unduhan
-- pertama untuk file lagu yang sekarang; null kalau belum pernah).

create index if not exists job_events_upload_kind_idx
  on public.job_events (upload_id, kind) where upload_id is not null;

create or replace function public.get_vocalist_report(p_token text)
 returns jsonb
 language sql
 stable security definer
 set search_path to ''
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
        'vocalist_downloaded_at', (select max(e.at) from public.job_events e
                                    where e.upload_id = w.id and e.kind = 'vocalist_download'),
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
