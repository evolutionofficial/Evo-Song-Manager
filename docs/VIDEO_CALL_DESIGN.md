# Listen Together — rancangan (11 Nov 2026)

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
| **Pemutar admin** | **Belum ada.** Halaman admin sekarang tidak bisa memutar lagu sama sekali. Ini bagian pekerjaan yang paling besar. |

Catatan jujur soal ketepatan: ini **bukan** sinkronisasi sempurna sampai tingkat sampel. Kalau
keduanya memutar lagu yang sama di ruangan yang sama, akan terdengar gema tipis. Untuk dua orang
di kota berbeda yang masing-masing memakai headphone, selisih di bawah 100 md tidak terasa.

## 4. Yang perlu disiapkan sistem

- Pemutar di halaman admin (memakai ulang logika pemutar vokalis yang sudah ada).
- Admin perlu bisa mengambil kunci audio tanpa token vokalis — fungsi baru khusus admin.
- Tabel ruang + fungsi untuk membuat, bergabung, dan menutup ruang.
- Tombol "Listen together" di halaman admin, dan undangan yang muncul di halaman vokalis.

## 5. PERSIMPANGAN: suara ngobrolnya lewat mana?

Ini keputusan yang mengubah besar pekerjaan, dan belum diputuskan.

| | A. Ngobrol lewat WhatsApp (rekomendasi saya) | B. Suara di dalam aplikasi (WebRTC) |
|---|---|---|
| Yang dibangun | Hanya penyelarasan pemutaran | Penyelarasan + panggilan suara/video |
| Besar pekerjaan | Kecil | Besar, kira-kira tiga sampai empat kali lipat |
| Kualitas suara ngobrol | Sama seperti telepon WhatsApp biasa | Mirip, tidak lebih baik |
| Risiko gagal tersambung | Tidak ada | Nyata: sebagian jaringan seluler memblokir sambungan langsung, perlu server relay (TURN) berbayar |
| Kualitas musik | Mutu penuh | Mutu penuh (sama, karena musik tetap tidak lewat panggilan) |

**Rekomendasi: A.** Kalian berdua sudah memakai WhatsApp setiap hari untuk pekerjaan ini, dan
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
