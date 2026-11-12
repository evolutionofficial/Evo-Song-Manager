-- Laporan operator: tambah daftar lagu yang filenya sudah dibersihkan dari Drive (batas 40 per vokalis).
-- Sudah diterapkan ke Supabase sebagai migrasi `operator_report_expired_songs` (13 Nov 2026).
-- Daftar 'songs' dan 'vocalists' TIDAK berubah, jadi halaman operator yang lama tetap berjalan seperti biasa.
-- 'expired_songs' hanya berisi judul untuk ditampilkan di folder vokalis; filenya tidak bisa diunduh lagi.
-- Halaman operator memakainya di web/js/apps/operator/main.js (label Expired, tanpa tombol Download).
create or replace function public.get_operator_report(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when not exists (select 1 from public.app_settings where id = 1 and fc_token = p_token and length(p_token) > 0)
    then null else jsonb_build_object(
      'vocalists', coalesce((select jsonb_agg(v.display_name order by v.display_name) from public.vocalists v), '[]'::jsonb),
      'songs', coalesce((
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
        and w.drive_deleted_at is null and w.cleanup_eligible_at is null
        and not s.deleted), '[]'::jsonb),
      'expired_songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', w.id, 'vocalist', v.display_name, 'title', w.song_title, 'date', w.upload_date,
        'session', s.session_label, 'sent_at', w.sent_at, 'downloaded_at', w.downloaded_at,
        'size', w.size_bytes, 'revision', w.revision,
        'file_name', regexp_replace(w.rel_path, '^.*/', ''),
        'expired_at', coalesce(w.drive_deleted_at, w.cleanup_eligible_at))
        order by w.sent_at desc)
      from public.wav_uploads w
      join public.vocalists v on v.id = w.vocalist_id
      join public.songs s on s.id = w.song_id
      where w.sent_at is not null and w.status = 'complete'
        and (w.drive_deleted_at is not null or w.cleanup_eligible_at is not null)
        and not s.deleted), '[]'::jsonb))
  end;
$function$;
