# Alur upload otomatis — rencana (13 Nov 2026)

Keputusan Jeffry: **otomatis saja, tombol Finalize dibuang.** Dia tidak mau mengklik apa pun untuk
setiap lagu.

Yang dibuang adalah **kliknya**, bukan pengamannya. Mesin versi di belakang layar tetap dipakai:
sidik jari isi file, kunci R2 yang tidak pernah tertimpa, verifikasi berkala, dan arsip saat revisi.
Itu semua hasil fase F3–F7 dan membuang semuanya akan mengembalikan masalah lama.

## Masalah yang sedang terjadi sekarang

Saklar `manual_finalization` **mati**, jadi jalur lama masih berjalan: begitu M4A muncul, agen
mengunggahnya ke R2 lalu **menghapus file M4A di komputer dalam hitungan detik**. Tombol Finalize
baru bisa ditekan beberapa saat kemudian — saat itu M4A-nya sudah tidak ada. Dua jalur saling
berebut, dan itulah sebabnya setiap percobaan Finalize berakhir "M4A tidak ada di komputer ini".

Selain itu, jalur lama menulis ke tabel `audio_files`, bukan ke `song_versions`. Jadi lagu yang
diunggah otomatis **tidak pernah punya versi**, dan halaman admin menandainya "Not finalized" atau
"No audio" — padahal vokalisnya baik-baik saja bisa mendengarnya. Peringatan itulah yang
membingungkan.

## Rencananya

**Agen yang memfinalisasi, bukan Jeffry.**

1. Saklar `manual_finalization` **dinyalakan**, supaya M4A tidak lagi dihapus dalam hitungan detik.
2. Agen memanggil `finalize_ready` secara berkala. Fungsi itu sudah ada dan sudah teruji: ia
   memfinalisasi lagu yang **jelas** — tepat satu file yang cocok, M4A-nya ada, dan M4A-nya tidak
   ketinggalan dari WAV-nya — lalu melewati yang ambigu sambil menyebut alasannya.
3. Pekerjaan finalisasinya diproses agen seperti biasa: unggah ke `m4a/<lagu>/<versi>.m4a`,
   cocokkan MD5-nya dengan R2, baru aktifkan. Objek lama dihapus 24 jam kemudian.

Dari sisi Jeffry: render WAV+M4A, lalu tidak melakukan apa-apa. Sama seperti sekarang, tapi
versinya terbentuk, jadi verifikasi dan arsip tetap bekerja.

## Lalu bagaimana kalau ambigu?

Ini kasus Guna: beberapa file dengan judul sama ("rev", "-3"). `finalize_ready` sengaja TIDAK
menebak — menggabungkan dua lagu yang ternyata berbeda tidak bisa dibatalkan.

Jadi jalurnya begini, dan ini cocok dengan cara kerja Jeffry sendiri:

1. Lagu yang ambigu **tidak** difinalisasi otomatis, dan muncul di halaman **System** sebagai
   "menunggu kamu membuang duplikatnya".
2. Jeffry membuka halaman **Conflicts**, melihat kedua file berdampingan (tanggal, ukuran, sidik
   jari, komputer asalnya), lalu menekan **Remove from list** pada yang tidak dipakai.
3. Begitu tinggal satu, agen memfinalisasinya sendiri di putaran berikutnya.

Tidak ada dialog, tidak ada klik per lagu. Hanya membuang duplikat — yang memang sudah mau dia
lakukan sendiri.

## Kenapa lagu Guna kedobel sejak awal

Sistem mengenali lagu dari **path filenya** (`on conflict (rel_path)` di `sync_files`). Begitu nama
filenya berubah — "rev", atau "-3" yang ditambahkan Studio One sendiri karena menolak menimpa file
yang sudah ada — itu terbaca sebagai **lagu baru**, bukan revisi dari lagu lama.

Jadi kebiasaan memberi nama revisi justru yang membuat duplikat yang ditakutkan. Aturan yang benar:
**render dengan nama file yang sama persis.** Kalau Studio One menolak menimpa, hapus dulu WAV+M4A
lama dari folder Mixdown, baru render. Sidik jarinya akan berubah, sistem melihatnya sebagai versi
baru dari lagu yang sama, dan vokalis tetap melihat satu judul.

## Yang masih perlu dikerjakan

| | Perlu akses database? |
|---|---|
| Copot antarmuka Finalize dari admin | tidak — **sudah selesai** |
| Agen memanggil `finalize_ready` berkala | ya (untuk diuji dan diterapkan) |
| Nyalakan saklar `manual_finalization` | ya |
| Bagian "menunggu kamu membuang duplikatnya" di halaman System | ya |
| Bereskan 1 pekerjaan finalisasi yang tersangkut `needs_admin` | ya |
| Buat versi untuk lagu yang terunggah otomatis sejak backfill | ya |

Semua yang butuh database sedang **terblokir**: connector Supabase di sesi ini hanya melihat
organisasi `evolutiondigital`, dan project Evo Song Manager tidak ada di dalamnya.

---

# Hapus permanen (fase 10) — 13 Nov 2026

Jeffry akan mengeliminasi beberapa lagu Keket dan Guna yang terduplikat, dan "Remove from list"
yang ada sekarang hanya menyembunyikan lagunya — audio di R2 dan file WAV di Google Drive tetap
tertinggal. Jadi ditambahkan jalur pemusnahan yang sebenarnya.

## Dibuat dua tahap, dengan sengaja

Ini satu-satunya jalur di aplikasi yang menghancurkan data dan tidak bisa dibatalkan. Jadi tidak
ada satu klik pun yang bisa langsung memusnahkan lagu yang masih aktif:

1. **Remove from list** (sudah ada, di menu "…" tabel lagu) — lagu hilang dari halaman vokalis,
   semua filenya masih utuh, bisa dikembalikan kapan saja.
2. **Delete audio permanently** (baru, di panel "Deleted") — baru menghapus isinya. Fungsinya
   menolak lagu yang belum melewati tahap 1.

## Apa yang dihapus, dan apa yang tidak

| | |
|---|---|
| Audio di R2 | **dihapus** — vokalis tidak akan bisa memutarnya lagi |
| File WAV di Google Drive | **dibuang ke Trash** — masih bisa diambil di sana selama 30 hari |
| WAV & M4A di komputer Jeffry | **tidak disentuh sama sekali** |
| Baris lagunya di database | **tetap disimpan** sebagai sejarah |

Dipakai `trash()`, bukan hapus permanen Google Drive, supaya salah buang masih bisa diperbaiki.

## Pengaman yang dipasang

- **Lagu yang masih di daftar tidak bisa dimusnahkan.** Harus lewat tahap 1 dulu.
- **Versi dibatalkan lebih dulu.** Agen punya penjagaan "jangan hapus audio yang masih dipakai"
  yang membaca status versi. Tanpa langkah ini pekerjaannya akan dilewati diam-diam dan filenya
  tetap ada di R2 padahal aplikasi sudah bilang terhapus.
- **Kunci yang masih dipakai lagu lain yang hidup tidak ikut dihapus.** Kalau dua lagu pernah
  menunjuk objek R2 yang sama, menghapusnya akan membungkam lagu yang tidak diapa-apakan.
- **Kuncinya dikosongkan saat itu juga.** Jadi kalau lagunya dikembalikan dari "Deleted", tombol
  putarnya jujur bilang tidak ada audio, bukan menunjuk file yang sudah hilang.
- **Diulang pun tidak menggandakan pekerjaan** (kunci idempotensi per objek).
- **Hanya admin.**
- Mengembalikan lagu yang sudah dimusnahkan tetap boleh, tapi diperingatkan bahwa audionya tidak
  ikut kembali.

## Lagu lama ikut tertangani

Lagu lama menyimpan audionya di `audio_files`, bukan di `song_versions`. Pemusnahan mengumpulkan
kunci dari **kedua** tempat itu, jadi lagu era lama pun benar-benar bersih.

## Tes

28 pemeriksaan database di salinan Postgres lokal (termasuk semua pengaman di atas) dan 13
pemeriksaan antarmuka. Semuanya lolos.

## Belum bisa diterapkan

Migrasinya sudah ditulis dan teruji lokal, tapi **belum diterapkan ke produksi** karena connector
Supabase di sesi ini tidak bisa membaca project Evo Song Manager. Begitu sambungannya kembali,
yang perlu dijalankan: `db/2026-11-13_phase10_purge.sql`, lalu agen diperbarui ke 2.2.
