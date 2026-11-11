-- Fase 3b (11 Nov 2026) — dua perbaikan sebelum saklar Manual Finalization dinyalakan.
--
-- MASALAH 1: 149 lagu lama tidak punya versi aktif karena M4A-nya sudah dihapus program lama.
--   Kalau saklar menyala, lagu-lagu itu tidak bisa di-Accept vokalis, padahal tidak ada yang
--   bisa difinalisasi (tidak ada M4A, dan merender ulang 149 lagu tidak masuk akal).
--   Perbaikan: beri mereka versi warisan TANPA m4a_key. Artinya "WAV inilah yang disetujui",
--   sementara audionya memang tidak ada — persis seperti sekarang.
--
-- MASALAH 2: kalau nanti Jeffry merender ulang lagu lama dan Studio One menghasilkan WAV yang
--   isinya sama persis, sidik jarinya tidak berubah. finalize_song akan menjawab "already_active"
--   dan M4A yang baru TIDAK PERNAH diunggah — vokalis tetap tidak bisa mendengarkan.
--   Perbaikan: "already_active" hanya berlaku kalau versi aktif itu memang sudah punya audio.

-- Indeks "satu versi hidup per isi" hanya menjaga versi yang sudah punya audio, supaya versi
-- warisan tanpa audio bisa difinalisasi belakangan dengan isi WAV yang sama.
-- (Dua finalisasi sekaligus untuk satu lagu tetap ditahan oleh song_versions_one_finalizing.)
drop index if exists public.song_versions_live_fp;
create unique index if not exists song_versions_live_fp on public.song_versions (song_id, sha256)
  where status = 'active' and m4a_key is not null;

create or replace function public.finalize_song(p_song uuid, p_candidate uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.songs; c public.file_candidates; v public.song_versions; j public.jobs; v_id uuid; v_key text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into s from public.songs where id = p_song for update;
  if s.id is null or s.deleted then raise exception 'song not found'; end if;
  select * into c from public.file_candidates where id = p_candidate and song_id = p_song;
  if c.id is null then raise exception 'file not found for this song'; end if;
  if not c.present then raise exception 'that file is no longer on the computer'; end if;
  if c.m4a_name is null or c.m4a_sha256 is null then
    raise exception 'there is no M4A next to this WAV - render both from the DAW, then try again';
  end if;

  -- Sudah aktif DAN sudah punya audio → tidak ada yang perlu dikerjakan.
  -- Kalau versi aktif belum punya audio (lagu warisan), finalisasi tetap jalan supaya M4A-nya naik.
  select * into v from public.song_versions
   where song_id = p_song and sha256 = c.sha256 and status = 'active' and m4a_key is not null;
  if v.id is not null then
    return jsonb_build_object('state', 'already_active', 'version', v.id);
  end if;
  select * into v from public.song_versions where song_id = p_song and sha256 = c.sha256 and status = 'finalizing';
  if v.id is not null then
    select * into j from public.jobs where version_id = v.id and kind = 'finalize';
    return jsonb_build_object('state', 'already_running', 'version', v.id, 'job', j.id);
  end if;
  if exists (select 1 from public.song_versions where song_id = p_song and status = 'finalizing') then
    raise exception 'another file for this song is still being finalized; cancel it first';
  end if;
  if s.accepted_at is not null then
    raise exception 'the vocalist accepted this song (locked); unlock it first';
  end if;

  insert into public.song_versions (song_id, version_no, candidate_id, device_id, source, rel_path,
    file_name, size_bytes, sha256, md5, status, m4a_name, m4a_sha256)
  values (p_song,
    (select coalesce(max(version_no), 0) + 1 from public.song_versions where song_id = p_song),
    c.id, c.device_id, c.source, c.rel_path, c.file_name, c.size_bytes, c.sha256, c.md5,
    'finalizing', c.m4a_name, c.m4a_sha256)
  returning id into v_id;

  v_key := 'finalize:' || v_id::text;
  insert into public.jobs (kind, song_id, version_id, target_device, idempotency_key)
  values ('finalize', p_song, v_id, c.device_id, v_key)
  on conflict (idempotency_key) do update set updated_at = now()
  returning * into j;

  insert into public.job_events (kind, song_id, detail)
  values ('finalize_start', p_song, jsonb_build_object('version', v_id, 'file', c.file_name, 'sha', left(c.sha256, 12)));
  return jsonb_build_object('state', 'queued', 'version', v_id, 'job', j.id);
end $function$;

-- Versi warisan untuk lagu yang BELUM punya audio sama sekali. m4a_key dibiarkan kosong:
-- vokalis tetap tidak bisa memutarnya (sama seperti sekarang), tapi lagunya tidak lagi tersangkut
-- saat saklar menyala, dan WAV-nya sudah terikat sidik jari.
create or replace function public.backfill_versions_no_audio(p_commit boolean default false)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_ready int := 0; v_made int := 0; r record; v_version uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  for r in
    select s.id as song_id, s.source,
           c.id as candidate_id, c.device_id, c.file_name, c.size_bytes, c.sha256, c.md5, c.rel_path
    from public.songs s
    join lateral (
      select c.* from public.file_candidates c
       where c.rel_path = s.rel_path and c.present
       order by c.last_seen desc limit 1) c on true
    where not s.deleted and s.active_version_id is null
      and not exists (select 1 from public.audio_files a where a.song_id = s.id)
  loop
    v_ready := v_ready + 1;
    if not p_commit then continue; end if;
    v_version := null;
    insert into public.song_versions (song_id, version_no, candidate_id, device_id, source, rel_path,
      file_name, size_bytes, sha256, md5, status, legacy, activated_at)
    values (r.song_id,
      (select coalesce(max(version_no), 0) + 1 from public.song_versions where song_id = r.song_id),
      r.candidate_id, r.device_id, r.source, r.rel_path, r.file_name, r.size_bytes, r.sha256, r.md5,
      'active', true, now())
    on conflict do nothing
    returning id into v_version;
    if v_version is null then continue; end if;
    update public.songs set active_version_id = v_version where id = r.song_id;
    v_made := v_made + 1;
  end loop;
  return jsonb_build_object('committed', p_commit, 'ready', v_ready, 'versions_created', v_made);
end $function$;
revoke all on function public.backfill_versions_no_audio(boolean) from public, anon;
grant execute on function public.backfill_versions_no_audio(boolean) to authenticated;

-- Finalisasi borongan: untuk vokalis ini, selesaikan semua lagu yang jelas tidak ambigu —
-- tepat satu file yang ada di komputer, punya M4A, dan M4A-nya tidak ketinggalan zaman.
-- Lagu yang ambigu (dua kandidat, M4A lebih tua, sudah di-Accept) sengaja DILEWATI supaya
-- tetap diputuskan satu per satu.
create or replace function public.finalize_ready(p_vocalist uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare r record; v_cand uuid; v_done int := 0; v_skip jsonb := '[]'::jsonb; v_res jsonb; v_why text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  for r in
    select s.id, s.title, s.accepted_at,
           (select count(*) from public.file_candidates c where c.song_id = s.id and c.present) as present_n,
           (select count(*) from public.file_candidates c
             where c.song_id = s.id and c.present and c.m4a_name is not null) as with_m4a_n,
           exists (select 1 from public.song_versions v
                    where v.song_id = s.id and v.status = 'active' and v.m4a_key is not null) as sudah_ada_audio
      from public.songs s
     where s.vocalist_id = p_vocalist and not s.deleted
     order by s.sort_date nulls last, s.title
  loop
    -- Kandidat yang benar-benar siap: ada di komputer, punya M4A, dan M4A-nya tidak ketinggalan.
    select c.id into v_cand from public.file_candidates c
     where c.song_id = r.id and c.present and c.m4a_name is not null and c.m4a_sha256 is not null
       and (c.m4a_mtime is null or c.file_mtime - c.m4a_mtime <= interval '2 minutes')
     order by c.file_mtime desc limit 1;

    v_why := null;
    if r.accepted_at is not null then v_why := 'already accepted by the vocalist';
    elsif exists (select 1 from public.song_versions where song_id = r.id and status = 'finalizing')
      then v_why := 'already being finalized';
    elsif r.with_m4a_n = 0 then v_why := 'no M4A next to the WAV';
    elsif v_cand is null then v_why := 'M4A is older than the WAV - check by hand';
    elsif r.present_n > 1 then v_why := 'more than one file - choose by hand';
    end if;

    if v_why is not null then
      -- Lagu yang audionya memang sudah beres tidak perlu dilaporkan sebagai "dilewati".
      if not (v_why = 'no M4A next to the WAV' and r.sudah_ada_audio) then
        v_skip := v_skip || jsonb_build_object('title', r.title, 'why', v_why);
      end if;
      continue;
    end if;

    begin
      v_res := public.finalize_song(r.id, v_cand);
      if v_res->>'state' = 'queued' then v_done := v_done + 1;
      elsif v_res->>'state' = 'already_active' then null;  -- sudah beres, bukan dilewati
      end if;
    exception when others then
      v_skip := v_skip || jsonb_build_object('title', r.title, 'why', left(sqlerrm, 120));
    end;
  end loop;
  return jsonb_build_object('queued', v_done, 'skipped', v_skip);
end $function$;
revoke all on function public.finalize_ready(uuid) from public, anon;
grant execute on function public.finalize_ready(uuid) to authenticated;
