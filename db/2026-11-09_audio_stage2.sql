-- Tahap 2: audio M4A di Cloudflare R2.
-- Media Agent (PC) memakai rahasia agent_secret 'drive'. Halaman vokalis memakai token link.

-- Agent: lagu mana yang cocok untuk file M4A ini? (dicek SEBELUM upload supaya tidak upload sia-sia)
create or replace function public.audio_target(p_secret text, p_rel_path text)
 returns jsonb language plpgsql stable security definer set search_path to ''
as $function$
declare s public.songs;
begin
  if not exists (select 1 from public.agent_secret where agent = 'drive' and secret = p_secret) then
    raise exception 'invalid agent secret';
  end if;
  select * into s from public.songs where lower(rel_path) = lower(p_rel_path) limit 1;
  if s.id is null then return null; end if;
  return jsonb_build_object('song_id', s.id, 'revision', s.revision, 'deleted', s.deleted);
end $function$;

-- Agent: catat file yang sudah terverifikasi ada di R2.
create or replace function public.register_audio(
  p_secret text, p_rel_path text, p_key text, p_file_name text, p_size bigint, p_md5 text)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare s public.songs; a public.audio_files;
begin
  if not exists (select 1 from public.agent_secret where agent = 'drive' and secret = p_secret) then
    raise exception 'invalid agent secret';
  end if;
  select * into s from public.songs where lower(rel_path) = lower(p_rel_path) limit 1;
  if s.id is null then raise exception 'song not found'; end if;
  delete from public.audio_files where r2_key = p_key and not (song_id = s.id and revision = s.revision);
  insert into public.audio_files (song_id, revision, r2_key, file_name, size_bytes, md5)
  values (s.id, s.revision, p_key, p_file_name, p_size, p_md5)
  on conflict (song_id, revision) do update set
    r2_key = excluded.r2_key, file_name = excluded.file_name, size_bytes = excluded.size_bytes,
    md5 = excluded.md5, uploaded_at = now()
  returning * into a;
  insert into public.job_events (kind, song_id, detail)
  values ('audio_upload', s.id, jsonb_build_object('revision', s.revision, 'key', p_key, 'size', p_size));
  return jsonb_build_object('song_id', s.id, 'revision', s.revision, 'title', s.title);
end $function$;

-- Agent: tanda masih hidup (nanti tampil di admin).
create or replace function public.agent_heartbeat(p_secret text, p_agent text, p_info jsonb)
 returns void language plpgsql security definer set search_path to ''
as $function$
begin
  if not exists (select 1 from public.agent_secret where agent = 'drive' and secret = p_secret) then
    raise exception 'invalid agent secret';
  end if;
  insert into public.agent_heartbeats (agent, last_seen, info) values (p_agent, now(), p_info)
  on conflict (agent) do update set last_seen = now(), info = excluded.info;
end $function$;

-- Halaman vokalis / endpoint streaming: kunci R2 untuk lagu milik pemegang link ini.
-- Revisi terbaru yang sudah punya audio (tidak lebih baru dari revisi lagu).
create or replace function public.get_audio_key(p_token text, p_song uuid)
 returns text language sql stable security definer set search_path to ''
as $function$
  select a.r2_key
  from public.vocalists v
  join public.songs s on s.vocalist_id = v.id and s.id = p_song and not s.deleted
  join public.audio_files a on a.song_id = s.id and a.revision <= s.revision
  where v.share_token = p_token and length(p_token) > 0
  order by a.revision desc, a.uploaded_at desc
  limit 1;
$function$;

-- Laporan vokalis: tambah 'audio' (versi singkat file audio terbaru, atau null).
create or replace function public.get_vocalist_report(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when v.id is null then null else jsonb_build_object(
    'name', v.display_name,
    'songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'title', s.title, 'session', s.session_label, 'mtime', s.sort_date,
        'price', s.price, 'paid', s.paid, 'paid_at', s.paid_at, 'revision', s.revision,
        'accepted_at', s.accepted_at,
        'audio', (select left(coalesce(a.md5, a.id::text), 10) from public.audio_files a
                  where a.song_id = s.id and a.revision <= s.revision
                  order by a.revision desc, a.uploaded_at desc limit 1))
        order by s.sort_date nulls last, s.title)
      from public.songs s where s.vocalist_id = v.id and not s.deleted), '[]'::jsonb),
    'all_songs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'vocalist', v2.display_name, 'mine', v2.id = v.id, 'title', s.title,
        'session', s.session_label, 'mtime', s.sort_date)
        order by v2.display_name, s.sort_date nulls last, s.title)
      from public.songs s join public.vocalists v2 on v2.id = s.vocalist_id where not s.deleted), '[]'::jsonb)
  ) end
  from (select 1) d left join public.vocalists v on v.share_token = p_token;
$function$;

-- Replace with revision: audio milik file revisi ikut pindah ke lagu yang dipertahankan.
create or replace function public.replace_song(p_old uuid, p_new uuid)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare o public.songs; n public.songs;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if p_old = p_new then raise exception 'choose a different file'; end if;
  select * into o from public.songs where id = p_old for update;
  select * into n from public.songs where id = p_new for update;
  if o.id is null or n.id is null then raise exception 'song not found'; end if;
  if o.accepted_at is not null then raise exception 'this song was accepted by the vocalist (locked); unlock it first'; end if;
  if o.vocalist_id <> n.vocalist_id then raise exception 'the revision file must be from the same vocalist'; end if;
  if n.paid and not o.paid then raise exception 'the replacement file is marked paid on its own; undo that first'; end if;
  update public.audio_files set song_id = o.id, revision = o.revision + 1 + (revision - n.revision)
   where song_id = n.id;
  insert into public.ignored_paths (rel_path, song_id, reason) values (o.rel_path, o.id, 'replaced')
  on conflict (rel_path) do update set song_id = excluded.song_id, reason = 'replaced';
  delete from public.songs where id = n.id;
  delete from public.ignored_paths where rel_path = n.rel_path;
  update public.songs set
    rel_path = n.rel_path, file_name = n.file_name, file_size = n.file_size, file_mtime = n.file_mtime,
    missing = n.missing, last_seen = n.last_seen, revision = revision + 1, replaced_at = now()
  where id = o.id;
  return jsonb_build_object('id', o.id, 'revision', o.revision + 1);
end $function$;

revoke all on function public.audio_target(text, text) from public;
revoke all on function public.register_audio(text, text, text, text, bigint, text) from public;
revoke all on function public.agent_heartbeat(text, text, jsonb) from public;
revoke all on function public.get_audio_key(text, uuid) from public;
grant execute on function public.audio_target(text, text) to anon, authenticated;
grant execute on function public.register_audio(text, text, text, text, bigint, text) to anon, authenticated;
grant execute on function public.agent_heartbeat(text, text, jsonb) to anon, authenticated;
grant execute on function public.get_audio_key(text, uuid) to anon, authenticated;

-- Migrasi lanjutan "audio_agent_accepts_sync_secret": Media Agent memakai kunci First Club Sync
-- (sync/config.json) sehingga tidak ada kunci baru yang perlu dipindahkan. Kunci 'drive' tetap diterima.
-- public.agent_ok(p_secret) → true kalau cocok dengan sync_secret atau agent_secret('drive');
-- audio_target, register_audio, agent_heartbeat memakai agent_ok(). agent_ok tidak bisa dipanggil anon.
