-- Fase 13 — Status "Finish" di halaman vokalis.
--
-- Finish berarti DUA-DUANYA sudah terjadi, bukan salah satu:
--   1. operator sudah mengunduh WAV-nya  (wav_uploads.downloaded_at)
--   2. vokalis sudah menyimpan salinannya (vocalist_downloaded_at, kolom baru)
-- Selama salah satunya belum, tombol download vokalis tetap ada.
--
-- Kolomnya menempel di wav_uploads, bukan di songs, supaya revisi baru otomatis mengulang
-- dari nol: baris wav_uploads yang baru belum punya tanda ini, jadi lagu kembali "belum selesai".

alter table public.wav_uploads add column if not exists vocalist_downloaded_at timestamptz;

comment on column public.wav_uploads.vocalist_downloaded_at is
  'Vokalis sudah punya salinan WAV ini. Diisi saat unduhan vokalis berhasil, atau ditandai admin untuk lagu lama yang sudah selesai.';

-- Unduhan vokalis mencatat waktunya, bukan hanya meninggalkan jejak di job_events.
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

  update public.wav_uploads
     set vocalist_downloaded_at = coalesce(vocalist_downloaded_at, now()), updated_at = now()
   where id = w.id;

  insert into public.job_events (kind, upload_id, song_id, detail) values ('vocalist_download', w.id, s.id, null);
  return jsonb_build_object('drive_file_id', w.drive_file_id, 'file_name', regexp_replace(w.rel_path, '^.*/', ''), 'size', w.size_bytes);
end $function$;
revoke all on function public.vocalist_download(text, uuid) from public;
grant execute on function public.vocalist_download(text, uuid) to anon, authenticated;

-- get_vocalist_report: 'vocalist_downloaded_at' membaca kolom baru, dengan jejak lama di
-- job_events sebagai cadangan supaya unduhan yang sudah terjadi tidak kehilangan maknanya.
-- (Definisi lengkapnya diterapkan lewat migrasi phase13_report_vocalist_downloaded;
--  satu-satunya perubahan dari versi sebelumnya ada pada baris coalesce di bawah ini.)
--   'vocalist_downloaded_at', coalesce(w.vocalist_downloaded_at,
--                             (select max(e.at) from public.job_events e
--                               where e.upload_id = w.id and e.kind = 'vocalist_download')),

-- Penandaan satu kali atas permintaan Jeffry: lagu lama yang sudah tuntas ditandai selesai
-- tanpa vokalisnya harus benar-benar mengunduh ulang.
--
-- Himpunannya SENGAJA dibatasi pada "operator sudah mengunduh". Itu bukan tebakan: Jeffry
-- menyebut Guna "dari Beggin sampai Treasure", Keket dan Cia semua, dan Carla kecuali dua
-- lagu yang baru dikirim tapi belum diunduh operator. Keempatnya cocok persis dengan syarat ini.
update public.wav_uploads w
   set vocalist_downloaded_at = coalesce(w.vocalist_downloaded_at, now()), updated_at = now()
  from public.songs s
 where s.id = w.song_id and not s.deleted and w.revision = s.revision
   and w.downloaded_at is not null and w.vocalist_downloaded_at is null;
