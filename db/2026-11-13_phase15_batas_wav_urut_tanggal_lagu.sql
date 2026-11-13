-- Fase 15 — Penghapusan WAV dari Google Drive diurutkan memakai TANGGAL LAGU.
--
-- Batas 40 WAV per vokalis tetap. Yang berubah hanya urutan siapa yang dihapus duluan:
-- sekarang songs.sort_date, tanggal yang sama dengan yang dipakai aplikasi untuk mengurutkan
-- daftar lagu. Jadi urutan penghapusan sama dengan urutan yang Jeffry lihat di layar —
-- yang terlama dihapus duluan.
--
-- Sebelumnya memakai wav_uploads.upload_date, yaitu kapan WAV-nya naik ke Drive. Itu keliru:
-- saat ratusan WAV lama diunggah ulang sekaligus, upload_date-nya menjadi hari itu semua,
-- sehingga lagu yang benar-benar baru justru tenggelam ke dasar dan dihapus duluan.
-- "Emang Dasar" dan "The Way You Look At Me" sudah berada di urutan 41 dan 42 saat ditemukan;
-- dengan urutan baru keduanya menjadi 1 dan 2.
--
-- session_label sengaja TIDAK dipakai walau itu yang tampil di layar: isinya teks nama folder
-- tanpa tahun ("1 Okt"), dan kadang tidak cocok dengan tanggal filenya — "Beggin" berlabel
-- 1 Okt padahal filenya 5 Nov. sort_date adalah tanggal asli di baliknya.
--
-- Aturan fase 14 tetap berlaku: WAV yang belum dikirim tidak pernah ditandai untuk dihapus.
create or replace function public._enforce_wav_limit(p_vocalist uuid)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  with ranked as (
    select w.id, row_number() over (
             order by s.sort_date desc nulls last, s.file_mtime desc nulls last, s.title) as rn
    from public.wav_uploads w
    join public.songs s on s.id = w.song_id
    where w.vocalist_id = p_vocalist and w.status = 'complete' and w.drive_file_id is not null
      and w.drive_deleted_at is null and w.cleanup_eligible_at is null
      and not s.deleted)
  update public.wav_uploads w set cleanup_eligible_at = now(), updated_at = now()
    from ranked r
   where w.id = r.id and r.rn > 40
     and w.sent_at is not null;   -- belum dikirim = jangan disentuh
  get diagnostics n = row_count;
  if n > 0 then
    insert into public.job_events (kind, detail) values ('wav_limit_cleanup', jsonb_build_object('vocalist', p_vocalist, 'count', n));
  end if;
  return n;
end $function$;
