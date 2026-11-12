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
