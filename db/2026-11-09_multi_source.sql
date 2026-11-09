-- Sync dari banyak sumber: PC (D:), arsip backup (G:), MacBook.
-- rel_path sumber selain 'pc' diberi awalan "<sumber>:" (mis. "backup:CIA/.../Mixdown/Cia - X.wav"),
-- sehingga tetap unik tanpa mengubah tabel lain. Lagu lama dari PC tetap tanpa awalan.
alter table public.songs add column if not exists source text not null default 'pc';
alter table public.unmatched_files add column if not exists source text not null default 'pc';

drop function if exists public.sync_files(text, text[], jsonb);

create or replace function public.sync_files(
  p_secret text, p_folders text[], p_files jsonb, p_source text default 'pc', p_archive boolean default false)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_new_vocalists int := 0; v_new_songs int := 0; v_missing int := 0; v_unmatched int := 0; v_skipped int := 0;
begin
  if not exists (select 1 from public.sync_secret where secret = p_secret) then raise exception 'invalid sync secret'; end if;
  if p_source !~ '^[a-z][a-z0-9-]{0,30}$' then raise exception 'invalid source name'; end if;

  -- Hanya sumber utama (PC) yang membuat vokalis baru dan menentukan status folder.
  if p_source = 'pc' then
    insert into public.vocalists (folder_name, display_name)
    select distinct on (lower(f)) f, initcap(lower(f)) from unnest(p_folders) f
    where trim(f) <> '' and not exists (select 1 from public.vocalists v where lower(v.folder_name) = lower(f));
    get diagnostics v_new_vocalists = row_count;
    update public.vocalists v set active = exists (select 1 from unnest(p_folders) f where lower(f) = lower(v.folder_name)) where v.id is not null;
  end if;

  create temp table if not exists _sync_files (
    rel_path text, file_name text, prefix text, title text, session_label text, file_size bigint, file_mtime timestamptz, vid uuid
  ) on commit drop;
  delete from pg_temp._sync_files where true;
  insert into pg_temp._sync_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime)
  select case when p_source = 'pc' then x.rel_path else p_source || ':' || x.rel_path end,
         x.file_name, x.prefix, x.title, x.session_label, x.file_size, x.file_mtime
  from jsonb_to_recordset(p_files) as x(rel_path text, file_name text, prefix text, title text, session_label text, file_size bigint, file_mtime timestamptz);
  delete from pg_temp._sync_files f where exists (select 1 from public.ignored_paths i where i.rel_path = f.rel_path);

  update pg_temp._sync_files f set vid = (
    select v.id from public.vocalists v
    where lower(v.folder_name) = lower(trim(f.prefix)) or lower(trim(f.prefix)) = any (v.aliases)
    order by (lower(v.folder_name) = lower(trim(f.prefix))) desc limit 1)
  where true;

  -- Arsip: nama yang tidak dikenal diabaikan diam-diam (tidak masuk Needs review).
  if p_archive then
    delete from pg_temp._sync_files where vid is null;
    get diagnostics v_skipped = row_count;
  end if;

  with up as (
    insert into public.songs (vocalist_id, rel_path, file_name, title, session_label, file_size, file_mtime, sort_date, source, paid)
    select vid, rel_path, file_name, title, session_label, file_size, file_mtime, file_mtime, p_source, p_archive
    from pg_temp._sync_files where vid is not null
    on conflict (rel_path) do update set
      file_name = excluded.file_name, file_size = excluded.file_size, file_mtime = excluded.file_mtime,
      missing = false, last_seen = now()
    returning (xmax = 0) as inserted
  ) select count(*) filter (where inserted) into v_new_songs from up;

  update public.songs s set missing = true
  where s.source = p_source and not s.missing
    and not exists (select 1 from pg_temp._sync_files f where f.rel_path = s.rel_path and f.vid is not null);
  get diagnostics v_missing = row_count;

  delete from public.unmatched_files where source = p_source;
  if not p_archive then
    insert into public.unmatched_files (rel_path, file_name, prefix, title, session_label, file_size, file_mtime, source)
    select rel_path, file_name, prefix, title, session_label, file_size, file_mtime, p_source from pg_temp._sync_files where vid is null
    on conflict (rel_path) do nothing;
    get diagnostics v_unmatched = row_count;
  end if;

  if p_source = 'pc' then
    update public.app_settings set last_sync = now(), last_sync_files = jsonb_array_length(p_files) where id = 1;
  end if;
  insert into public.agent_heartbeats (agent, last_seen, info)
  values ('sync:' || p_source, now(), jsonb_build_object('files', jsonb_array_length(p_files), 'new_songs', v_new_songs))
  on conflict (agent) do update set last_seen = now(), info = excluded.info;

  return jsonb_build_object('new_vocalists', v_new_vocalists, 'new_songs', v_new_songs,
    'newly_missing', v_missing, 'unmatched', v_unmatched, 'skipped', v_skipped, 'files', jsonb_array_length(p_files));
end $function$;
revoke all on function public.sync_files(text, text[], jsonb, text, boolean) from public;
grant execute on function public.sync_files(text, text[], jsonb, text, boolean) to anon, authenticated;
