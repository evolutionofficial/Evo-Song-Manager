-- Fase 14 — Membuang dua pemicu sementara, dan menutup lubang yang membuatnya perlu.
--
-- Ditemukan saat audit akhir 13 Nov. Dua pemicu dari sesi pagi masih hidup di wav_uploads:
--
--   tmp_autosend_batch   — sampai 15 Nov, otomatis mengisi sent_at dan downloaded_at untuk
--                          lagu lama Keket/Cia/Guna. Sudah membuat 198 catatan, 178 di
--                          antaranya ditandainya sendiri sebagai fake_download.
--   tmp_protect_guna_new — menjaga tiga WAV Guna yang belum dikirim agar tidak ditandai
--                          untuk dihapus dari Google Drive.
--
-- Keduanya dibuang. Tapi yang kedua tidak bisa sekadar dibuang: masalah yang ditambalnya nyata.
--
-- Batas 40 WAV per vokalis memeringkat dengan upload_date. Ketika banyak WAV lama diunggah
-- ulang sekaligus, upload_date-nya menjadi hari itu, sehingga lagu yang benar-benar baru tapi
-- belum sempat dikirim justru terdorong ke urutan terbawah dan ditandai untuk dihapus —
-- padahal operator belum pernah menerimanya. Saat audit, "Emang Dasar" (41) dan
-- "The Way You Look At Me" (42) sudah berada di posisi itu.
--
-- Jadi tambalan sementara untuk tiga lagu Guna diganti aturan tetap untuk semua vokalis:
-- WAV yang belum dikirim tidak pernah ditandai untuk dihapus. Batas 40 tetap berlaku untuk
-- sisanya; Drive boleh sesaat berisi sedikit lebih banyak, daripada kehilangan file yang
-- belum pernah sampai ke operator.

create or replace function public._enforce_wav_limit(p_vocalist uuid)
 returns integer language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  with ranked as (
    select id, row_number() over (order by upload_date desc, coalesce(uploaded_at, accepted_at) desc) as rn
    from public.wav_uploads
    where vocalist_id = p_vocalist and status = 'complete' and drive_file_id is not null
      and drive_deleted_at is null and cleanup_eligible_at is null)
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

drop trigger if exists tmp_autosend_batch on public.wav_uploads;
drop trigger if exists tmp_protect_guna_new on public.wav_uploads;
drop function if exists public.tmp_autosend_batch();
drop function if exists public.tmp_protect_guna_new();
