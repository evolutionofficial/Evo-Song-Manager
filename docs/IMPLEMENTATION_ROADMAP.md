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

## F3 — Manual Finalization — KODE SELESAI 11 Nov 2026, saklar masih mati

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

### Keadaan F3 (11 Nov 2026)

Database dan program sudah terpasang; perilaku lama masih berlaku karena
`app_settings.manual_finalization` masih `false`.

- Database: 13 fungsi diterapkan. Diverifikasi dengan membandingkan definisi fungsi di database
  asli terhadap salinan uji lokal (setelah komentar dibuang, keduanya identik).
- MacBook: Evo Media Agent **2.0** berjalan.
- PC: Evo Media Agent **2.0** berjalan (diperbarui 11 Nov 09.41).

**Perbaikan 3b (11 Nov).** Dua jebakan ditemukan sebelum saklar dinyalakan dan sudah ditutup:

1. 149 lagu lama tidak punya versi aktif karena M4A-nya sudah dihapus program lama. Kalau saklar
   menyala, lagu-lagu itu tidak akan bisa di-Accept vokalis, dan tidak mungkin difinalisasi
   (M4A-nya hilang). Sekarang mereka punya versi warisan **tanpa** `m4a_key`: WAV-nya terikat
   sidik jari, audionya tetap tidak ada persis seperti sekarang, dan Accept tetap jalan.
2. Kalau Studio One merender ulang WAV dengan isi yang sama persis, sidik jarinya tidak berubah,
   dan `finalize_song` akan menjawab "already_active" sehingga M4A baru tidak pernah diunggah.
   Sekarang "already_active" hanya berlaku kalau versi aktif itu memang sudah punya audio.

Setelah 3b: **258 dari 258 lagu punya versi aktif** (109 dengan audio, 149 tanpa audio), dan
semua unggahan WAV terikat ke versinya dengan 0 MD5 tidak cocok.

Ditambahkan juga tombol **"Finalize all ready"** per vokalis: memfinalisasi lagu yang jelas
(tepat satu file yang ada, punya M4A, M4A tidak ketinggalan), dan melewati yang ambigu sambil
menyebut alasannya satu per satu.

Dua langkah tersisa sebelum F3 benar-benar hidup, keduanya menunggu Jeffry:

1. Nyalakan saklar `manual_finalization`. **Ini momen "go live"**: sejak itu M4A tidak lagi
   diunggah otomatis di semua komputer, dan menunggu di folder Mixdown sampai difinalisasi.
   Ditunda atas permintaan Jeffry sampai ia siap merender lagu uji (11 Nov).
2. Uji satu lagu dari ujung ke ujung: render WAV + M4A → pilih kandidat → Finalize & Upload →
   vokalis bisa mendengarkan.

Catatan: `finalize_song` berfungsi walau saklar mati, tetapi tanpa saklar program masih mengunggah
dan menghapus M4A otomatis beberapa detik setelah render, jadi tidak ada yang bisa difinalisasi.
Karena itu uji coba harus dilakukan setelah saklar menyala.

## F4 — Accept terikat versi — SELESAI 11 Nov 2026

| | |
|---|---|
| Tujuan | WAV yang ke Drive pasti file yang difinalisasi |
| Modul | `drive/lib/wav.js`, `drive/lib/gdrive.js` (label versi); `web/js/apps/admin/songs.js` (badge "WAV needs admin") |
| Database | `accept_song`, `wav_jobs`, `wav_report` (+ sewa, `needs_admin`) |
| UI | Vokalis: tidak berubah. Admin: pesan jelas bila fingerprint tidak cocok, dengan pilihan "Finalize ulang file yang sekarang" |
| Risiko | Lagu warisan yang WAV-nya berubah setelah M4A dibuat akan tertahan. Itu memang yang diinginkan, tetapi bisa muncul beberapa kasus saat pertama dinyalakan |
| Uji | uji agent: file diganti di antara Accept dan unggah → berhenti; file dipindah tapi isi sama → ditemukan |
| Rollback | saklar mati → perilaku lama (cari lewat path) |

## F5 — Revision dan Cancel Song — SELESAI 11 Nov 2026

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

## F6 — Konflik multi-perangkat — SELESAI 11 Nov 2026

| | |
|---|---|
| Tujuan | Nama sama di dua perangkat ditampilkan sebagai kandidat satu lagu, admin yang memilih |
| Modul | `web/js/apps/admin/finalize.js` (tampilan konflik), `admin/main.js` (jumlah konflik di menu) |
| Database | `sync_files`: mencocokkan lagu lewat (vokalis, judul yang dinormalkan) lintas sumber; view `song_conflicts` |
| Risiko | Dua kelompok judul kembar yang sudah ada dalam satu vokalis harus diputuskan dulu: memang dua lagu, atau satu lagu dua file. **Tidak digabung otomatis** |
| Uji | dua sumber, nama sama, isi beda / isi sama; satu perangkat offline lalu online |
| Rollback | penggabungan hanya terjadi saat admin memilih; view bisa dihapus tanpa akibat |

## F7 — Recovery, rekonsiliasi, pembersihan — SELESAI 11 Nov 2026

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


---

## Keadaan setelah F7 (11 Nov 2026)

Seluruh fase kode selesai dan terpasang di produksi. Database diverifikasi dengan membandingkan
definisi tiap fungsi terhadap salinan uji yang lulus (setelah komentar dibuang: identik).

Satu hal yang masih menunggu Jeffry: **saklar `manual_finalization` masih mati.** Sampai saklar itu
dinyalakan, M4A tetap diunggah otomatis dan tombol "Finalize & Upload" tidak akan pernah menemukan
M4A untuk difinalisasi. Semua perilaku lain dari F4–F7 sudah hidup sekarang, termasuk alur Revision
yang baru, arsip Cancel Song, halaman Conflicts dan halaman System.

Perbaikan di luar rencana yang muncul saat pengerjaan:
- **3b** — 149 lagu lama hampir tersangkut tanpa versi; dan `finalize_song` menolak mengunggah M4A
  kalau render ulang menghasilkan WAV yang isinya sama persis.
- **5b** — syarat yang terlalu ketat membuat lagu baru (yang dibuat selagi saklar mati) tidak bisa
  diputar vokalis. Ditemukan dari log PC, bukan dari tes. Sudah diperbaiki dan diberi tes.
- Tombol ber-atribut `hidden` tidak benar-benar hilang karena `display:inline-flex` pada `button`.

## F8 — Listen Together — SELESAI 11 Nov 2026

Fitur besar terakhir dari daftar: menyimak mixdown bersama vokalis tanpa kualitas musiknya turun.
Rancangan lengkap dan angka ketepatannya ada di `VIDEO_CALL_DESIGN.md`.

| Bagian | Isi |
|---|---|
| Database | `listen_rooms`, `listen_open/close/active/room_for/songs`; `get_audio_key` menerima kode ruang |
| Mesin | `web/js/core/listen.js` — selisih jam, ramalan posisi, koreksi hanyutan |
| Sisi admin | dok di bawah layar + pemutar pertama di halaman admin |
| Sisi vokalis | undangan muncul sendiri, tombol Join, pemutar mengikuti pemimpin |

Keputusan rancangan yang penting: **kode ruang diperlakukan sama seperti `share_token` vokalis
di dalam `get_audio_key`.** Jadi tidak ada aturan izin kedua yang bisa menyimpang dari yang
pertama; lagu yang dihapus, sedang revisi, atau belum punya audio tetap tertutup. Diperiksa pada
data produksi: sidik jari kunci audio untuk 263 pasangan vokalis/lagu identik sebelum dan sesudah.

Tes: 32 pemeriksaan database (termasuk bahwa kode ruang TIDAK bisa menembus penjagaan), 34
pemeriksaan mesin di node (termasuk jam yang berbeda 37 detik), dan 36 pemeriksaan dua halaman
sungguhan lewat Playwright. Seluruh 216 pemeriksaan yang sudah ada tetap lolos.

Dua hal yang ditemukan karena diuji, bukan karena dibaca ulang:
- `gen_random_bytes` ada di skema `extensions` di Supabase, jadi **tidak terbaca** dari fungsi
  ber-`search_path` kosong. Diganti ke `gen_random_uuid` yang ada di `pg_catalog`. Kalau tidak
  diuji, `listen_open` akan gagal di produksi.
- Membuka tampilan penuh pemutar saat vokalis ikut menutupi spanduk, sehingga tombol **Leave**
  tidak bisa dijangkau. Pembukaan otomatis itu dibuang.

Juga: tambalan `[hidden]` yang ketiga diganti satu aturan umum untuk seluruh stylesheet, karena
bug yang sama sudah muncul tiga kali (tombol operator, "Finalize all ready", spanduk Listen
together).

**Masih menunggu keputusan Jeffry:** suara ngobrolnya lewat mana — WhatsApp seperti biasa
(rekomendasi saya) atau dibangun di dalam aplikasi (WebRTC). Bagian 5 di `VIDEO_CALL_DESIGN.md`.
Penyelarasan pemutaran yang sudah jadi tidak berubah apa pun di kedua pilihan.

## F9 — Panggilan suara di dalam ruang menyimak — SELESAI 12 Nov 2026

Jeffry memilih membangun suara di dalam aplikasi (bukan memakai WhatsApp), jadi ruang menyimak
sekarang membawa panggilan WebRTC sungguhan berdampingan dengan musik yang diselaraskan.

**Musiknya tetap TIDAK lewat panggilan.** Codec panggilan dibuat untuk suara bicara; kalau musik
ikut dikirim lewat sana hasilnya lebih buruk daripada memutar salinan sendiri. Jadi panggilan hanya
membawa suara orang, dan musik tetap ditangani F8.

| Bagian | Isi |
|---|---|
| Perundingan | menumpang saluran realtime F8 — tidak ada sambungan kedua yang bisa gagal sendiri |
| Relay | `/turn` membuat kredensial TURN Cloudflare berumur pendek, dijaga kode ruang |
| Mesin | `web/js/core/voice.js` — pola sopan/tidak sopan, mikrofon, kamera opsional |
| Antarmuka | baris panggilan di dok admin dan di spanduk vokalis |

`/turn` dijaga kode ruang karena TURN dibayar per GB: endpoint terbuka berarti kuota Jeffry bisa
dipakai siapa saja. Tanpa kunci TURN ia mengembalikan STUN saja dan mengatakannya, supaya tombolnya
tetap berguna di jaringan ramah alih-alih mati tanpa keterangan.

Dua bug nyata yang ditemukan tes dua-halaman, dan keduanya akan sangat sulit dilacak di produksi:

1. **Tawaran hilang.** Sisi yang membuat sambungan lebih dulu mengirim tawaran ke ruang yang belum
   ada penjawabnya, dan tidak ada yang pernah menawarkan lagi — panggilan menggantung selamanya.
   Sambungan sekarang dibuat hanya setelah KEDUA sisi punya mikrofon, dan pesan yang datang terlalu
   cepat disangga, bukan dibuang.
2. **Objek browser hidup dikirim lewat saluran.** `RTCSessionDescription` dan `RTCIceCandidate`
   tidak bisa disalin antar-konteks; transport yang kebetulan bisa mengubahnya sendiri hanya akan
   menyembunyikan kesalahan ini. Keduanya kini dikirim sebagai data biasa.

Tes: 51 pemeriksaan di dua halaman sungguhan dengan mikrofon tiruan Chromium. Panggilan mencapai
`live` di kedua sisi, track suara sungguhan diterima, bisu bekerja, dan **musik tetap serempak
selama panggilan (23 ms) dan setelah ditutup (2 ms)** — panggilan yang gagal tidak boleh menyentuh
musik, dan itu sekarang diuji, bukan diandaikan.

**Menunggu Jeffry:** kunci TURN harus dibuat di dashboard Cloudflare dan disimpan sebagai secret.
Langkahnya ada di `TURN_SETUP.md`. Aku tidak memegang kuncinya dan tidak membutuhkannya.

### Yang sengaja TIDAK dikerjakan

- Penggabungan otomatis lagu berjudul sama. Halaman Conflicts hanya menyajikan kandidat; admin
  yang memutuskan, karena penggabungan yang salah tidak bisa dibatalkan.
- Menyimpan sesi unggah Google Drive agar bisa dilanjutkan di tengah jalan (K4/D-sisa). Unggahan
  yang putus diulang dari awal: soal waktu, bukan duplikasi.
- Pembersihan tabel sisa WhatsApp (`deliveries`, `recipients`) dan kolom `operator_hidden_at`.
- Keserempakan sampai tingkat sampel. Tidak perlu untuk dua orang berjauhan dengan headphone.
