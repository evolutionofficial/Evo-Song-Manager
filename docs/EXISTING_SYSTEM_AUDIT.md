# EXISTING_SYSTEM_AUDIT — Kondisi aktual Evo Song Manager

Tanggal audit: 11 November 2026. Sumber: source code di repo ini (commit `b4373fb`), skema dan
fungsi database Supabase yang sedang berjalan, dan data live. Kalau dokumentasi lama berbeda dengan
kode, yang dipakai di sini adalah kode. Tidak ada kode yang diubah untuk audit ini.

---

## 1. Ringkasan satu halaman

Evo Song Manager terdiri dari empat bagian yang berbicara lewat satu database:

| Bagian | Di mana | Tugas |
|---|---|---|
| Situs web (statis) | Cloudflare Pages, folder `web/` | Halaman Admin, Vokalis, Operator, daftar lagu publik |
| Tiga fungsi server | Cloudflare Pages Functions, folder `functions/` | Streaming M4A dari R2, unduhan WAV dari Google Drive |
| Database + login admin | Supabase (Postgres) | Semua data, semua aturan, antrean pekerjaan |
| Dua program di komputer studio | Node.js di PC Windows dan MacBook | **First Club Sync** (mendata file WAV) dan **Evo Media Agent** (unggah M4A ke R2, unggah WAV ke Drive) |

Penyimpanan file:

- **Cloudflare R2**, bucket `evo-audio`: file M4A untuk player vokalis.
- **Google Drive** (akun Jeffry): file WAV, di `First Club/<Vokalis>/YYYY-MM-DD Vokalis - Judul.wav`.
- **Supabase Storage**, bucket `photos`: foto vokalis.
- **Komputer studio**: WAV asli. Tidak pernah dihapus atau dipindah oleh sistem.

## 2. Peta arsitektur

```
 PC Windows (sumber "pc" + "backup")            MacBook (sumber "mac")
 D:\FIRST CLUB, G:\FIrst CLUB                   ~/Documents/First Club
 ┌───────────────────────────────┐              ┌───────────────────────────────┐
 │ Penjaga ─► First Club Sync     │              │ Penjaga ─► First Club Sync     │
 │ Penjaga ─► Evo Media Agent 1.3 │              │ Penjaga ─► Evo Media Agent 1.3 │
 └───────┬──────────────┬─────────┘              └───────┬──────────────┬─────────┘
         │ RPC          │ S3 API / Drive API             │              │
         │ (kunci sync) │                                │              │
         ▼              ▼                                ▼              ▼
 ┌────────────────┐   ┌──────────────┐   ┌───────────────────────────────┐
 │ Supabase       │   │ Cloudflare   │   │ Google Drive (OAuth,          │
 │ Postgres + RPC │   │ R2 evo-audio │   │ scope drive.file)             │
 └───────┬────────┘   └──────┬───────┘   └──────────────┬────────────────┘
         │ RPC (kunci publik │ binding AUDIO            │ refresh token di
         │ + token link)     │                          │ secret Cloudflare
         ▼                   ▼                          ▼
 ┌──────────────────────────────────────────────────────────────────────┐
 │ Cloudflare Pages  evo-song-manager                                    │
 │  web/  : /admin  /v/<token>  /fc/<token>  /                           │
 │  functions/ : /audio/<token>/<lagu>   /dl/<token>/<id>  /vdl/<token>/<lagu> │
 └──────────────────────────────────────────────────────────────────────┘
         ▲                 ▲                      ▲
       Admin            Vokalis               Operator FC
   (login Supabase)   (link pribadi)        (satu link bersama)
```

Alur komunikasi:

1. **Agent → Supabase**: HTTPS ke `/rest/v1/rpc/<fungsi>` dengan kunci publik (anon) ditambah satu
   kunci rahasia (`syncSecret` di `sync/config.json`). Setiap fungsi agent memeriksa kunci itu sendiri.
2. **Media Agent → R2**: API S3 dengan tanda tangan SigV4 yang ditulis sendiri (`drive/lib/r2.js`),
   kunci di `drive/r2.txt`.
3. **Media Agent → Google Drive**: Drive API v3, upload resumable per 16 MB, token di
   `drive/google-token.json` (scope `drive.file`: hanya file yang dibuat aplikasi ini).
4. **Halaman web → Supabase**: supabase-js. Admin memakai sesi login; vokalis dan operator memakai
   token di link, diperiksa di dalam fungsi database.
5. **Fungsi Cloudflare → Supabase / R2 / Drive**: `/audio` membaca R2 lewat binding; `/dl` dan `/vdl`
   menukar refresh token Google (secret Cloudflare) lalu meneruskan isi file dari Drive.
6. **Antar-agent**: tidak ada komunikasi langsung. PC dan MacBook hanya bertemu lewat database.

Layanan Google Cloud yang benar-benar dipakai hanya **Google Drive API** dengan OAuth client jenis
aplikasi desktop. Tidak ada layanan Google Cloud lain di kode.

## 3. Data: tabel yang dipakai

| Tabel | Isi | Catatan |
|---|---|---|
| `vocalists` | nama folder, nama tampil, alias, `share_token`, foto | dibuat otomatis dari nama folder di sumber `pc` |
| `songs` | satu baris per file WAV: `rel_path` (unik), judul, ukuran, tanggal file, harga, lunas, `revision`, `accepted_at`, `revision_requested_at`, `deleted`, `missing`, `source` | identitas lagu = **path file** |
| `unmatched_files` | WAV yang awalan namanya tidak cocok dengan vokalis mana pun | tampil di "Needs review" |
| `ignored_paths` | path yang tidak boleh masuk lagi (hasil Replace) | |
| `audio_files` | M4A di R2 per (lagu, revisi): `r2_key`, ukuran, md5 | unik per (lagu, revisi) |
| `wav_uploads` | antrean dan riwayat unggah WAV per (lagu, revisi): status, percobaan, id file Drive, md5, `sent_at`, `downloaded_at` | sekaligus status "Send to FC" |
| `job_events` | catatan kejadian (accept, upload, unduh, revisi) | hanya untuk jejak |
| `agent_heartbeats` | tanda hidup: `sync:pc`, `sync:backup`, `sync:mac`, dan satu baris `media` | |
| `app_settings` | harga publik, waktu sync terakhir, `fc_token` (link operator) | satu baris |
| `sync_secret`, `agent_secret`, `admins` | kunci agent, daftar email admin | |
| `deliveries`, `recipients` | sisa rencana WhatsApp | **kosong, tidak dipakai** |

Semua tabel memakai RLS "hanya admin". Selain admin, akses hanya lewat fungsi `SECURITY DEFINER`.

Angka saat audit: 258 lagu aktif (pc 105, backup 119, mac 34), 3 di "Deleted", 109 lagu punya audio,
40 lagu di-Accept dan semua WAV-nya `complete` di Drive, 3 file di "Needs review", 0 lagu dengan
`revision > 0` (fitur Replace belum pernah dipakai di data live).

## 4. Token dan autentikasi

| Peran | Cara masuk | Diperiksa oleh |
|---|---|---|
| Admin | email + password Supabase Auth; email harus ada di `admins` | `is_admin()` dan RLS |
| Vokalis | link `/v/<share_token>` | tiap fungsi (`get_vocalist_report`, `accept_song`, …) |
| Operator | link `/fc/<fc_token>` | `get_operator_report`, `operator_download` |
| Agent | `syncSecret` | `sync_files` langsung; fungsi lain lewat `agent_ok()` |
| Fungsi Cloudflare | tidak punya kunci database sendiri; meneruskan token pengguna | fungsi database |

Satu kunci agent dipakai bersama oleh kedua program dan kedua komputer. Database tidak tahu komputer
mana yang sedang berbicara, hanya nama sumber (`pc`, `backup`, `mac`) yang dikirim agent.

## 5. Workflow yang berjalan sekarang

### 5.1 Lagu baru (WAV muncul di daftar)

1. Jeffry mengekspor `Nama - Judul.wav` ke folder yang path-nya mengandung `Mixdown`.
2. First Club Sync memindai (dipicu perubahan folder, ditunda 20 detik, dan berkala tiap 60 detik).
   File yang berubah kurang dari 15 detik lalu dilewati dulu ("masih dirender").
3. Sync mengirim seluruh daftar file sumber itu ke `sync_files`. Hanya **nama, ukuran dan tanggal
   file**; isi file tidak dibaca.
4. Database: path baru menjadi lagu baru; path yang sudah ada diperbarui ukuran dan tanggalnya;
   lagu yang path-nya hilang ditandai `missing`; awalan nama tak dikenal masuk "Needs review".
5. Lagu langsung terlihat di admin dan di halaman vokalis (tanpa audio, tombol ▶ redup).

### 5.2 Audio player (M4A ke R2)

1. Jeffry mengekspor **sendiri** file `Nama - Judul.m4a` di folder yang sama dengan WAV-nya.
   Sistem tidak mengonversi apa pun.
2. Evo Media Agent (tiap 15 detik) menemukan M4A yang punya pasangan WAV bernama sama dan sudah
   tercatat sebagai lagu.
3. Agent menghitung MD5, mengunggah ke R2 dengan kunci `m4a/<id lagu>/<md5>.m4a`, lalu memeriksa
   ukuran dan MD5 di R2.
4. Agent memanggil `register_audio` (satu baris per lagu dan revisi; ditimpa bila sudah ada).
5. Agent **menghapus M4A di komputer** secara permanen.
6. Gagal di langkah mana pun: M4A tidak dihapus, dicoba lagi (30 dtk → 1 → 5 → 15 → 30 menit).

Jadi sekarang **unggah M4A otomatis begitu file terdeteksi**, tanpa keputusan admin.

### 5.3 Vokalis mendengarkan

Tombol ▶ → `/audio/<token>/<id lagu>` → fungsi Cloudflare bertanya `get_audio_key` (lagu milik
pemegang token, audio revisi terbaru) → mengalirkan file dari R2 dengan dukungan seek. Jawaban
disimpan browser sampai 1 jam; kunci R2 di-cache fungsi 60 detik.

### 5.4 Accept dan unggah WAV ke Drive

1. Vokalis menekan **Accept** → dialog → `accept_song`: `accepted_at` diisi, dan dibuat satu baris
   `wav_uploads` berstatus `waiting` untuk (lagu, revisi) itu.
2. Media Agent di komputer yang memegang sumber lagu itu mengambil pekerjaan lewat `wav_jobs`.
3. Agent melapor `uploading`, menghitung MD5 file lokal, mengunggah ke Drive dengan label
   `evoUploadId = id pekerjaan`, lalu membandingkan MD5 dan ukuran yang dilaporkan Drive.
4. Agent melapor `complete`. Batas 40 WAV per vokalis diterapkan: yang paling lama ditandai untuk
   dihapus dari Drive.
5. Halaman vokalis memeriksa ulang tiap 15 detik selama masih "Preparing…".

Gagal: status `failed`, dicoba lagi dengan jeda 1, 2, 5, 15, 30, 60, 120, 240 menit, **paling
banyak 8 kali**. Status `uploading` yang diam lebih dari 30 menit dianggap macet dan diulang.
Kalau komputer pemilik file mati, pekerjaan menunggu tanpa batas.

### 5.5 Send to FC, unduhan operator dan vokalis

- **Send to FC** → `send_to_fc`: mengisi `sent_at`. Lagu muncul di halaman operator.
- **Operator Download** → `/dl/<fc_token>/<id>` → `operator_download` mencatat unduhan, fungsi
  Cloudflare mengalirkan WAV dari Drive. Di halaman, lagu pindah ke folder vokalisnya.
- **Vokalis Download** → `/vdl/<token>/<id lagu>` → `vocalist_download`, cara yang sama.

### 5.6 Revision (vokalis)

`request_revision`: `accepted_at` dikosongkan, `revision_requested_at` dan catatan diisi, lalu
`_cancel_wav_upload`: pekerjaan yang belum terunggah dihapus, yang sudah terunggah ditandai
`cancelled`. Agent kemudian **menghapus file dari Drive secara permanen**. Lagu muncul di menu
"Revisions" admin. **WAV lokal tidak disentuh, dan audio lama masih bisa diputar vokalis.**

### 5.7 Replace with revision (admin)

Cara kerja sekarang mengharuskan **file revisi bernama berbeda**: admin memilih lagu lama, lalu memilih file
lain milik vokalis yang sama. `replace_song` memindahkan path, ukuran dan audio file baru ke lagu
lama, menaikkan `revision`, menghapus baris lagu baru, dan memasukkan path lama ke `ignored_paths`.
Harga dan status lunas lagu lama dipertahankan. Ditolak kalau lagu sudah di-Accept (harus Unlock).

### 5.8 Unlock, Remove, Restore

- **Unlock** (admin): membatalkan Accept dan membatalkan unggahan WAV, tanpa tanda revisi.
- **Remove from list**: `deleted = true`. Lagu hilang dari halaman vokalis dan tidak ditambahkan
  lagi oleh sync. File apa pun tidak dihapus.
- **Restore**: `deleted = false`.

## 6. Sistem tombol

### Halaman vokalis (per lagu, dari kiri ke kanan)

| Tombol | Muncul kalau | Yang terjadi |
|---|---|---|
| **Accept** | lagu belum di-Accept | dialog → `accept_song` → lagu terkunci, WAV diantrekan ke Drive |
| **⬇ Download WAV** | sudah Accept dan WAV ada di Drive | unduh lewat `/vdl` |
| **Revision** | sudah Accept | dialog + catatan → `request_revision` → kembali ke Accept, badge "Revision requested" |
| **Preparing…** (mati) | sudah Accept, WAV belum di Drive | menunggu agent |
| **Send to FC** | WAV sudah di Drive, belum dikirim | dialog → `send_to_fc` |
| **Sent** (mati) | sudah dikirim, operator belum unduh | |
| **Downloaded** (mati) | operator sudah unduh | |
| **Unavailable** (mati) | WAV sudah dihapus dari Drive | |
| **▶** | selalu; redup kalau belum ada audio | putar di player bawah |

### Halaman admin

| Tombol / aksi | Yang terjadi |
|---|---|
| Pilihan harga, Custom… | `songs.price` |
| Mark paid / ✓ Paid | `songs.paid` (butuh harga dulu) |
| Klik kanan judul → Replace with revision… | `replace_song` (terkunci kalau sudah Accept) |
| Klik kanan → Unlock | `unlock_song` |
| Klik kanan → Remove from list | `deleted = true` |
| Deleted → Restore | `deleted = false` |
| Needs review → Assign | `assign_prefix` (awalan jadi alias vokalis) |
| Revisions → Replace with revision… | membuka dialog Replace untuk lagu itu |
| Revisions → Open table | pindah ke tabel vokalis itu |
| Revisions → Dismiss | menghapus tanda dan catatan revisi; lagu bisa di-Accept lagi apa adanya |
| Settings | foto vokalis, nama tampil, link vokalis baru, link operator, harga publik |
| Reload | muat ulang data |

Badge status WAV di admin: WAV waiting, WAV uploading…, On Drive, Sent to FC, Downloaded by FC,
WAV failed, WAV cancelled, Cleaned from Drive.

### Halaman operator

Download per lagu, Download all new, dan laci berisi "New songs" serta folder per vokalis.

## 7. Retry dan penjaga (supervisor)

| Mekanisme | Di mana | Perilaku |
|---|---|---|
| Penjaga proses | `first-club-supervisor.js`, `evo-media-supervisor.js` | menyalakan lagi program yang mati; jeda 2 → 5 → 15 → 60 → 300 dtk; satu instance lewat `supervisor.pid` |
| Autostart | Windows: file VBS di Startup. Mac: launchd `id.evolution.firstclub.sync` / `.media`, KeepAlive | |
| Update otomatis | `watchSelf` | program keluar sendiri bila file `.js`-nya berubah, penjaga menyalakan versi baru |
| Retry M4A | memori agent | hilang saat restart; tidak masalah karena folder dipindai ulang |
| Retry WAV | kolom `attempts`, `next_attempt_at` di database | bertahan saat restart; berhenti setelah 8 kali |
| Anti-dobel WAV | label `evoUploadId` di Drive + unik (lagu, revisi) di database | upload yang sudah selesai tidak diulang |
| Anti-dobel M4A | kunci R2 berisi MD5 + cek HEAD sebelum unggah | isi yang sama tidak diunggah dua kali |
| Sumber tidak tersambung | drive backup dicabut → dilewati | lagunya tidak ditandai hilang |

## 8. Celah yang ditemukan

Diurutkan dari yang paling berpengaruh pada rencana peningkatan.

| # | Celah | Akibat |
|---|---|---|
| G1 | Identitas lagu adalah path. Ekspor ulang dengan **nama yang sama** hanya memperbarui ukuran dan tanggal, tanpa jejak bahwa isinya berubah. | Sistem tidak tahu ada versi baru. |
| G2 | Accept setelah Revision pada revisi yang sama memakai lagi file Drive lama kalau belum sempat dihapus (cabang `complete` di `accept_song`). | Bila WAV diekspor ulang dengan nama sama dan agent sedang mati, operator bisa menerima **WAV lama**. Hari ini tidak terjadi karena revisi memakai nama file baru. |
| G3 | Unggah WAV mencari file lewat path saat unggah, tanpa membandingkan dengan file saat Accept. | File yang dirender ulang di antara Accept dan unggah ikut terkirim tanpa diketahui. |
| G4 | M4A dipasangkan dengan WAV hanya lewat nama, dan diunggah otomatis. | Audio yang didengar vokalis belum tentu berasal dari WAV yang nanti dikirim. |
| G5 | Setelah Revision, audio lama tetap bisa diputar. | Bertentangan dengan aturan baru. |
| G6 | Satu baris heartbeat `media` untuk semua komputer; tidak ada identitas perangkat. | Admin tidak bisa melihat komputer mana yang mati. |
| G7 | Judul yang sama di dua sumber menjadi dua lagu terpisah. | Belum ada kasus lintas sumber di data live; ada 2 kelompok judul kembar dalam satu vokalis. |
| G8 | Objek R2 tidak pernah dihapus (`r2.js` tidak punya fungsi hapus). | File yatim menumpuk setelah audio diganti. |
| G9 | Remove from list pada lagu yang sudah Accept tidak membatalkan WAV di Drive. | File tertinggal. Belum ada kasus. |
| G10 | Setelah 8 kali gagal, unggah WAV berhenti selamanya; admin tidak punya tombol "coba lagi", dan teks badge tetap "retrying automatically". | Bisa macet diam-diam. |
| G11 | Sesi upload resumable tidak disimpan. | Restart di tengah unggah mengulang dari nol (tidak menimbulkan dobel, hanya lambat). |
| G12 | Scanner mengambil semua subfolder di bawah `Mixdown`. | Folder `Cancel Song` yang direncanakan akan terbaca sebagai lagu baru kalau tidak dikecualikan lebih dulu. |
| G13 | Cache browser 1 jam + cache kunci 60 detik di `/audio`. | "Langsung tidak bisa diakses" tidak tercapai tanpa perubahan header. |
| G14 | Hapus di Drive bersifat permanen, bukan ke Trash. | Tidak ada jalan kembali kalau salah hapus. |
| G15 | "File selesai" ditentukan hanya dari jeda 15 detik sejak perubahan terakhir. | Render yang berhenti menulis lebih dari 15 detik bisa dianggap selesai. |
| G16 | Satu kunci agent untuk semua perangkat. | Tidak bisa mencabut satu perangkat saja. |

## 9. Ketidaksesuaian dokumentasi dengan kode

| Dokumen / komentar | Tertulis | Kenyataan |
|---|---|---|
| `README.md`, `ARCHITECTURE.md` | nama "FC Song Manager"; player "placeholder, belum ada sumber audio"; Send to FC "alur belum diputuskan"; rencana WhatsApp; tabel `upload_jobs`, `delivery_jobs` | nama Evo Song Manager; audio dari R2; Send lewat halaman operator; WhatsApp dibatalkan; tabel aslinya `wav_uploads` (dan `deliveries` kosong) |
| `ARCHITECTURE.md` | tidak menyebut R2, Google Drive, Pages Functions, halaman operator, MacBook, Media Agent | semuanya sudah berjalan |
| `functions/dl/[token]/[id].js` (komentar) | unduhan pertama menyembunyikan lagu lama | sejak 11 Nov tidak lagi |
| `web/js/apps/admin/songs.js` (teks badge) | "Cleaned from Drive … after a newer song was downloaded by FC" | penyebabnya sekarang batas 40 per vokalis atau Revision |
| `drive/evo-media-agent.js` (kepala file) | hanya menyebut M4A | juga mengurus WAV ke Drive |
| `web/js/apps/vocalist/songlist.js` (komentar) | "nanti: kirim ke FC lewat WhatsApp" | sudah lewat halaman operator |
| `db/2026-11-10_*.sql` | aturan pembersihan dan `operator_hidden_at` | diganti oleh `db/2026-11-11_operator_folders.sql` |
| Folder `db/` | dianggap lengkap | migrasi `archive_paid_without_price`, `agent_vocalists`, `audio_agent_accepts_sync_secret` tidak punya file sendiri |
| `web/v.html` | menu "Video Call — soon" | fitur ditunda; itemnya masih tampil |

Sisa yang tidak dipakai: tabel `deliveries` dan `recipients`, fungsi `cleanup_done` (masih bisa
dipanggil publik), kolom `operator_hidden_at`, kunci di tabel `agent_secret` (masih diterima `agent_ok`, tidak dipakai agent), halaman player terpisah
(`web/player.html`, hanya cadangan kalau modul player gagal).
