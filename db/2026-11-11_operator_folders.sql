-- Halaman operator jadi dua bagian (2026-11-11):
-- 1. "New" — lagu yang baru dikirim vokalis (Send to FC) dan BELUM diunduh operator.
-- 2. Folder per vokalis (Carla, Cia, Guna, Keket) — lagu yang SUDAH diunduh operator pindah
--    sendiri ke folder namanya, dan tetap bisa diunduh lagi dari situ.
-- Perubahan aturan: lagu lama vokalis yang sama TIDAK lagi disembunyikan dari operator setelah
-- lagu baru diunduh (operator_hidden_at tidak dipakai untuk menyaring), supaya folder tetap berisi
-- riwayat lagu yang masih ada di Drive. Yang menentukan hilangnya lagu dari folder tetap sama
-- seperti sebelumnya: file sudah dihapus dari Drive (batas 40 per vokalis, atau Revision).
alter table public.wav_uploads add column if not exists operator_hidden_at timestamptz;

-- Laporan operator: tidak lagi menyaring operator_hidden_at. Halaman yang memisahkan
-- "New" dan folder per vokalis memakai downloaded_at.
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
        and not s.deleted), '[]'::jsonb))
  end;
$function$;

-- Operator mengunduh: lagu pindah ke folder vokalisnya (ditandai downloaded_at).
-- Tidak menyembunyikan lagu lama lagi, dan tidak menghapus apa pun dari Drive.
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
     or w.drive_deleted_at is not null or w.cleanup_eligible_at is not null then
    raise exception 'file not available';
  end if;
  first := w.downloaded_at is null;
  update public.wav_uploads set downloaded_at = coalesce(downloaded_at, now()), download_count = download_count + 1, updated_at = now()
   where id = w.id;
  if first then
    insert into public.job_events (kind, upload_id, song_id, detail)
    values ('fc_download', w.id, w.song_id, jsonb_build_object('title', w.song_title));
  end if;
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''),
    'size', w.size_bytes, 'cleanup', '[]'::jsonb);
end $function$;

-- Lagu yang sudah pernah disembunyikan aturan lama dikembalikan supaya muncul di foldernya.
update public.wav_uploads set operator_hidden_at = null where operator_hidden_at is not null;
