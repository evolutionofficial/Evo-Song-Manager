# DATABASE_CHANGE_PROPOSAL — Perubahan database

Semua perubahan bersifat **menambah**. Tidak ada tabel atau kolom yang dihapus atau diganti nama
pada tahap ini, sehingga agent versi lama dan halaman yang ada tetap berjalan selama masa transisi.
SQL di bawah adalah rancangan; penulisan migrasi final dilakukan per fase (`IMPLEMENTATION_ROADMAP.md`).

## 1. Relasi

```
vocalists 1───n songs 1───n song_versions n───1 file_candidates n───1 devices
                  │              │
                  │ active_version_id (0..1)
                  │              ├──n jobs            (finalize, archive_wav, drive_remove, r2_remove)
                  │              └──n wav_uploads     (unggah WAV, Send to FC — tabel yang sudah ada)
                  └──n audio_files (lama; dibiarkan untuk lagu warisan)
```

## 2. Tabel baru

### `devices` — identitas perangkat

```sql
create table public.devices (
  id          uuid primary key,              -- dibuat agent saat instalasi (device.json)
  name        text not null,                 -- "PC Studio", "MacBook"
  platform    text,                          -- win32 / darwin
  sources     text[] not null default '{}',  -- {pc,backup} atau {mac}
  sync_seen   timestamptz,
  media_seen  timestamptz,
  media_info  jsonb,                         -- versi agent, alat konversi tersedia, statistik
  created_at  timestamptz not null default now()
);
```

`agent_heartbeats` tetap diisi seperti sekarang supaya tampilan lama tidak rusak.

### `file_candidates` — setiap file WAV nyata yang pernah terlihat

```sql
create table public.file_candidates (
  id          uuid primary key default gen_random_uuid(),
  song_id     uuid references public.songs(id) on delete cascade,
  device_id   uuid references public.devices(id),
  source      text not null,                 -- pc / backup / mac
  rel_path    text not null,                 -- dengan awalan sumber, sama seperti songs.rel_path
  file_name   text not null,                 -- nama asli, tidak pernah diubah
  size_bytes  bigint not null,
  file_mtime  timestamptz not null,
  sha256      text not null,
  md5         text not null,
  present     boolean not null default true, -- masih ada di disk pada pindai terakhir
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  unique (source, rel_path, sha256)
);
create index on public.file_candidates (song_id);
create index on public.file_candidates (sha256);
```

Nama sama dengan isi berbeda menghasilkan dua baris. Isi sama di dua perangkat menghasilkan dua
baris dengan `sha256` sama, yang bisa dikenali sebagai file yang sama.

### `song_versions` — kandidat yang difinalisasi

```sql
create table public.song_versions (
  id            uuid primary key default gen_random_uuid(),
  song_id       uuid not null references public.songs(id) on delete restrict,
  version_no    int  not null,
  candidate_id  uuid references public.file_candidates(id),
  device_id     uuid references public.devices(id),
  source        text not null,
  rel_path      text not null,
  file_name     text not null,
  size_bytes    bigint not null,
  sha256        text not null,
  md5           text not null,
  status        text not null check (status in
                  ('finalizing','active','superseded','cancelled','failed')),
  cancel_reason text,                        -- revision / admin / replaced
  m4a_key       text,                        -- m4a/<song_id>/<version_id>.m4a
  m4a_md5       text,
  m4a_size      bigint,
  archive_path  text,                        -- path di Cancel Song setelah diarsipkan
  archive_state text,                        -- pending / done / overwritten / missing
  legacy        boolean not null default false,
  finalized_at  timestamptz not null default now(),
  activated_at  timestamptz,
  ended_at      timestamptz,
  unique (song_id, version_no)
);
-- Satu versi hidup per (lagu, isi): klik ganda dan request ganda jatuh ke baris yang sama.
create unique index song_versions_live_fp on public.song_versions (song_id, sha256)
  where status in ('finalizing','active');
-- Paling banyak satu versi aktif dan satu finalisasi berjalan per lagu.
create unique index song_versions_one_active on public.song_versions (song_id) where status = 'active';
create unique index song_versions_one_finalizing on public.song_versions (song_id) where status = 'finalizing';
```

### `jobs` — pekerjaan agent selain unggah WAV

```sql
create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null check (kind in ('finalize','archive_wav','drive_remove','r2_remove')),
  song_id         uuid references public.songs(id),
  version_id      uuid references public.song_versions(id),
  target_device   uuid references public.devices(id),   -- null = perangkat mana pun
  idempotency_key text not null unique,
  status          text not null default 'queued' check (status in
                    ('queued','running','done','failed','needs_admin','cancelled')),
  stage           text,                                  -- validated / converted / uploading / verified …
  attempts        int  not null default 0,
  next_attempt_at timestamptz,
  not_before      timestamptz,                           -- untuk r2_remove yang ditunda 24 jam
  lease_owner     uuid,
  lease_until     timestamptz,
  last_error      text,
  result          jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index on public.jobs (status, target_device, next_attempt_at);
```

Kunci idempotensi:

| Jenis | Kunci |
|---|---|
| `finalize` | `finalize:<song_id>:<sha256>` (ditambah nomor urut bila versi sebelumnya dengan isi sama sudah `cancelled`/`failed`) |
| `archive_wav` | `archive:<version_id>` |
| `drive_remove` | `drive_remove:<wav_upload_id>` |
| `r2_remove` | `r2_remove:<version_id>` |

## 3. Kolom tambahan pada tabel yang ada

```sql
alter table public.songs
  add column active_version_id uuid references public.song_versions(id);

alter table public.wav_uploads
  add column version_id      uuid references public.song_versions(id),
  add column expected_sha256 text,
  add column device_id       uuid references public.devices(id),
  add column lease_owner     uuid,
  add column lease_until     timestamptz;
-- status tambahan: 'needs_admin' (fingerprint tidak cocok / sumber hilang / 8 kali gagal)

alter table public.app_settings
  add column manual_finalization boolean not null default false;  -- saklar fitur
```

`wav_uploads` tetap unik per `(song_id, revision)`. Agar tidak mengubah kunci itu, `songs.revision`
dinaikkan setiap kali versi baru menjadi aktif (sama seperti Replace sekarang). Dengan begitu
celah G2 tertutup: Accept setelah Revision selalu membuat baris baru untuk versi baru, tidak pernah
memakai ulang file Drive lama.

## 4. Fungsi (RPC)

| Fungsi | Pemanggil | Tugas |
|---|---|---|
| `device_hello(secret, device_id, name, platform, sources, info)` | kedua agent | daftar/perbarui perangkat, heartbeat |
| `sync_files(…, p_device, p_files dengan sha256/md5)` | Sync | seperti sekarang + mengisi `file_candidates`. Parameter baru opsional, jadi Sync lama tetap jalan. **Tidak lagi menimpa** ukuran/tanggal lagu bila fingerprint berbeda dari versi aktif |
| `list_candidates(song_id)` | admin | kandidat + penanda mana yang aktif |
| `finalize_song(song_id, candidate_id)` | admin | transaksi idempoten: membuat versi `finalizing` + pekerjaan |
| `cancel_finalize(job_id)`, `retry_job(job_id)` | admin | intervensi |
| `claim_jobs(secret, device_id, kinds, limit)` | Media Agent | klaim dengan `FOR UPDATE SKIP LOCKED` + sewa |
| `job_progress(secret, device_id, job_id, stage, lease_seconds)` | Media Agent | simpan tahap, perpanjang sewa; ditolak kalau sewa sudah diambil perangkat lain |
| `job_finish(secret, device_id, job_id, status, result, error)` | Media Agent | selesai / gagal / needs_admin |
| `activate_version(secret, device_id, job_id, m4a_key, m4a_md5, m4a_size)` | Media Agent | satu transaksi: versi → active, versi lama → superseded, `songs.active_version_id`, `revision + 1`, jadwalkan `r2_remove` versi lama |
| `accept_song` (diubah) | vokalis | menolak kalau tidak ada versi aktif; mengisi `version_id`, `expected_sha256`, `device_id` |
| `request_revision` (diubah) | vokalis | transaksi revisi lengkap (alur 4) |
| `wav_jobs`, `wav_report` (diubah) | Media Agent | menambah sewa, `needs_admin`, dan data versi |
| `get_audio_key` (diubah) | fungsi `/audio` | hanya versi aktif; kosong saat On Revision |
| `get_vocalist_report` (diubah) | halaman vokalis | menambah status lagu |
| `reconcile_report(secret, device_id, findings)` | Media Agent | mencatat temuan rekonsiliasi untuk panel admin |

Semua fungsi agent tetap `SECURITY DEFINER`, memeriksa kunci, dan tidak memberi akses tabel langsung.

## 5. Aturan integritas yang dijaga database

1. Paling banyak satu versi `active` per lagu (indeks unik parsial).
2. Paling banyak satu finalisasi berjalan per lagu.
3. Satu pekerjaan per kunci idempotensi (`unique`).
4. Sewa: `job_progress` dan `job_finish` hanya diterima dari `lease_owner` yang sah dan belum habis.
5. `activate_version` gagal kalau versi sudah `cancelled` (misalnya admin membatalkan saat unggah
   berjalan); agent lalu menghapus objek R2 yang baru diunggah.
6. `songs.active_version_id` hanya diubah di dalam `activate_version`, `request_revision`, dan
   pembatalan oleh admin.
7. Versi tidak pernah dihapus (`on delete restrict`), supaya riwayat dan arsip bisa ditelusuri.

## 6. Backfill untuk data yang ada

258 lagu aktif tidak perlu difinalisasi ulang.

1. Setelah agent baru mengirim fingerprint, setiap lagu mendapat satu kandidat.
2. Untuk setiap lagu yang **punya audio** (109): dibuat satu `song_versions` dengan `legacy = true`,
   `status = active`, `m4a_key` = kunci R2 yang sekarang, fingerprint dari kandidatnya.
3. Untuk 40 lagu yang sudah di-Accept: `wav_uploads.version_id` diisi versi warisan itu;
   `expected_sha256` diisi dari kandidatnya **hanya kalau** MD5 kandidat sama dengan MD5 yang
   tercatat saat unggah; kalau berbeda (file berubah setelah diunggah), lagu ditandai untuk dicek
   admin. File Drive yang ada tidak disentuh.
4. Lagu tanpa audio (149) tetap **Draft**. Tidak ada yang berubah
   bagi vokalis karena sekarang pun lagu itu tidak bisa diputar.
5. Lagu warisan tetap bisa di-Accept seperti sekarang selama saklar `manual_finalization` mati.

Lagu `backup` yang drive-nya sedang dicabut mendapat kandidat ketika drive tersambung lagi.

## 7. Yang dibersihkan belakangan (bukan sekarang)

Setelah sistem baru stabil, dalam migrasi terpisah dan dengan persetujuan: tabel `deliveries` dan
`recipients`, fungsi `cleanup_done`, kolom `operator_hidden_at`, dan `audio_files` setelah semua
lagu punya versi.
