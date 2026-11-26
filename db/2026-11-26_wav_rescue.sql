-- DARURAT WAV — kalau komputer pemilik file mati, admin bisa membuat WAV dari M4A di R2
-- (dikonversi di browser admin), diunggah ke Google Drive oleh fungsi Cloudflare /admin-wav,
-- lalu pekerjaan ditandai complete. Kualitas setara M4A (AAC 192k), bukan WAV asli mixdown.
-- Semua fungsi di sini hanya untuk admin (is_admin()).

-- Daftar WAV yang belum siap (bisa diselamatkan) + data untuk mengambil M4A-nya.
create or replace function public.admin_rescue_list()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', w.id, 'title', w.song_title, 'vocalist', v.display_name, 'status', w.status,
      'attempts', w.attempts, 'accepted_at', w.accepted_at, 'rel_path', w.rel_path,
      'token', v.share_token, 'song_id', w.song_id) order by w.accepted_at)
    from public.wav_uploads w join public.vocalists v on v.id = w.vocalist_id
    where w.status in ('waiting', 'failed', 'uploading', 'needs_admin')), '[]'::jsonb);
end $$;

-- Info satu pekerjaan untuk fungsi Cloudflare (nama file + folder Drive).
create or replace function public.admin_rescue_info(p_upload uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select jsonb_build_object('id', w.id, 'status', w.status, 'vocalist', v.display_name,
         'upload_date', w.upload_date, 'rel_path', w.rel_path)
    into r
    from public.wav_uploads w join public.vocalists v on v.id = w.vocalist_id
   where w.id = p_upload;
  if r is null then raise exception 'upload not found'; end if;
  if r->>'status' not in ('waiting', 'failed', 'uploading', 'needs_admin') then
    raise exception 'upload not pending (%)', r->>'status';
  end if;
  return r;
end $$;

-- Tandai complete setelah WAV darurat ada di Drive (sama seperti wav_report 'complete').
create or replace function public.admin_rescue_complete(p_upload uuid, p_drive_file_id text, p_size bigint, p_md5 text)
returns text language plpgsql security definer set search_path = '' as $$
declare w public.wav_uploads;
begin
  if not public.is_admin() then raise exception 'not admin'; end if;
  select * into w from public.wav_uploads where id = p_upload for update;
  if w.id is null then raise exception 'upload not found'; end if;
  if w.status not in ('waiting', 'failed', 'uploading', 'needs_admin') then
    raise exception 'upload not pending (%)', w.status;
  end if;
  update public.wav_uploads set status = 'complete', drive_file_id = p_drive_file_id,
         size_bytes = p_size, md5 = p_md5, uploaded_at = now(), last_error = null,
         drive_deleted_at = null, next_attempt_at = null, updated_at = now()
   where id = p_upload;
  insert into public.job_events (kind, upload_id, song_id, detail)
  values ('wav_rescue_upload', p_upload, w.song_id,
          jsonb_build_object('size', p_size, 'drive_file_id', p_drive_file_id, 'from', 'm4a',
                             'by', auth.jwt() ->> 'email'));
  perform public._enforce_wav_limit(w.vocalist_id);
  return 'complete';
end $$;

revoke all on function public.admin_rescue_list() from public, anon;
revoke all on function public.admin_rescue_info(uuid) from public, anon;
revoke all on function public.admin_rescue_complete(uuid, text, bigint, text) from public, anon;
grant execute on function public.admin_rescue_list() to authenticated;
grant execute on function public.admin_rescue_info(uuid) to authenticated;
grant execute on function public.admin_rescue_complete(uuid, text, bigint, text) to authenticated;
