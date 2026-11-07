# Database (Supabase)

Perubahan database dijalankan lewat migrasi Supabase. File di folder ini adalah catatan
untuk riwayat dan audit; sumber kebenaran tetap database-nya.

| File | Isi |
|---|---|
| `2026-11-08_distribution_module.sql` | Modul distribusi: `audio_files` (M4A di R2), `wav_uploads` (WAV ke Drive, status, tanggal upload WIB), `deliveries` (per penerima, unik per upload+penerima), `job_events` (log), `agent_heartbeats`, `recipients`, `agent_secret`, kolom `vocalists.phone`, dan `accept_song` yang membuat tugas upload. Semua tabel: RLS admin saja. |
