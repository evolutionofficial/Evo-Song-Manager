-- Fase 6 (11 Nov 2026) — konflik judul kembar antar-komputer.
--
-- Dua file bisa punya judul yang sama untuk vokalis yang sama: hasil render ulang di folder lain,
-- atau file yang sama ada di PC dan MacBook. Sistem TIDAK menebak mana yang benar dan tidak
-- menggabungkan apa pun secara otomatis — ia hanya menampilkan kandidatnya supaya admin memilih.
-- Ini sengaja: menggabungkan dua lagu yang ternyata memang berbeda tidak bisa dibatalkan.
create or replace function public.song_conflicts()
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select case when not public.is_admin() then null else coalesce((
    select jsonb_agg(g order by g->>'vocalist', g->>'title')
    from (
      select jsonb_build_object(
        'vocalist', v.display_name, 'vocalist_id', v.id, 'title', min(s.title),
        'sources', count(distinct s.source), 'count', count(*),
        'songs', jsonb_agg(jsonb_build_object(
          'id', s.id, 'title', s.title, 'source', s.source, 'rel_path', s.rel_path,
          'size', s.file_size, 'mtime', s.file_mtime, 'paid', s.paid, 'price', s.price,
          'accepted', (s.accepted_at is not null),
          'on_revision', (s.revision_requested_at is not null),
          'device', (select d.name from public.file_candidates c
                      join public.devices d on d.id = c.device_id
                     where c.rel_path = s.rel_path and c.present order by c.last_seen desc limit 1),
          'sha', (select left(c.sha256, 8) from public.file_candidates c
                   where c.rel_path = s.rel_path and c.present order by c.last_seen desc limit 1),
          'has_audio', (av.m4a_key is not null
                        or exists (select 1 from public.audio_files a where a.song_id = s.id)),
          'finalized', (av.id is not null and av.m4a_key is not null))
          order by s.file_mtime desc nulls last)) as g
      from public.songs s
      join public.vocalists v on v.id = s.vocalist_id
      left join public.song_versions av on av.id = s.active_version_id
      where not s.deleted
      group by v.id, v.display_name, lower(trim(s.title))
      having count(*) > 1
    ) x), '[]'::jsonb) end;
$function$;
revoke all on function public.song_conflicts() from public, anon;
grant execute on function public.song_conflicts() to authenticated;
