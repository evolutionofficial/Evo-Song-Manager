-- Fase 16 — Ruang panggilan per vokalis.
--
-- Admin dan vokalis harus sampai ke ruang yang SAMA tanpa bertukar link: vokalis menyebut
-- tokennya, admin menyebut vokalisnya, keduanya dapat kode yang sama.
--
-- Memakai ulang tabel listen_rooms, bukan tabel baru, karena /turn memvalidasi kode ruang
-- lewat listen_room_live() sebelum memberi kredensial relay. Tabel baru berarti /turn harus
-- diubah juga, dan ruang tanpa relay akan gagal di data seluler.

alter table public.listen_rooms
  add column if not exists kind text not null default 'listen';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listen_rooms_kind_chk') then
    alter table public.listen_rooms
      add constraint listen_rooms_kind_chk check (kind in ('listen', 'call'));
  end if;
end $$;

-- Satu ruang panggilan hidup per vokalis. Indeks ini yang menjaganya, bukan kode aplikasi.
create unique index if not exists listen_rooms_one_live_call
  on public.listen_rooms (vocalist_id)
  where kind = 'call' and closed_at is null;

-- listen_open hanya mengurus ruang MENYIMAK. Sebelumnya dia menutup semua ruang vokalis itu,
-- termasuk ruang panggilan yang sedang berjalan — artinya membuka Listen Together akan
-- memutus panggilan yang sedang hidup.
create or replace function public.listen_open(p_vocalist uuid)
 returns table(code text, expires_at timestamptz)
 language plpgsql security definer set search_path to ''
as $function$
declare v_code text;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.vocalists where id = p_vocalist) then
    raise exception 'vocalist not found';
  end if;

  update public.listen_rooms r set closed_at = now()
   where r.vocalist_id = p_vocalist and r.closed_at is null and r.kind = 'listen';

  v_code := 'lr_' || replace(gen_random_uuid()::text, '-', '');

  insert into public.listen_rooms (code, vocalist_id, opened_by, kind)
  values (v_code, p_vocalist, auth.uid(), 'listen');

  return query
    select r.code, r.expires_at from public.listen_rooms r where r.code = v_code;
end $function$;

-- Undangan Listen Together di halaman vokalis hanya boleh menyala untuk ruang MENYIMAK.
-- Tanpa ini, membuka ruang panggilan juga memunculkan undangan "Listen together" di sana.
create or replace function public.listen_room_for(p_token text)
 returns table(code text, expires_at timestamptz)
 language sql security definer set search_path to ''
as $function$
  select r.code, r.expires_at
    from public.vocalists vo
    join public.listen_rooms r on r.vocalist_id = vo.id
   where vo.share_token = p_token and length(p_token) > 0
     and r.closed_at is null and r.expires_at > now()
     and r.kind = 'listen';
$function$;

-- Ruang panggilan untuk satu vokalis, dibuat kalau belum ada. Dipanggil kedua sisi:
--   vokalis -> call_room(share_token-nya)
--   admin   -> call_room('', id-vokalis)   [harus sudah masuk sebagai admin]
create or replace function public.call_room(p_token text default '', p_vocalist uuid default null)
 returns table(code text, expires_at timestamptz, vocalist text)
 language plpgsql security definer set search_path to ''
as $function$
declare v_id uuid; v_code text;
begin
  -- Siapa yang bertanya. Token vokalis lebih dulu, karena itu jalur tanpa akun.
  select vo.id into v_id from public.vocalists vo
   where vo.share_token = p_token and length(coalesce(p_token, '')) > 0;

  if v_id is null then
    if not public.is_admin() then raise exception 'not allowed'; end if;
    if p_vocalist is null then raise exception 'vocalist required'; end if;
    select id into v_id from public.vocalists where id = p_vocalist;
    if v_id is null then raise exception 'vocalist not found'; end if;
  end if;

  -- Ruang yang sudah hidup dipakai lagi, dan umurnya diperpanjang. Tanpa perpanjangan ini
  -- sebuah rapat panjang bisa mati di tengah jalan saat ruangnya kedaluwarsa.
  update public.listen_rooms r
     set expires_at = now() + interval '4 hours'
   where r.vocalist_id = v_id and r.kind = 'call'
     and r.closed_at is null and r.expires_at > now()
  returning r.code into v_code;

  if v_code is null then
    -- Ruang lama yang sudah kedaluwarsa ditutup dulu, supaya indeks satu-ruang-hidup lega.
    update public.listen_rooms r set closed_at = now()
     where r.vocalist_id = v_id and r.kind = 'call' and r.closed_at is null;

    -- Balapan: kalau admin dan vokalis meminta ruang hampir bersamaan, keduanya tidak
    -- menemukan ruang hidup lalu keduanya mencoba membuat. Indeks unik menolak yang kedua
    -- (409), dan gejalanya di layar: ruang tidak terbuka, tombol Call diam saja.
    -- Yang kalah balapan sekarang memakai ruang milik pemenang, bukan menyerah.
    begin
      v_code := 'lr_' || replace(gen_random_uuid()::text, '-', '');
      insert into public.listen_rooms (code, vocalist_id, opened_by, kind)
      values (v_code, v_id, auth.uid(), 'call');
    exception when unique_violation then
      v_code := null;
      select r.code into v_code from public.listen_rooms r
       where r.vocalist_id = v_id and r.kind = 'call'
         and r.closed_at is null and r.expires_at > now();
      if v_code is null then raise; end if;   -- bukan balapan: kesalahan lain, jangan ditelan
    end;
  end if;

  return query
    select r.code, r.expires_at, vo.display_name
      from public.listen_rooms r
      join public.vocalists vo on vo.id = r.vocalist_id
     where r.code = v_code;
end $function$;
revoke all on function public.call_room(text, uuid) from public;
grant execute on function public.call_room(text, uuid) to anon, authenticated;
