# Listen Together — rancangan & hasil (11 Nov 2026)

> Catatan: dokumen ini tentang menyimak mixdown bersama, BUKAN tentang FC Private Studio
> (rapat membahas editing di DAW dengan berbagi layar). Untuk itu lihat `FC_PRIVATE_STUDIO_DESIGN.md`.

> **Status: SELESAI.** Penyelarasan pemutaran dan panggilan suara di dalam aplikasi keduanya
> sudah terpasang. Jeffry memilih pilihan B di bagian 5 (suara dibangun di dalam aplikasi).
> Satu langkah pengaturan masih perlu dia lakukan sendiri: kunci TURN — lihat `TURN_SETUP.md`.

Tujuan yang dipilih Jeffry: **mendengarkan mixdown bersama vokalis sambil mengobrol, tanpa
kualitas musiknya turun.**

## 1. Kenapa video call biasa tidak cocok

Semua layanan video call (Zoom, Meet, WhatsApp, Daily) memakai codec suara bicara: mono, sekitar
16–32 kbps, ditambah peredam bising dan penekan gema. Untuk ngobrol itu bagus; untuk musik itu
merusak — stereo hilang, dentum bass dipotong, dan simbal terdengar berair. Hasilnya **lebih buruk
daripada yang sudah bisa didengar vokalis sekarang** lewat tombol ▶ di aplikasi ini.

Jadi musiknya tidak boleh ikut dikirim lewat jalur panggilan.

## 2. Gagasan intinya

Kedua sisi **memutar filenya masing-masing** dari R2, persis seperti sekarang. Yang dikirim lewat
jaringan hanyalah perintah kecil: "mulai dari detik 42 pada pukul sekian". Musiknya tetap mutu penuh
di kedua telinga karena tidak pernah dikompres ulang.

```
  Jeffry (admin)                                     Vokalis
  ┌────────────────┐                        ┌────────────────┐
  │ pemutar        │◄── file dari R2        │ pemutar        │◄── file dari R2
  │ (mutu penuh)   │                        │ (mutu penuh)   │
  └───────┬────────┘                        └────────┬───────┘
          │   perintah kecil: play / pause / geser   │
          │   + penyelarasan jam                     │
          └──────────► Supabase Realtime ◄───────────┘
          
          suara ngobrol lewat jalur terpisah (lihat bagian 5)
```

## 3. Bagian-bagiannya

| Bagian | Isi |
|---|---|
| **Ruang (room)** | Dibuat admin untuk satu vokalis. Namanya memakai kode acak, seperti link vokalis yang sudah ada. |
| **Pemimpin** | Jeffry. Hanya pemimpin yang boleh menekan play/pause/geser; vokalis ikut. Ini menghindari dua orang saling rebut kendali. |
| **Penyelarasan jam** | Kedua sisi menukar cap waktu beberapa kali untuk menghitung selisih jam, seperti cara jam komputer disetel ke internet. Target meleset di bawah 100 milidetik — tidak terasa untuk menyimak bersama. |
| **Perintah** | `play(lagu, posisi, pada_waktu)`, `pause(posisi)`, `seek(posisi)`. Dikirim lewat Supabase Realtime (sudah tersedia, tidak perlu layanan baru). |
| **Pemutar admin** | Sudah ada sekarang, berupa dok di bawah layar yang tetap jalan sambil pindah tab. Ini sekaligus pemutar pertama di sisi admin. |

Catatan jujur soal ketepatan: ini **bukan** sinkronisasi sempurna sampai tingkat sampel. Kalau
keduanya memutar lagu yang sama di ruangan yang sama, akan terdengar gema tipis. Untuk dua orang
di kota berbeda yang masing-masing memakai headphone, selisih di bawah 100 md tidak terasa.

## 4. Yang sudah dikerjakan

Semuanya sudah terpasang dan terpakai:

- Tabel `listen_rooms` + fungsi `listen_open` / `listen_close` / `listen_active` /
  `listen_room_for` / `listen_songs`.
- **Izin audionya tidak digandakan.** Kode ruang diperlakukan persis seperti `share_token`
  vokalis di dalam `get_audio_key`, jadi lagu yang dihapus, yang sedang revisi, atau yang belum
  punya audio tetap tertutup — tanpa aturan kedua yang bisa menyimpang dari yang pertama.
  Diperiksa pada data sungguhan: sidik jari kunci audio untuk ke-263 pasangan vokalis/lagu
  **tidak berubah sama sekali** sebelum dan sesudah penggantian fungsinya.
- Mesin penyelarasan `web/js/core/listen.js`, dengan bagian matematikanya dipisah supaya bisa
  diuji tanpa browser.
- Dok "Listen together" di halaman admin, dan undangan yang muncul sendiri di halaman vokalis.

### Ketepatan yang terukur

| Diukur | Hasil |
|---|---|
| Perkiraan selisih jam, jaringan bagus | meleset tengah **1 ms** |
| Perkiraan selisih jam, seluler biasa | **8 ms** |
| Perkiraan selisih jam, seluler jelek | **22 ms**, terburuk 40 ms |
| Dua halaman sungguhan, saat mulai | **59 ms** |
| Dua halaman sungguhan, setelah 4 detik berjalan | **111 ms** |
| Dua halaman sungguhan, sesudah digeser | **3 ms** |

Angka dua baris pertama adalah ketepatan perkiraan jam; tiga baris terakhir adalah selisih posisi
lagu yang sebenarnya antara dua halaman di satu browser. Di perangkat berbeda akan sedikit lebih
besar karena setiap browser punya jeda audionya sendiri, tapi semuanya jauh di bawah ambang yang
terdengar sebagai "tidak serempak" lewat headphone.

### Yang tidak dilakukan, dan sebabnya

- **Vokalis tidak bisa menekan play/jeda/geser selama sesi.** Satu pemimpin menghindarkan
  tarik-menarik kendali. Volume dan mute tetap miliknya karena tidak menggeser posisi lagu.
- **Bukan serempak sampai tingkat sampel.** Kalau kalian berada di ruangan yang sama dan memutar
  lagu yang sama, akan terdengar gema tipis. Untuk dua orang berjauhan dengan headphone, tidak
  terasa.

## 5. PERSIMPANGAN: suara ngobrolnya lewat mana?

Ini keputusan yang mengubah besar pekerjaan, dan belum diputuskan.

| | A. Ngobrol lewat WhatsApp (rekomendasi saya) | B. Suara di dalam aplikasi (WebRTC) |
|---|---|---|
| Yang dibangun | Hanya penyelarasan pemutaran | Penyelarasan + panggilan suara/video |
| Besar pekerjaan | Kecil | Besar, kira-kira tiga sampai empat kali lipat |
| Kualitas suara ngobrol | Sama seperti telepon WhatsApp biasa | Mirip, tidak lebih baik |
| Risiko gagal tersambung | Tidak ada | Nyata: sebagian jaringan seluler memblokir sambungan langsung, perlu server relay (TURN) berbayar |
| Kualitas musik | Mutu penuh | Mutu penuh (sama, karena musik tetap tidak lewat panggilan) |

**Rekomendasi saya waktu itu A; Jeffry memilih B, dan B yang dibangun.** Catatan di bawah
dibiarkan apa adanya sebagai rekaman pertimbangannya.

**Alasan rekomendasi A:** Kalian berdua sudah memakai WhatsApp setiap hari untuk pekerjaan ini, dan
panggilan WhatsApp tahan di jaringan jelek. Membangun suara sendiri menambah banyak bagian yang
bisa rusak tanpa membuat ngobrolnya terdengar lebih baik. Musiknya — satu-satunya yang benar-benar
butuh mutu tinggi — sudah ditangani oleh penyelarasan pemutaran, dan itu sama saja di kedua pilihan.

Kalau nanti ternyata merepotkan harus menelepon terpisah, B bisa ditambahkan belakangan di atas
fondasi yang sama tanpa membongkar apa pun.

## 6. Risiko

| Risiko | Mitigasi |
|---|---|
| Jaringan vokalis lambat, lagunya belum termuat saat diputar | Pemimpin menunggu kedua sisi melapor "siap" sebelum mulai |
| Vokalis menutup halaman di tengah sesi | Ruang kedaluwarsa sendiri; tidak ada yang tertinggal |
| Jam perangkat vokalis meleset jauh | Selisih dihitung dari pertukaran cap waktu, bukan dari jam perangkat |
| Sesi dipakai orang lain yang punya link | Kode ruang acak dan berumur pendek, dan ruang hanya bisa dibuat admin |
