-- Diterapkan 2026-11-09 (migrasi "vocalist_photos" + "vocalist_photos_admin_select").
alter table public.vocalists add column if not exists photo_path text;
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = true;
create policy "photos admin insert" on storage.objects for insert to authenticated with check (bucket_id = 'photos' and public.is_admin());
create policy "photos admin update" on storage.objects for update to authenticated using (bucket_id = 'photos' and public.is_admin()) with check (bucket_id = 'photos' and public.is_admin());
create policy "photos admin delete" on storage.objects for delete to authenticated using (bucket_id = 'photos' and public.is_admin());
create policy "photos admin select" on storage.objects for select to authenticated using (bucket_id = 'photos' and public.is_admin());
-- get_vocalist_report: menambahkan 'photo', v.photo_path.
