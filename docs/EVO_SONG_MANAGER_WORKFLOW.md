# EVO_SONG_MANAGER_WORKFLOW — Alur kerja target

Enam alur: New Song, Manual Finalization, Accept, Revision, Cancel Song, Recovery.
Istilah: **kandidat** = file WAV yang terlihat agent; **versi** = kandidat yang difinalisasi admin.

---

## 1. New Song

```
DAW ekspor "Carla - Beautiful.wav" ke …/Mixdown/
        │
        ▼
First Club Sync: file stabil? ──tidak──► tunggu pemindaian berikutnya
        │ ya
        ▼
hitung fingerprint (sekali per perubahan) ─► kirim nama, ukuran, tanggal, fingerprint
        │
        ▼
Database: lagu belum ada → buat lagu (status Draft) + kandidat
          lagu sudah ada, fingerprint baru → tambah kandidat saja
          fingerprint sama → hanya perbarui "terakhir terlihat"
```

- Tidak ada unggahan apa pun di tahap ini.
- Lagu Draft terlihat di admin dengan badge **"Not finalized"**. Di halaman vokalis lagu tampil
  tanpa audio, seperti lagu tanpa M4A sekarang.
- Harga dan status lunas bisa diisi sejak Draft, seperti sekarang.

## 2. Manual Finalization

```
Admin membuka lagu → daftar kandidat (nama file, perangkat, tanggal, ukuran, 8 huruf fingerprint)
        │ pilih satu → "Selesaikan & Upload"
        ▼
Database (satu transaksi):
  kunci idempotensi finalize:<lagu>:<sha256>
  ├ sudah ada dan berjalan  → kembalikan pekerjaan itu
  ├ sudah ada dan berhasil  → kembalikan versi itu
  └ belum ada               → buat versi (finalizing) + pekerjaan finalize untuk perangkat pemilik
        │
        ▼
Evo Media Agent di perangkat pemilik mengklaim pekerjaan (sewa 5 menit, diperpanjang)
  1 VALIDATE   file ada; ukuran dan mtime sama dua kali berturut-turut selang 5 detik;
               header WAV benar dan panjang data cocok dengan ukuran file;
               fingerprint dihitung ulang = fingerprint kandidat
  2 CONVERT    WAV → M4A (AAC) ke folder sementara agent
  3 UPLOAD     PUT ke R2: m4a/<id lagu>/<id versi>.m4a  (lewati kalau HEAD sudah cocok)
  4 VERIFY     HEAD: ukuran dan MD5 sama
  5 ACTIVATE   database: versi → active, versi lama → superseded, lagu → Ready
  6 CLEANUP    hapus M4A sementara
```

Aturan:

- Mendeteksi file **tidak** memicu unggah. Hanya tombol admin yang memicu.
- Gagal di tahap mana pun: pekerjaan tetap satu, tahap tercatat, dicoba lagi dengan jeda
  30 dtk → 1 → 5 → 15 → 30 → 60 menit. Setelah 8 kali, status **needs admin** dengan tombol
  "Coba lagi" dan "Batalkan".
- Validasi gagal karena **fingerprint berubah** (file sedang atau sudah diekspor ulang): tidak
  di-retry. Status needs admin dengan pesan "File berubah sejak dipilih; pilih kandidat yang baru".
- Selama finalisasi, audio aktif lama tidak disentuh. Kalau gagal, lagu kembali ke status
  sebelumnya dan admin melihat **"Finalize failed"**; tidak pernah dianggap berhasil.
- Tombol menjadi tidak aktif dan berubah menjadi indikator proses begitu ditekan; pengaman
  sebenarnya ada di database, bukan di tombol.
- Kalau perangkat pemilik mati: status **"Waiting for <nama perangkat>"**.

### Konversi WAV → M4A

Sekarang Jeffry mengekspor M4A sendiri dari DAW. Target: agent yang mengonversi, supaya M4A pasti
berasal dari WAV yang dipilih.

| Perangkat | Alat | Catatan |
|---|---|---|
| MacBook | `afconvert` (bawaan macOS) | tidak perlu memasang apa pun |
| PC Windows | `ffmpeg.exe` | satu file yang ditaruh di folder agent |

Agent memeriksa alatnya saat menyala. Kalau tidak ada, finalisasi di perangkat itu berstatus
needs admin dengan pesan cara memasangnya. **Ini butuh keputusan**, lihat `IMPLEMENTATION_ROADMAP.md`
bagian Keputusan.

## 3. Accept

```
Vokalis menekan Accept pada lagu berstatus Ready
        │
        ▼
Database: accepted_at diisi; baris wav_uploads dibuat untuk (lagu, versi aktif)
          berisi id versi, fingerprint yang diharapkan, perangkat pemilik
        │
        ▼
Evo Media Agent pemilik file:
  1 file ada di path versi?  kalau tidak → cari fingerprint yang sama di kandidat lain perangkat ini
  2 hitung fingerprint; harus sama dengan versi
       tidak sama → BERHENTI, status needs admin: "WAV di komputer bukan versi yang difinalisasi"
  3 unggah ke Drive: First Club/<Vokalis>/YYYY-MM-DD Vokalis - Judul.wav
       label evoUploadId = id pekerjaan, evoVersion = id versi, evoSha256 = fingerprint
  4 verifikasi MD5 dan ukuran dari Drive
  5 lapor complete → tombol Send to FC aktif
```

- WAV **tidak** diunggah saat finalisasi; baru setelah Accept (sama seperti sekarang).
- File dicari lewat versi dan fingerprint, bukan lewat nama.
- Accept hanya bisa pada lagu yang punya versi aktif dan tidak sedang On Revision.
- Send to FC, unduhan operator, unduhan vokalis: tidak berubah.

## 4. Revision

```
Vokalis menekan Revision (+ catatan)
        │
        ▼
Database (satu transaksi, langsung berlaku):
  lagu → On Revision; accepted_at kosong
  versi aktif → cancelled (alasan: revision); lagu tidak punya versi aktif
  unggah WAV yang belum mulai → dibatalkan
  unggah WAV yang sedang berjalan → ditandai batal; agent membuang hasilnya
  Send to FC dan status operator untuk versi itu → dicabut
  pekerjaan dibuat: drive_remove (kalau ada file di Drive), archive_wav, r2_remove (tertunda)
        │
        ├─► /audio, /vdl, /dl, Send to FC menolak versi itu mulai detik ini
        │
        ▼
Agent (urut, di perangkat pemilik):
  drive_remove  → pindahkan file Drive ke Trash
  archive_wav   → pindahkan WAV lokal ke Mixdown/Cancel Song/ (lihat alur 5)
        │
        ▼
Admin memproduksi ulang → ekspor "Carla - Beautiful.wav" (nama sama)
        │
        ▼
Sync melihat kandidat baru (fingerprint berbeda) → admin memilih → Manual Finalization lagi
        │
        ▼
Versi baru aktif → lagu Ready → tanda revisi hilang → vokalis mendengar dan Accept
```

- Tidak perlu akhiran `(2)`, `(3)`. Nama file tetap.
- Halaman vokalis menampilkan **"On revision"** dan mematikan ▶, Download, Send.
- Admin melihat lagu di menu Revisions dengan catatan vokalis dan status arsip WAV lama.
- **Peringatan urutan**: kalau WAV baru diekspor dengan nama sama **sebelum** arsip berjalan
  (misalnya MacBook mati), DAW yang menimpa file lama. Itu tidak bisa dicegah sistem. Karena itu
  admin melihat indikator **"Old WAV not archived yet"** sampai arsip selesai, dan pekerjaan arsip
  hanya memindahkan file yang fingerprint-nya masih versi lama (lihat alur 5).

**Unlock (admin)** tetap ada dan tetap ringan: membatalkan Accept dan unggahan WAV, tetapi versi
tetap aktif dan WAV lokal tidak dipindah. Unlock dipakai kalau Accept tertekan tidak sengaja.

**Dismiss** (admin menolak permintaan revisi) berubah arti. Sekarang Dismiss cukup menghapus tanda
revisi karena tidak ada yang dipindah. Di sistem target, versi lama sudah dicabut dan WAV-nya
sudah (atau akan) diarsipkan, jadi Dismiss menjadi **"Restore previous version"**: pekerjaan arsip
dibatalkan kalau belum jalan, atau WAV dikembalikan dari `Cancel Song` kalau sudah, lalu versi itu
diaktifkan lagi tanpa unggah ulang M4A (objek R2 masih ada selama masa tunggu 24 jam). Ini butuh
keputusan (K9).

**Replace with revision** (memilih file bernama lain) tetap tersedia untuk kasus file revisi yang
terlanjur diberi nama berbeda. Di sistem target, ini memilih kandidat itu lalu memfinalisasinya.

## 5. Cancel Song

Folder `Cancel Song` berada di dalam setiap folder `Mixdown`. Dibuat agent saat pertama dibutuhkan.

```
Pekerjaan archive_wav (id versi, path, fingerprint)
  1 tidak ada unggahan WAV versi ini yang sedang berjalan di perangkat ini
       (agent bekerja satu per satu; unggahan yang berjalan diselesaikan atau dibatalkan dulu)
  2 file di path masih ada?
       tidak → catat "sumber tidak ditemukan", status needs admin
  3 fingerprint file = fingerprint versi?
       tidak → file sudah ditimpa ekspor baru. JANGAN dipindah.
               catat "versi lama sudah tertimpa", status selesai-dengan-peringatan
  4 tujuan: Mixdown/Cancel Song/<nama asli>
       sudah ada file bernama sama?
         isinya sama (fingerprint)  → anggap sudah terarsip, hapus sumber setelah verifikasi
         isinya beda                → tujuan: Mixdown/Cancel Song/<tanggal> v<nomor>/<nama asli>
  5 pindahkan tanpa bisa menimpa:
       buat tautan keras (link) ke tujuan — gagal kalau tujuan sudah ada — lalu hapus sumber
       disk tanpa dukungan link (exFAT): salin dengan mode "gagal bila ada", verifikasi fingerprint, lalu hapus sumber
  6 verifikasi: tujuan ada, fingerprint cocok, sumber tidak ada
  7 lapor: path arsip disimpan di versi
```

- Nama file asli dipertahankan. Subfolder bertanggal hanya dipakai kalau nama itu sudah terisi
  oleh isi yang berbeda, jadi revisi berulang tidak pernah saling menimpa.
- Gagal memindahkan: pekerjaan `failed` dengan pesan (file terkunci DAW, izin, disk penuh),
  dicoba lagi; tidak pernah dilaporkan berhasil sebelum langkah 6.
- First Club Sync **mengabaikan** folder `Cancel Song`, jadi isinya tidak muncul sebagai lagu atau
  kandidat baru.
- Sumber arsip (`backup`) tidak pernah diarsipkan atau dipindah.

## 6. Recovery

Dijalankan Evo Media Agent saat menyala, dan diulang tiap 10 menit.

```
Untuk setiap pekerjaan milik perangkat ini yang belum selesai, atau yang sewanya habis:

 finalize
   tahap ≤ VALIDATE   → mulai dari VALIDATE
   tahap CONVERT      → M4A sementara ada dan utuh? lanjut UPLOAD; kalau tidak, ulang CONVERT
   tahap UPLOAD/VERIFY→ HEAD R2: objek ada dengan MD5 yang dicatat? → langsung ACTIVATE
                        tidak ada → ulang UPLOAD (dari M4A sementara, atau ulang CONVERT)
   tahap ACTIVATE     → tanya database: versi sudah aktif? selesai. belum → ACTIVATE lagi (idempoten)

 unggah WAV
   cari di Drive lewat label evoUploadId
     ada, MD5 cocok        → lapor complete (tanpa unggah ulang)
     ada, MD5 beda/parsial → hapus sisa, unggah ulang
     tidak ada             → periksa file sumber + fingerprint, unggah
   pekerjaan sudah dibatalkan → hapus file Drive kalau sempat terunggah

 archive_wav
   tujuan sudah ada dengan fingerprint cocok dan sumber hilang → lapor selesai
   tujuan ada dan sumber masih ada (mati di antara link dan hapus) → hapus sumber setelah verifikasi
   selain itu → jalankan alur 5 dari awal

 drive_remove / r2_remove
   objek sudah tidak ada → lapor selesai; masih ada → hapus

Lalu audit ringan (rekonsiliasi):
   versi aktif tanpa objek di R2          → lagu ditandai "Audio missing", admin diberi tahu
   wav_uploads complete tanpa file Drive  → ditandai "Unavailable", admin diberi tahu
   objek R2 / file Drive tanpa baris      → dicatat sebagai yatim; dihapus hanya lewat pekerjaan terpisah
   file sumber versi aktif hilang         → "Source missing on <perangkat>", butuh admin
```

Aturan:

- Tidak ada unggah ulang kalau file ternyata sudah tersimpan dengan benar.
- Tidak ada status "berhasil" tanpa pemeriksaan keberadaan dan MD5.
- Database tidak bisa dihubungi: agent menunggu dan tidak mengubah apa pun di disk selain M4A
  sementara miliknya.
- File sumber hilang: tidak di-retry terus-menerus; status needs admin.

Titik pemeriksaan yang disimpan:

| Titik | Disimpan di | Catatan |
|---|---|---|
| File detected | `file_candidates` | bukan tahap pekerjaan; cukup data hasil pindai |
| File validated | `jobs.stage = validated` | |
| Finalization started | `jobs` dibuat, `song_versions.status = finalizing` | |
| M4A conversion completed | `jobs.stage = converted` + MD5 M4A | |
| R2 upload started | `jobs.stage = uploading` | |
| R2 upload verified | `jobs.stage = verified` | |
| Database updated | `song_versions.status = active` | |
| Vocalist accepted | `songs.accepted_at`, baris `wav_uploads` | |
| WAV Drive upload started | `wav_uploads.status = uploading` | |
| WAV Drive upload verified | `wav_uploads.status = complete` + MD5 | |
| Ready for operator | `wav_uploads.sent_at` | sudah ada |
