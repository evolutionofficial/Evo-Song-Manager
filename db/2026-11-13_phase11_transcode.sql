-- FASE 11 — Lagu bisu: daftar lagu yang WAV-nya ada tapi belum punya audio untuk didengar.
--
-- 126 lagu tidak punya audio sama sekali (Cia seluruhnya, Keket dua pertiga). WAV-nya masih ada
-- di komputer, jadi tinggal dibuatkan M4A-nya. Fungsi ini memberi tahu agen lagu mana saja,
-- hanya untuk sumber folder yang memang dipegang komputer itu.
--
-- Agen TIDAK diberi tahu lagu yang sudah punya audio, jadi tidak mungkin menimpa yang sudah ada.
create or replace function public.audio_needed(p_secret text, p_sources text[], p_limit int default 20)
returns jsonb
language plpgsql stable security definer set search_path to '' as $function$
declare v_out jsonb;
begin
  if not public.agent_ok(p_secret) then raise exception 'invalid agent secret'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'song_id', t.id, 'source', t.source, 'rel_path', t.rel_path,
           'file_name', t.file_name, 'title', t.title, 'vocalist', t.vocalist)), '[]'::jsonb)
    into v_out
  from (
    select s.id, s.source, s.rel_path, s.file_name, s.title, v.display_name as vocalist
      from public.songs s
      join public.vocalists v on v.id = s.vocalist_id
     where not s.deleted
       and not coalesce(s.missing, false)
       and s.source = any (coalesce(p_sources, array['pc']))
       -- hanya yang benar-benar tidak ada audionya; yang sudah ada tidak pernah disentuh
       and public.get_audio_key(v.share_token, s.id) is null
       and s.rel_path ilike '%.wav'
     order by s.sort_date desc nulls last
     limit greatest(1, least(coalesce(p_limit, 20), 100))
  ) t;
  return v_out;
end $function$;

revoke all on function public.audio_needed(text, text[], int) from public;
grant execute on function public.audio_needed(text, text[], int) to anon, authenticated;
