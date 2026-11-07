-- Diterapkan ke Supabase pada 2026-11-08 (migrasi "distribution_module_schema").
-- Lihat ARCHITECTURE.md bagian 4 dan dokumen rencana Google Drive & WhatsApp.

create table public.audio_files (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete cascade,
  revision int not null default 0,
  r2_key text not null unique,
  file_name text not null,
  size_bytes bigint,
  md5 text,
  uploaded_at timestamptz not null default now(),
  unique (song_id, revision)
);

create table public.wav_uploads (
  id uuid primary key default gen_random_uuid(),
  song_id uuid not null references public.songs(id) on delete restrict,
  vocalist_id uuid not null references public.vocalists(id),
  song_title text not null,
  revision int not null,
  rel_path text not null,
  accepted_at timestamptz not null,
  upload_date date not null,
  status text not null default 'waiting' check (status in ('waiting','uploading','complete','failed')),
  attempts int not null default 0,
  last_error text,
  drive_file_id text,
  size_bytes bigint,
  md5 text,
  uploaded_at timestamptz,
  cleanup_eligible_at timestamptz,
  drive_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (song_id, revision)
);
create index wav_uploads_status_idx on public.wav_uploads (status);
create index wav_uploads_voc_date_idx on public.wav_uploads (vocalist_id, upload_date);

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null references public.wav_uploads(id) on delete restrict,
  recipient text not null check (recipient in ('fc','vocalist')),
  phone text,
  status text not null default 'pending' check (status in ('pending','sending','sent','delivered','read','failed')),
  attempts int not null default 0,
  last_error text,
  wa_message_id text,
  requested_at timestamptz not null default now(),
  sent_at timestamptz, delivered_at timestamptz, read_at timestamptz, failed_at timestamptz,
  unique (upload_id, recipient)
);

create table public.job_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  upload_id uuid references public.wav_uploads(id),
  delivery_id uuid references public.deliveries(id),
  song_id uuid references public.songs(id),
  detail jsonb
);
create index job_events_at_idx on public.job_events (at desc);

create table public.agent_heartbeats (
  agent text primary key,
  last_seen timestamptz not null default now(),
  info jsonb
);

create table public.recipients (
  key text primary key check (key = 'fc'),
  name text,
  phone text,
  updated_at timestamptz not null default now()
);
alter table public.vocalists add column if not exists phone text;

create table public.agent_secret (
  agent text primary key,
  secret text not null default encode(gen_random_bytes(24), 'hex')
);
insert into public.agent_secret (agent) values ('drive');

do $$ declare t text; begin
  foreach t in array array['audio_files','wav_uploads','deliveries','job_events','agent_heartbeats','recipients','agent_secret'] loop
    execute format('alter table public.%I enable row level security', t);
    if t <> 'agent_secret' then
      execute format('create policy admin_all on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
    end if;
  end loop;
end $$;

create or replace function public.accept_song(p_token text, p_song uuid)
 returns timestamptz language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; s public.songs; t timestamptz;
begin
  select id into v_id from public.vocalists where share_token = p_token;
  if v_id is null then raise exception 'link not found'; end if;
  update public.songs set accepted_at = coalesce(accepted_at, now())
   where id = p_song and vocalist_id = v_id and not deleted
   returning * into s;
  if s.id is null then raise exception 'song not found'; end if;
  insert into public.wav_uploads (song_id, vocalist_id, song_title, revision, rel_path, accepted_at, upload_date)
  values (s.id, s.vocalist_id, s.title, s.revision, s.rel_path, s.accepted_at,
          (s.accepted_at at time zone 'Asia/Jakarta')::date)
  on conflict (song_id, revision) do nothing;
  insert into public.job_events (kind, song_id, detail)
  values ('accept', s.id, jsonb_build_object('revision', s.revision, 'title', s.title));
  return s.accepted_at;
end $function$;
revoke all on function public.accept_song(text, uuid) from public;
grant execute on function public.accept_song(text, uuid) to anon, authenticated;
