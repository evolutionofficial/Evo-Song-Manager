// Segmen CORE — konfigurasi bersama. Kunci di sini adalah kunci publik (anon);
// keamanan data dijaga oleh RLS dan fungsi di database, bukan oleh kerahasiaan kunci ini.
export const SUPABASE_URL = 'https://syrdjtqosmlenuvykdwj.supabase.co';
export const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5cmRqdHFvc21sZW51dnlrZHdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQyMTgwNzQsImV4cCI6MjEwOTc5NDA3NH0.LbnRtoCw3VyIVmUlGAujp_uL3g3vvWCASkWXhQWZQwE';
export const PRICES = [50000, 70000, 100000];

/** Alamat publik foto vokalis (Supabase Storage bucket 'photos'), atau null. */
export const photoUrl = (path) => (path ? `${SUPABASE_URL}/storage/v1/object/public/photos/${path.split('/').map(encodeURIComponent).join('/')}` : null);
