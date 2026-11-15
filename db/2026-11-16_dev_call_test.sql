-- Halaman developer /test — Jeffry menelepon HP-nya sendiri dari PC sebelum fitur panggilan
-- diberikan ke vokalis.
--
-- Ruang uji disimpan di tabel listen_rooms yang sama (jenis 'test'), BUKAN tabel baru: /turn
-- memvalidasi kode ruang lewat listen_room_live() sebelum memberi kredensial relay, jadi ruang
-- uji otomatis ikut mendapat TURN dan perilakunya di data seluler sama persis dengan panggilan
-- sungguhan. Itulah yang mau diuji.
--
-- Ruang uji TIDAK punya vokalis (vocalist_id null). Akibatnya aman: get_audio_key,
-- listen_songs, listen_active, listen_room_for dan call_room semuanya mencocokkan lewat
-- vocalist_id, jadi ruang uji tidak pernah membuka lagu atau muncul di halaman vokalis mana pun.
-- Tidak ada vokalis palsu yang perlu dibuat (vokalis palsu akan ikut muncul di agen sync,
-- halaman operator, laporan, dan daftar publik).

alter table public.listen_rooms alter column vocalist_id drop not null;

alter table public.listen_rooms drop constraint if exists listen_rooms_kind_chk;
alter table public.listen_rooms
  add constraint listen_rooms_kind_chk check (kind in ('listen', 'call', 'test'));

-- Hanya ruang uji yang boleh tanpa vokalis.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'listen_rooms_vocalist_chk') then
    alter table public.listen_rooms
      add constraint listen_rooms_vocalist_chk check (kind = 'test' or vocalist_id is not null);
  end if;
end $$;

-- Satu ruang uji hidup per akun admin. PC dan HP masuk dengan akun yang sama, jadi keduanya
-- sampai ke ruang yang sama tanpa bertukar kode.
create unique index if not exists listen_rooms_one_live_test
  on public.listen_rooms (opened_by)
  where kind = 'test' and closed_at is null;

create or replace function public.test_call_room()
 returns table(code text, expires_at timestamptz, vocalist text)
 language plpgsql security definer set search_path to ''
as $function$
declare v_code text; v_me uuid := auth.uid();
begin
  if not public.is_admin() or v_me is null then raise exception 'not allowed'; end if;

  update public.listen_rooms r
     set expires_at = now() + interval '4 hours'
   where r.opened_by = v_me and r.kind = 'test'
     and r.closed_at is null and r.expires_at > now()
  returning r.code into v_code;

  if v_code is null then
    update public.listen_rooms r set closed_at = now()
     where r.opened_by = v_me and r.kind = 'test' and r.closed_at is null;

    -- Balapan PC vs HP membuka ruang bersamaan: yang kalah memakai ruang pemenang.
    begin
      v_code := 'lr_' || replace(gen_random_uuid()::text, '-', '');
      insert into public.listen_rooms (code, vocalist_id, opened_by, kind)
      values (v_code, null, v_me, 'test');
    exception when unique_violation then
      v_code := null;
      select r.code into v_code from public.listen_rooms r
       where r.opened_by = v_me and r.kind = 'test'
         and r.closed_at is null and r.expires_at > now();
      if v_code is null then raise; end if;
    end;
  end if;

  return query
    select r.code, r.expires_at, 'Test phone'::text
      from public.listen_rooms r where r.code = v_code;
end $function$;
revoke all on function public.test_call_room() from public, anon;
grant execute on function public.test_call_room() to authenticated;
