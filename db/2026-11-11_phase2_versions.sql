-- Fase 2 (versi lagu + antrean pekerjaan), 2026-11-11.
-- Hanya menyiapkan tempat penyimpanan. Belum ada perilaku baru: semua fungsi lama tidak diubah,
-- dan saklar manual_finalization masih mati.
--   song_versions : kandidat yang DIPILIH admin dan difinalisasi. Satu versi aktif per lagu.
--   jobs          : pekerjaan agent selain unggah WAV (finalisasi, arsip, hapus).
create table if not exists public.song_versions (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references public.songs(id) on delete restrict,
  version_no    int  not null,
  candidate_id  uuid references public.file_candidates(id),
  device_id     uuid references public.devices(id),
  source        text not null,
  rel_path      text not null,
  file_name     text not null,
  size_bytes    bigint not null,
  sha256        text not null,
  md5           text not null,
  status        text not null check (status in ('finalizing','active','superseded','cancelled','failed')),
  cancel_reason text,
  m4a_key       text,
  m4a_md5       text,
  m4a_size      bigint,
  archive_path  text,
  archive_state text check (archive_state in ('pending','done','overwritten','missing')),
  legacy        boolean not null default false,
  finalized_at  timestamptz not null default now(),
  activated_at  timestamptz,
  ended_at      timestamptz,
  unique (song_id, version_no)
);
-- Satu versi "hidup" per (lagu, isi): klik ganda dan permintaan ganda jatuh ke baris yang sama.
create unique index if not exists song_versions_live_fp on public.song_versions (song_id, sha256)
  where status in ('finalizing','active');
-- Paling banyak satu versi aktif, dan satu finalisasi berjalan, per lagu.
create unique index if not exists song_versions_one_active on public.song_versions (song_id) where status = 'active';
create unique index if not exists song_versions_one_finalizing on public.song_versions (song_id) where status = 'finalizing';
create index if not exists song_versions_song on public.song_versions (song_id);
alter table public.song_versions enable row level security;
drop policy if exists admin_all on public.song_versions;
create policy admin_all on public.song_versions for all using (public.is_admin());

create table if not exists public.jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('finalize','archive_wav','drive_remove','r2_remove')),
  song_id         uuid references public.songs(id),
  version_id      uuid references public.song_versions(id),
  target_device   uuid references public.devices(id),   -- null = komputer mana pun boleh
  idempotency_key text not null unique,
  status          text not null default 'queued'
                  check (status in ('queued','running','done','failed','needs_admin','cancelled')),
  stage           text,
  attempts        int  not null default 0,
  next_attempt_at timestamptz,
  not_before      timestamptz,
  lease_owner     uuid,
  lease_until     timestamptz,
  last_error      text,
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists jobs_pick on public.jobs (status, target_device, next_attempt_at);
create index if not exists jobs_version on public.jobs (version_id);
alter table public.jobs enable row level security;
drop policy if exists admin_all on public.jobs;
create policy admin_all on public.jobs for all using (public.is_admin());

alter table public.songs
  add column if not exists active_version_id uuid references public.song_versions(id);

alter table public.wav_uploads
  add column if not exists version_id      uuid references public.song_versions(id),
  add column if not exists expected_sha256 text,
  add column if not exists device_id       uuid references public.devices(id),
  add column if not exists lease_owner     uuid,
  add column if not exists lease_until     timestamptz;

alter table public.app_settings
  add column if not exists manual_finalization boolean not null default false;

-- Backfill: lagu yang SUDAH punya audio diberi satu "versi warisan" supaya tidak perlu
-- difinalisasi ulang. Dijalankan berulang kali dengan aman; tanpa p_commit hanya melapor.
create or replace function public.backfill_versions(p_commit boolean default false)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare
  v_ready int := 0; v_no_candidate int := 0; v_made int := 0;
  v_wav_linked int := 0; v_wav_mismatch int := 0;
  r record; v_version uuid;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;

  for r in
    select s.id as song_id, s.revision, s.rel_path, s.source,
           a.r2_key, a.size_bytes as m4a_size, a.md5 as m4a_md5,
           c.id as candidate_id, c.device_id, c.file_name, c.size_bytes, c.sha256, c.md5
    from public.songs s
    join lateral (
      select a.* from public.audio_files a
       where a.song_id = s.id and a.revision <= s.revision
       order by a.revision desc, a.uploaded_at desc limit 1) a on true
    left join lateral (
      select c.* from public.file_candidates c
       where c.rel_path = s.rel_path and c.present
       order by c.last_seen desc limit 1) c on true
    where not s.deleted and s.active_version_id is null
  loop
    if r.candidate_id is null then v_no_candidate := v_no_candidate + 1; continue; end if;
    v_ready := v_ready + 1;
    if not p_commit then continue; end if;

    insert into public.song_versions (
      song_id, version_no, candidate_id, device_id, source, rel_path, file_name, size_bytes,
      sha256, md5, status, m4a_key, m4a_md5, m4a_size, legacy, activated_at)
    values (
      r.song_id,
      (select coalesce(max(version_no), 0) + 1 from public.song_versions where song_id = r.song_id),
      r.candidate_id, r.device_id, r.source, r.rel_path, r.file_name, r.size_bytes,
      r.sha256, r.md5, 'active', r.r2_key, r.m4a_md5, r.m4a_size, true, now())
    on conflict do nothing
    returning id into v_version;
    if v_version is null then continue; end if;
    update public.songs set active_version_id = v_version where id = r.song_id;
    v_made := v_made + 1;
  end loop;

  if p_commit then
    -- Unggahan WAV yang sudah ada diikat ke versinya. expected_sha256 hanya diisi kalau MD5 file
    -- di komputer sekarang sama dengan MD5 yang tercatat saat diunggah ke Drive.
    update public.wav_uploads w
       set version_id = v.id,
           device_id = coalesce(w.device_id, v.device_id),
           expected_sha256 = case when w.md5 is not null and w.md5 = v.md5 then v.sha256 end
      from public.songs s
      join public.song_versions v on v.id = s.active_version_id
     where w.song_id = s.id and w.revision = s.revision and w.version_id is null;
    get diagnostics v_wav_linked = row_count;
  end if;

  select count(*) into v_wav_mismatch
    from public.wav_uploads w
    join public.song_versions v on v.id = w.version_id
   where w.status = 'complete' and w.md5 is not null and w.md5 <> v.md5;

  return jsonb_build_object(
    'committed', p_commit,
    'ready', v_ready, 'versions_created', v_made, 'without_candidate', v_no_candidate,
    'wav_linked', v_wav_linked, 'wav_md5_mismatch', v_wav_mismatch);
end $function$;
revoke all on function public.backfill_versions(boolean) from public, anon;
grant execute on function public.backfill_versions(boolean) to authenticated;
