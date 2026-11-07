# FC Song Manager — Arsitektur & Batas Segmen

Prinsip utama: **kalau satu bagian rusak, bagian lain tetap jalan.**
Setiap segmen punya batas yang jelas, tidak saling mengimpor sembarangan, dan
kegagalannya ditangkap di batas segmen itu sendiri.

```
┌──────────────── PC Jeffry (Windows) ────────────────┐
│ D:\FIRST CLUB\…\Mixdown\Nama - Judul.wav            │
│        │                                            │
│  Supervisor ──► Sync Agent (Scanner → Pusher)       │
└──────────────────────────┬──────────────────────────┘
                           │ RPC sync_files (kunci sync)
                ┌──────────▼──────────┐
                │  Supabase (DB+Auth) │  RLS: tabel hanya admin
                └──────────┬──────────┘  RPC publik: per token
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
 Admin app           Vokalis app            Publik app
 (/admin.html)       (/v/<token>)           (/)
                     Player app
                     (/v/<token>/play/<n>)
```

## 1. Segmen web (`web/`)

| Folder | Isi | Boleh mengimpor |
|---|---|---|
| `js/core/` | `config` (URL, kunci publik, daftar harga), `supabase` (satu-satunya klien), `format` (fungsi murni), `ui` (`$`, `toast`), `guard` (pengaman error) | hanya sesama `core` |
| `js/apps/admin/` | `main` (kerangka), `data` (lapisan data), `auth`, `songs`, `revisions`, `trash`, `unmatched`, `settings` | `core` + `./data.js` |
| `js/apps/vocalist/` | `main` (kerangka + data laporan + laci menu), `songlist` (My Songs), `invoice`, `allsongs` (All Song List, dari laci), `player` (bar bawah + tampilan penuh; ▶ di Songlist → event `fc:play`, player → event `fc:track`), `send` (tombol Send to FC → event `fc:send`; alur belum diputuskan) | `core` |
| `js/apps/player/` | `main` (kerangka + data), `audio` (mesin putar — saat ini placeholder, belum ada sumber audio), `queue` (daftar lagu) | `core` |
| `js/apps/public/` | `main` | `core` |
| `js/common.js` | jembatan kompatibilitas (re-export `core`) | `core` |

### Aturan modul
1. **Modul fitur tidak mengimpor modul fitur lain.** Komunikasi lewat objek `ctx`
   yang diberikan kerangka (`main.js`), misalnya `ctx.renderAll()`, `ctx.reload()`,
   `ctx.openReplace(id)`.
2. **Modul dimuat terpisah** dengan `loadModules()` (dynamic import). Kalau satu file
   gagal dimuat atau berisi error, hanya bagian itu yang diganti pesan
   *"Bagian X sedang bermasalah"*.
3. **Semua render dan event dibungkus** `safe()` / `on()` dari `core/guard.js`.
   Error di satu tombol tidak mematikan halaman.
4. **Setiap modul punya wadah sendiri** (`el` di daftar `MODULES`) tempat pesan
   error ditampilkan tanpa menyentuh bagian lain.
5. **Data admin dimuat per sumber** (`vocalists`, `songs`, `unmatched`, `settings`).
   Satu sumber gagal → hanya bagian yang memakainya yang memberi pesan.
6. Error dicatat di `window.FC_ERRORS` dan console dengan label `[FC:<segmen>]`.

### Kontrak modul
- Admin: `init(ctx)` (pasang event), `render()` (gambar ulang). Opsional: fungsi lain
  yang dipanggil kerangka lewat `ctx` (mis. `open(id)` di `revisions`).
- Vokalis: `mount(report)` — menerima data laporan sekali, lalu mengurus dirinya sendiri.
- Player: `mount(player)` — `{ song, songs, vocalist, prevUrl, nextUrl, songUrl }`. Saat sumber audio
  sudah diputuskan, cukup `audio.js` yang diganti.

### Menambah modul baru (contoh: Player)
1. Buat `js/apps/vocalist/player.js` yang mengekspor `mount(report)`.
2. Tambahkan wadah `<div id="playerBody">` di `v.html`.
3. Tambahkan `{ key: 'player', label: 'Player', path: '/js/apps/vocalist/player.js', el: 'playerBody' }`
   ke `MODULES` di `js/apps/vocalist/main.js`. Tidak ada file lain yang perlu diubah.

## 2. Segmen Sync Agent (`sync/`)

| File | Tugas | Tahu soal |
|---|---|---|
| `first-club-supervisor.js` | Penjaga: menjalankan sync, menyalakan lagi kalau mati (jeda 2→5→15→60→300 dtk), satu instance saja (`supervisor.pid`) | proses |
| `first-club-sync.js` | Titik masuk (`--once` untuk sekali jalan) | — |
| `lib/scanner.js` | Membaca folder, mengenali `Nama - Judul.wav` di `Mixdown` | disk saja |
| `lib/pusher.js` | Mengirim hasil scan ke RPC `sync_files` (timeout 60 dtk) | jaringan saja |
| `lib/agent.js` | Penjadwalan (pemantauan langsung + berkala), kirim hanya bila berubah | scanner + pusher |
| `lib/config.js`, `lib/log.js` | Konfigurasi & log | — |

- Gagal kirim tidak menghentikan pemindaian; dicoba lagi di siklus berikutnya.
- Pemantauan langsung (`fs.watch`) gagal → otomatis jatuh ke pengecekan berkala.
- Satu folder vokalis bermasalah tidak menghentikan folder lain.
- `config.json` (kunci sync) **tidak pernah** masuk GitHub.

## 3. Segmen database (Supabase)

- Tabel inti: `vocalists`, `songs`, `unmatched_files`, `ignored_paths`, `app_settings`,
  `admins`, `sync_secret`. Semua RLS: hanya admin (`is_admin()`).
- RPC per peran:
  - Sync: `sync_files(secret, …)`
  - Publik/vokalis: `get_vocalist_report(token)`, `get_public_songs()`
  - Admin: `replace_song`, `assign_prefix`, `regenerate_token`

## 4. Rencana untuk modul masa depan (lihat roadmap)

Modul besar (Distribusi file, ACC + WhatsApp, Private Studio) mengikuti pola yang sama:

- **Proses terpisah.** Upload ke Google Drive dan pengiriman WhatsApp berjalan sebagai
  worker sendiri (bukan di dalam Sync Agent/halaman web), masing-masing dengan penjaga.
- **Antrean tugas di database.** Tiap modul punya tabel antrean & status sendiri
  (mis. `upload_jobs`, `delivery_jobs`) dengan status, jumlah percobaan, dan kunci
  anti-duplikat. Segmen hanya berkomunikasi lewat antrean ini — kalau worker WhatsApp
  mati, ACC tetap tercatat dan pengiriman diulang saat worker hidup lagi.
- **Tabel/skema terpisah per modul**, dan RPC per modul, supaya perubahan satu modul
  tidak menyentuh tabel modul lain.
- **Status sistem.** Setiap worker menulis "detak" (heartbeat) berkala, seperti
  `app_settings.last_sync` untuk Sync Agent, untuk ditampilkan di dashboard status admin.
