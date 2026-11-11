# IMPLEMENTATION_ROADMAP — Rencana pengerjaan bertahap

Delapan fase kecil. Setiap fase bisa dirilis sendiri, diuji sendiri, dan dibatalkan sendiri. Fase 0–2
tidak mengubah apa pun yang dilihat vokalis atau operator. Perilaku baru dinyalakan lewat saklar
`app_settings.manual_finalization`, jadi kode baru bisa terpasang lebih dulu tanpa mengubah workflow.

## Urutan dan dependensi

```
F0 Pengaman dasar ──► F1 Perangkat + fingerprint ──► F2 Versi + backfill
                                                         │
                                   ┌─────────────────────┤
                                   ▼                     ▼
                       F3 Manual Finalization     F6 Konflik multi-perangkat
                                   │
                                   ▼
                       F4 Accept terikat versi
                                   │
                                   ▼
                       F5 Revision + Cancel Song
                                   │
                                   ▼
                       F7 Recovery + rekonsiliasi + pembersihan R2
```

Pengujian memakai perangkat uji yang sudah ada: uji halaman (Playwright + database palsu), uji agent
(`agenttest/`), uji fungsi Cloudflare (`fntest/`), dan Postgres lokal untuk migrasi.

---

## F0 — Pengaman dasar (tanpa perubahan workflow) — SELESAI 11 Nov 2026

| | |
|---|---|
| Tujuan | Menutup celah yang berbahaya bagi fase berikutnya |
| Modul | `sync/lib/scanner.js`, `drive/lib/scan.js`: abaikan folder `Cancel Song`. `web/js/apps/admin/songs.js`: tombol "Retry upload" untuk WAV yang gagal 8 kali; teks badge yang sudah tidak benar |
| Database | `accept_song`: hapus cabang yang memakai ulang file Drive lama (G2); `retry_wav(song)` untuk admin |
| Functions | tidak ada. Perubahan header cache `/audio` dipindah ke F5 (baru dibutuhkan di sana, dan perlu diuji di iPhone) |
| Agent | tidak ada selain pengecualian folder |
| UI | satu tombol di menu klik kanan admin |
| Risiko | Sangat kecil. Player mengirim satu permintaan 304 tambahan per pemutaran ulang |
| Uji | uji halaman yang ada + kasus baru: Revision → Accept selalu `waiting`; folder `Cancel Song` tidak terbaca |
| Rollback | kembalikan fungsi lama dari `db/`; revert commit |

## F1 — Identitas perangkat dan fingerprint (hanya mengumpulkan data) — SELESAI 11 Nov 2026

| | |
|---|---|
| Tujuan | Database tahu isi setiap WAV dan komputer mana pemiliknya |
| Modul | baru `sync/lib/device.js`, `sync/lib/fingerprint.js` (SHA-256 + MD5 streaming, cache lokal); `sync/lib/scanner.js`, `pusher.js`; `drive/lib/db.js` |
| Database | tabel `devices`, `file_candidates`; `device_hello`; `sync_files` menerima `p_device` dan fingerprint (opsional) |
| Functions | tidak ada |
| Agent | Sync menghitung fingerprint. Pindai pertama membaca semua WAV sekali (ratusan file, beberapa menit, dibatasi supaya tidak mengganggu DAW); sesudahnya hanya file yang berubah |
| UI | Settings admin: daftar perangkat dan kapan terakhir terlihat (menutup G6) |
| Risiko | Beban disk saat pindai pertama. Drive `backup` yang dicabut: kandidatnya menyusul saat tersambung |
| Uji | uji agent: nama sama isi beda → dua kandidat; file sedang ditulis → dilewati; cache dipakai. Uji migrasi di Postgres lokal dengan Sync lama dan baru bersamaan |
| Rollback | Sync lama tetap kompatibel; tabel baru boleh dibiarkan kosong |

## F2 — Versi dan backfill — SELESAI 11 Nov 2026

| | |
|---|---|
| Tujuan | Setiap lagu yang sudah punya audio punya satu versi warisan; belum ada perilaku baru |
| Modul | tidak ada kode web/agent baru |
| Database | `song_versions`, `jobs`, kolom baru di `songs`, `wav_uploads`, `app_settings`; skrip backfill (lihat `DATABASE_CHANGE_PROPOSAL.md` bagian 6) |
| Risiko | Backfill salah memasangkan versi. Dicegah dengan menjalankannya dulu sebagai laporan (tanpa menulis) dan memeriksa jumlah: 109 versi, 40 unggahan terikat |
| Uji | salinan skema di Postgres lokal; bandingkan `get_vocalist_report` sebelum dan sesudah — harus identik |
| Rollback | kolom dan tabel baru tidak dibaca kode lama; cukup dikosongkan |

### Hasil penerapan F1+F2 (11 Nov 2026)

- Perangkat `Evolution` (Windows, sumber `pc` + `backup`) terdaftar; kedua programnya melapor.
- Sidik jari: 107 kandidat untuk sumber `pc` (selesai), `backup` dicicil karena drive USB lambat.
- Backfill: **89 versi warisan** dibuat untuk lagu yang sudah punya audio; **22 unggahan WAV**
  terikat ke versinya, **0 MD5 tidak cocok** (artinya semua WAV di Drive masih sama persis dengan
  file di komputer).
- Belum punya versi: 20 lagu `mac` (MacBook mati; menyusul sendiri) dan 3 lagu yang pernah
  di-Accept tetapi tidak punya M4A sama sekali (`Intro`, `Medley - Opening`, `不再犹豫`).
  Ketiganya mendapat versi saat difinalisasi di F3.
- MacBook belum dipasangi program F0–F2; dipasang saat tersambung lagi.

## F3 — Manual Finalization

| | |
|---|---|
| Tujuan | Unggah M4A hanya setelah admin menekan "Selesaikan & Upload" |
| Modul | baru `web/js/apps/admin/finalize.js` (modul terpisah, mengikuti aturan `ARCHITECTURE.md`); `admin/main.js`, `admin/data.js`, `admin/songs.js` (badge status); baru `drive/lib/finalize.js`, `drive/lib/jobs.js`; `drive/lib/r2.js` (+ `remove`); `drive/evo-media-agent.js`; `sync/lib/scanner.js` + `fingerprint.js` (melaporkan M4A pasangan) |
| Database | `list_candidates`, `finalize_song`, `cancel_finalize`, `retry_job`, `claim_jobs`, `job_progress`, `job_finish`, `activate_version`; `get_audio_key` dan `get_vocalist_report` membaca versi aktif |
| Functions | `/audio` tidak berubah bentuk (kunci datang dari database) |
| Agent | Media Agent 2.0: pekerja finalisasi; jalur "M4A otomatis" **dimatikan saat saklar menyala** dan tetap ada saat saklar mati |
| UI | Admin: panel kandidat per lagu, tombol "Selesaikan & Upload", status Finalizing / Finalize failed / Waiting for device. Vokalis: tidak berubah |
| Risiko | M4A tertinggal saat hanya WAV dirender ulang (diberi peringatan, K10); M4A menumpuk di folder Mixdown sampai admin memfinalisasi; salah memilih kandidat |
| Uji | uji agent dengan R2 palsu: klik ganda → satu pekerjaan; mati di tiap tahap → lanjut; fingerprint berubah → needs admin; M4A tidak ada → ditolak; M4A lebih lama → peringatan; R2 menolak → retry. Uji nyata dengan satu lagu uji di PC dan satu di MacBook sebelum saklar dinyalakan |
| Rollback | matikan saklar: jalur M4A lama aktif lagi; versi yang sudah dibuat tetap sah |

## F4 — Accept terikat versi

| | |
|---|---|
| Tujuan | WAV yang ke Drive pasti file yang difinalisasi |
| Modul | `drive/lib/wav.js`, `drive/lib/gdrive.js` (label versi); `web/js/apps/admin/songs.js` (badge "WAV needs admin") |
| Database | `accept_song`, `wav_jobs`, `wav_report` (+ sewa, `needs_admin`) |
| UI | Vokalis: tidak berubah. Admin: pesan jelas bila fingerprint tidak cocok, dengan pilihan "Finalize ulang file yang sekarang" |
| Risiko | Lagu warisan yang WAV-nya berubah setelah M4A dibuat akan tertahan. Itu memang yang diinginkan, tetapi bisa muncul beberapa kasus saat pertama dinyalakan |
| Uji | uji agent: file diganti di antara Accept dan unggah → berhenti; file dipindah tapi isi sama → ditemukan |
| Rollback | saklar mati → perilaku lama (cari lewat path) |

## F5 — Revision dan Cancel Song

| | |
|---|---|
| Tujuan | Revision mencabut akses, membuang file Drive ke Trash, dan mengarsipkan WAV lokal |
| Modul | baru `drive/lib/archive.js`; `drive/lib/gdrive.js` (`trash`); `web/js/apps/vocalist/songlist.js`, `player.js`, `send.js` (status On revision); `web/js/apps/admin/requests.js` (status arsip) |
| Database | `request_revision` versi lengkap; `get_audio_key`, `vocalist_download`, `send_to_fc` menolak saat On Revision |
| Functions | `/audio`: `cache-control: private, no-cache` + ETag, cache kunci 60 → 10 detik (diuji di iPhone sebelum rilis). `/vdl`, `/dl`: tidak berubah bentuk |
| Agent | pekerja `archive_wav` dan `drive_remove` |
| UI | Vokalis: badge "On revision", tombol ▶/Download/Send mati. Admin: "Old WAV not archived yet" / "Archived to Cancel Song" |
| Risiko | **Ini satu-satunya fase yang memindahkan file di komputer.** Lihat `RISK_ANALYSIS.md` R1, R2, R4 |
| Uji | uji agent di folder sementara: tujuan sudah ada (isi sama / beda), file terkunci, mati di antara link dan hapus, fingerprint tidak cocok → tidak dipindah. Uji nyata pertama dengan lagu uji, bukan lagu klien |
| Rollback | saklar kedua `archive_on_revision`: bila mati, Revision tidak memindah file. File yang sudah diarsipkan tinggal dipindah kembali dengan tangan; path-nya tercatat |

## F6 — Konflik multi-perangkat

| | |
|---|---|
| Tujuan | Nama sama di dua perangkat ditampilkan sebagai kandidat satu lagu, admin yang memilih |
| Modul | `web/js/apps/admin/finalize.js` (tampilan konflik), `admin/main.js` (jumlah konflik di menu) |
| Database | `sync_files`: mencocokkan lagu lewat (vokalis, judul yang dinormalkan) lintas sumber; view `song_conflicts` |
| Risiko | Dua kelompok judul kembar yang sudah ada dalam satu vokalis harus diputuskan dulu: memang dua lagu, atau satu lagu dua file. **Tidak digabung otomatis** |
| Uji | dua sumber, nama sama, isi beda / isi sama; satu perangkat offline lalu online |
| Rollback | penggabungan hanya terjadi saat admin memilih; view bisa dihapus tanpa akibat |

## F7 — Recovery, rekonsiliasi, pembersihan

| | |
|---|---|
| Tujuan | Sistem pulih sendiri dan admin bisa melihat keadaannya |
| Modul | baru `drive/lib/reconcile.js`; baru `web/js/apps/admin/system.js` (panel "System": perangkat, pekerjaan macet, temuan) |
| Database | `reconcile_report`; pekerjaan `r2_remove` tertunda 24 jam |
| Agent | rekonsiliasi saat menyala dan tiap 10 menit; pembersihan objek R2 yatim hanya lewat pekerjaan |
| Risiko | Pembersih yang salah menghapus objek yang masih dipakai. Dicegah: hanya menghapus kunci yang tercatat di versi `superseded`/`cancelled`, tidak pernah berdasarkan daftar isi bucket |
| Uji | matikan agent di tiap tahap (uji agent); putuskan jaringan; database menolak; R2/Drive mengembalikan 5xx |
| Rollback | rekonsiliasi dan pembersihan bisa dimatikan lewat pengaturan agent tanpa memengaruhi unggahan |

---

## Keputusan yang dibutuhkan sebelum F3

| # | Pertanyaan | Rekomendasi | Alasan |
|---|---|---|---|
| K10 | Kalau hanya WAV yang dirender ulang (M4A tertinggal) | Finalisasi tetap boleh, tapi admin diberi peringatan selisih waktu render | Menolak otomatis berisiko menghalangi pekerjaan yang sebenarnya benar |
| ~~K1~~ | Siapa yang membuat M4A? | **DIJAWAB 11 Nov: Jeffry merender WAV + M4A sekaligus dari Studio One.** Sistem tidak mengonversi; finalisasi memakai M4A apa adanya dan menolak kalau M4A tidak ada | Lebih sederhana: tidak ada `ffmpeg`/`afconvert`, tidak ada tahap CONVERT, dan M4A memang satu render dengan WAV |
| K2 | File Drive saat Revision | Pindah ke Trash | Bisa dikembalikan 30 hari; sekarang dihapus permanen |
| K3 | Nama di `Cancel Song` saat bentrok | Subfolder `<tanggal> v<nomor>/` berisi nama asli | Nama file tetap bersih, tidak pernah menimpa |
| K4 | Salinan WAV per versi di disk | Tidak | MacBook hampir penuh; diganti pemeriksaan fingerprint |
| K5 | Unlock oleh admin memindah WAV? | Tidak; hanya Revision yang mengarsipkan | Unlock untuk Accept yang tidak sengaja |
| K6 | Lagu lama (258) | Tetap seperti sekarang lewat versi warisan | Tidak ada pekerjaan ulang |
| K7 | Replace with revision (nama file lain) | Dipertahankan, dialirkan lewat finalisasi | Untuk file yang terlanjur dinamai berbeda |
| K9 | Dismiss permintaan revisi | Menjadi "Restore previous version" (kembalikan WAV dari Cancel Song, aktifkan lagi versi lama) | Alternatif lebih sederhana: Dismiss dihapus, admin cukup memfinalisasi ulang file yang sama |

## Perkiraan ukuran pekerjaan

| Fase | Ukuran | Menyentuh file di komputer |
|---|---|---|
| F0 | kecil | tidak |
| F1 | sedang | hanya membaca |
| F2 | kecil | tidak |
| F3 | besar | membuat M4A sementara |
| F4 | sedang | hanya membaca |
| F5 | sedang | **memindah WAV** |
| F6 | sedang | tidak |
| F7 | sedang | tidak |
