# EVO_SONG_MANAGER_TARGET_ARCHITECTURE — Arsitektur setelah peningkatan

Dokumen ini merancang peningkatan di atas sistem yang ada (lihat `EXISTING_SYSTEM_AUDIT.md`).
Prinsipnya: **menambah, bukan membongkar**. Hosting, database, R2, Drive, dua agent, penjaga, dan
semua halaman tetap. Yang berubah adalah apa yang dianggap "satu versi lagu" dan siapa yang
memutuskan kapan file diunggah.

## 1. Gagasan inti

Sekarang sistem mengenal lagu lewat **path file**. Target: sistem mengenal tiga hal terpisah.

| Konsep | Identitas | Artinya |
|---|---|---|
| **Lagu** (`songs`) | id lagu | Judul milik satu vokalis. Harga, lunas, Accept melekat di sini. Tidak berubah. |
| **Kandidat** (`file_candidates`) | perangkat + path + fingerprint | Satu file WAV nyata yang pernah dilihat agent. Nama sama dengan isi berbeda = kandidat berbeda. |
| **Versi** (`song_versions`) | id versi | Kandidat yang **dipilih admin** dan difinalisasi. Hanya versi aktif yang bisa didengar, di-Accept, dan dikirim. |

Semua pekerjaan (unggah M4A, unggah WAV, hapus Drive, arsip ke Cancel Song) menunjuk ke **id versi
dan fingerprint**, bukan ke nama file.

## 2. Peta arsitektur target

```
 PC Windows  (device: pc-…)                      MacBook  (device: mac-…)
 ┌─────────────────────────────────┐             ┌─────────────────────────────────┐
 │ First Club Sync                  │             │ First Club Sync                  │
 │  scan + fingerprint (SHA-256)    │             │  scan + fingerprint (SHA-256)    │
 │ Evo Media Agent                  │             │ Evo Media Agent                  │
 │  ├ finalisasi: validasi → M4A    │             │  ├ finalisasi: validasi → M4A    │
 │  │   → R2 → verifikasi           │             │  │   → R2 → verifikasi           │
 │  ├ WAV → Drive (cek fingerprint) │             │  ├ WAV → Drive (cek fingerprint) │
 │  ├ arsip WAV → Cancel Song       │             │  ├ arsip WAV → Cancel Song       │
 │  └ rekonsiliasi saat menyala     │             │  └ rekonsiliasi saat menyala     │
 └───────────────┬──────────────────┘             └───────────────┬──────────────────┘
                 │   klaim pekerjaan dengan sewa (lease) di database              │
                 ▼                                                                ▼
        ┌──────────────────────────────────────────────────────────────────────────┐
        │ Supabase Postgres — satu-satunya pengambil keputusan                       │
        │  songs · file_candidates · song_versions · jobs · wav_uploads · devices    │
        │  aturan: satu versi aktif per lagu, satu pekerjaan per kunci idempotensi   │
        └───────────────┬──────────────────────────────────────────────────────────┘
                        │
   Cloudflare Pages + Functions (tidak berubah bentuk)
   /audio hanya melayani versi aktif · /dl dan /vdl hanya melayani WAV versi aktif
                        │
            Admin  ·  Vokalis  ·  Operator
```

## 3. Pembagian tanggung jawab

| Layanan | Bertanggung jawab atas | Tidak boleh |
|---|---|---|
| **Supabase** | Kebenaran status; kunci pekerjaan; idempotensi; aturan "satu versi aktif"; siapa boleh mengakses apa | Menyentuh file |
| **First Club Sync** | Melaporkan apa yang ada di disk: nama, ukuran, tanggal, **fingerprint** | Memutuskan versi; mengunggah; memindah file |
| **Evo Media Agent** | Mengerjakan pekerjaan milik perangkatnya: validasi, konversi, unggah, verifikasi, arsip, rekonsiliasi | Membuat pekerjaan sendiri; memilih versi |
| **Cloudflare Functions** | Mengalirkan file kepada pemegang token yang berhak | Menyimpan status |
| **R2** | Menyimpan M4A dengan kunci berversi | — |
| **Google Drive** | Menyimpan WAV versi yang di-Accept | — |
| **Halaman Admin** | Memilih kandidat, menekan "Selesaikan & Upload", menyelesaikan konflik, melihat status sistem | Mengunggah file sendiri |

Dua agent tetap dua proses terpisah dengan penjaganya masing-masing. Sync tetap ringan dan
"hanya membaca"; semua yang mengubah file atau mengunggah ada di Media Agent.

## 4. Fingerprint

**Rekomendasi: SHA-256 sebagai identitas, MD5 tetap dihitung sebagai alat verifikasi transfer.**

| | MD5 | SHA-256 |
|---|---|---|
| Waktu hitung WAV 50 MB (diukur di mesin uji) | ±0,09 detik | ±0,05 detik |
| Tabrakan tak sengaja | praktis mustahil | praktis mustahil |
| Tabrakan yang disengaja | bisa dibuat | tidak ada yang diketahui |
| Dipakai R2 (ETag) dan Drive (`md5Checksum`) | ya | tidak |

Untuk kebutuhan proyek ini MD5 sebenarnya cukup, karena tidak ada pihak yang berusaha memalsukan
file. SHA-256 dipilih sebagai identitas karena biayanya sama kecilnya (waktu sebenarnya ditentukan
oleh kecepatan baca disk, bukan oleh algoritma) dan tidak perlu dipikirkan lagi. MD5 **tidak dibuang**: R2 dan Drive hanya bisa memverifikasi dengan MD5, jadi keduanya
dihitung dalam satu kali baca file.

Aturan perhitungan:

- Dihitung oleh agent secara otomatis, streaming, tanpa memuat file ke memori.
- Hasil disimpan lokal di cache `(path, ukuran, mtime) → fingerprint` supaya file yang tidak
  berubah tidak dibaca ulang tiap pemindaian.
- File yang berubah kurang dari 15 detik lalu tidak dihitung.
- Fingerprint **tidak pernah** ditulis ke nama file.

## 5. Identitas perangkat

Setiap komputer mendapat `device_id` (UUID) yang dibuat sekali saat instalasi dan disimpan di
`device.json` di folder agent (tidak masuk GitHub). Nama sumber yang ada (`pc`, `backup`, `mac`)
tetap dipakai; satu perangkat boleh punya beberapa sumber (PC punya `pc` dan `backup`).

Manfaat langsung: heartbeat per perangkat (menutup celah G6), dan setiap pekerjaan tahu perangkat
mana yang memegang filenya.

Catatan desain: finalisasi **dipicu dari halaman admin**, bukan dari perangkat. Jadi "dua perangkat
memfinalisasi lagu yang sama" tidak diputuskan oleh perangkat; database yang menolak permintaan
kedua. Perangkat hanya mengerjakan pekerjaan yang ditujukan kepadanya.

## 6. Pekerjaan (jobs), kunci, dan idempotensi

Satu tabel `jobs` untuk pekerjaan baru; `wav_uploads` yang sudah berjalan **tetap dipakai** untuk
unggah WAV dan hanya ditambah kolom versi dan fingerprint.

| Jenis pekerjaan | Dibuat oleh | Dikerjakan oleh |
|---|---|---|
| `finalize` | admin: "Selesaikan & Upload" | agent pemilik kandidat |
| unggah WAV (`wav_uploads`) | vokalis: Accept | agent pemilik file versi itu |
| `drive_remove` | Revision, Unlock, batas 40 | agent mana pun |
| `archive_wav` | Revision | agent pemilik file |
| `r2_remove` | versi lama tidak dibutuhkan lagi | agent mana pun |

Mekanisme:

- **Kunci idempotensi** unik di database. Untuk finalisasi: `finalize:<id lagu>:<sha256>`.
  Klik dua kali, request ganda dari browser, atau dua tab menghasilkan baris yang sama.
- **Sewa (lease) di database**, bukan kunci lokal: agent mengklaim pekerjaan dengan
  `FOR UPDATE SKIP LOCKED` dan mengisi `lease_owner = device_id`, `lease_until = sekarang + 5 menit`,
  lalu memperpanjangnya selama bekerja. Agent yang mati melepaskan pekerjaannya sendiri ketika sewa
  habis.
- **Satu finalisasi berjalan per lagu** lewat indeks unik parsial.
- **Tahap (stage)** disimpan di baris pekerjaan, sehingga setelah gangguan agent tahu harus
  melanjutkan dari mana.

Tabel perilaku:

| Kondisi | Perilaku |
|---|---|
| Fingerprint sama, finalisasi sedang berjalan | Mengembalikan pekerjaan yang sama; tidak membuat yang baru |
| Fingerprint sama, sudah berhasil dan masih aktif | Mengembalikan versi yang ada; tidak mengunggah apa pun |
| Fingerprint berbeda | Pekerjaan finalisasi baru untuk versi baru |
| Unggah gagal | Retry pada pekerjaan yang sama, dengan jeda bertambah |
| Unggah berhasil tetapi database belum diperbarui | Rekonsiliasi: periksa R2/Drive, lalu catat tanpa mengunggah ulang |
| Lagu sedang difinalisasi, admin memilih kandidat lain | Ditolak dengan pesan jelas; admin membatalkan dulu atau menunggu |

## 7. Penggantian audio yang aman

- Kunci R2 berversi: `m4a/<id lagu>/<id versi>.m4a`. Versi baru tidak pernah menimpa objek lama.
- Urutan: unggah → HEAD (ukuran + MD5) → satu transaksi database yang menjadikan versi baru aktif
  dan versi lama `superseded`. Sebelum transaksi itu berhasil, vokalis masih mendengar versi lama
  (kecuali lagu sedang dalam status Revision, lihat di bawah).
- Objek lama dihapus oleh pekerjaan `r2_remove` yang baru boleh diklaim **24 jam** setelah versi
  itu tidak aktif dan tidak ada pekerjaan lain yang menunjuknya.
- Header `/audio` diubah dari `max-age=3600` menjadi `no-cache` dengan ETag, dan cache kunci di
  fungsi diturunkan, supaya pencabutan akses terasa dalam hitungan detik (menutup G13). Biayanya
  satu permintaan kecil (304) tiap kali lagu diputar ulang.

## 8. Status lagu yang terlihat

| Status | Arti | Vokalis bisa |
|---|---|---|
| **Draft** | ada kandidat, belum ada versi aktif | melihat judul saja |
| **Finalizing** | pekerjaan finalisasi berjalan | mendengar versi aktif sebelumnya kalau ada |
| **Finalize failed** | gagal atau butuh admin | sama seperti sebelum finalisasi |
| **Ready** | ada versi aktif | mendengar, Accept |
| **Accepted** | versi aktif di-Accept | Download, Revision, Send to FC |
| **On Revision** | vokalis minta revisi | tidak bisa memutar, mengunduh, atau mengirim |

## 9. Yang sengaja tidak dibuat

- Tidak ada salinan cadangan WAV per versi di disk (MacBook sudah hampir penuh). Keaslian dijaga
  dengan memeriksa fingerprint sebelum unggah; kalau tidak cocok, pekerjaan berhenti dan admin
  diberi tahu. Lihat `RISK_ANALYSIS.md` R3.
- Tidak ada antrean pesan atau layanan baru. Antrean tetap tabel Postgres.
- Tidak ada Video Call.
- Tidak ada perubahan pada halaman operator.
