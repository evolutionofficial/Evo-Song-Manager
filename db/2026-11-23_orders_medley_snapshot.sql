-- SALINAN dari skema produksi (bukan migrasi baru). Fitur medley dan catatan order
-- (commit 7a33633) sudah diterapkan langsung di Supabase tanpa file migrasi. File ini
-- dibuat supaya repo kembali sama dengan database.
--
-- JANGAN dijalankan ulang di produksi. Isinya hanya untuk referensi dan untuk membangun
-- database baru. Semua perintah di bawah idempoten, jadi aman dijalankan di database kosong.

alter table public.song_orders add column if not exists group_id uuid;
alter table public.song_orders add column if not exists group_title text;
alter table public.song_orders add column if not exists note text;
create index if not exists song_orders_group_idx on public.song_orders (group_id);

create or replace function public.place_order(p_token text, p_urls text[], p_title text default null, p_note text default null)
 returns jsonb language plpgsql security definer set search_path to ''
as $function$
declare v_voc uuid; v_group uuid := gen_random_uuid(); v_ids text[] := '{}'; v_vid text; v_url text; i int;
        v_title text := nullif(left(btrim(coalesce(p_title, '')), 60), '');
        v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(p_token) > 0 and active;
  if v_voc is null then raise exception 'link not found'; end if;
  if p_urls is null or coalesce(array_length(p_urls, 1), 0) = 0 then raise exception 'not a YouTube video link'; end if;
  if array_length(p_urls, 1) > 10 then raise exception 'too many links'; end if;
  if (select count(*) from public.song_orders where vocalist_id = v_voc and status = 'waiting') + array_length(p_urls, 1) > 30 then
    raise exception 'too many waiting orders';
  end if;
  for i in 1 .. array_length(p_urls, 1) loop
    v_url := btrim(coalesce(p_urls[i], ''));
    if length(v_url) > 300 then raise exception 'link too long'; end if;
    v_vid := public._yt_video_id(v_url);
    if v_vid is null then raise exception 'not a YouTube video link'; end if;
    if v_vid = any (v_ids) then raise exception 'already ordered'; end if;
    if exists (select 1 from public.song_orders where vocalist_id = v_voc and video_id = v_vid and status <> 'rejected') then
      raise exception 'already ordered';
    end if;
    v_ids := v_ids || v_vid;
  end loop;
  for i in 1 .. array_length(v_ids, 1) loop
    insert into public.song_orders (vocalist_id, url, video_id, group_id, group_title, note)
    values (v_voc, 'https://www.youtube.com/watch?v=' || v_ids[i], v_ids[i], v_group, v_title, v_note);
  end loop;
  return jsonb_build_object('group_id', v_group, 'count', array_length(v_ids, 1));
end $function$;

create or replace function public.add_order_link(p_token text, p_group uuid, p_url text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare v_voc uuid; g public.song_orders; v_vid text;
begin
  select id into v_voc from public.vocalists where share_token = p_token and length(p_token) > 0 and active;
  if v_voc is null then raise exception 'link not found'; end if;
  select * into g from public.song_orders where group_id = p_group and vocalist_id = v_voc and status <> 'rejected' limit 1;
  if g.id is null then raise exception 'order not found'; end if;
  if (select count(*) from public.song_orders where group_id = p_group and status <> 'rejected') >= 10 then raise exception 'too many links'; end if;
  v_vid := public._yt_video_id(btrim(coalesce(p_url, '')));
  if v_vid is null then raise exception 'not a YouTube video link'; end if;
  if exists (select 1 from public.song_orders where vocalist_id = v_voc and video_id = v_vid and status <> 'rejected') then
    raise exception 'already ordered';
  end if;
  insert into public.song_orders (vocalist_id, url, video_id, group_id, group_title, note)
  values (v_voc, 'https://www.youtube.com/watch?v=' || v_vid, v_vid, p_group, g.group_title, g.note);
end $function$;

create or replace function public.admin_add_order_link(p_group uuid, p_url text)
 returns void language plpgsql security definer set search_path to ''
as $function$
declare g public.song_orders; v_vid text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  select * into g from public.song_orders where group_id = p_group and status <> 'rejected' limit 1;
  if g.id is null then raise exception 'order not found'; end if;
  if (select count(*) from public.song_orders where group_id = p_group and status <> 'rejected') >= 10 then raise exception 'too many links'; end if;
  v_vid := public._yt_video_id(btrim(coalesce(p_url, '')));
  if v_vid is null then raise exception 'not a YouTube video link'; end if;
  if exists (select 1 from public.song_orders where vocalist_id = g.vocalist_id and video_id = v_vid and status <> 'rejected') then
    raise exception 'already ordered';
  end if;
  insert into public.song_orders (vocalist_id, url, video_id, group_id, group_title, note)
  values (g.vocalist_id, 'https://www.youtube.com/watch?v=' || v_vid, v_vid, p_group, g.group_title, g.note);
end $function$;

create or replace function public.my_orders(p_token text)
 returns jsonb language sql stable security definer set search_path to ''
as $function$
  select coalesce(jsonb_agg(g order by g->>'created_at' desc), '[]'::jsonb) from (
    select jsonb_build_object('group_id', o.group_id, 'title', max(o.group_title),
      'created_at', min(o.created_at),
      'links', jsonb_agg(jsonb_build_object('id', o.id, 'url', o.url, 'status', o.status) order by o.created_at)) g
    from public.song_orders o join public.vocalists v on v.id = o.vocalist_id
    where v.share_token = p_token and length(p_token) > 0 and o.status <> 'rejected'
    group by o.group_id
  ) x;
$function$;
