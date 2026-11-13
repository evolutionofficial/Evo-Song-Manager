# FC Private Studio — rancangan (13 Nov 2026)

> **Status: TAHAP 1-3 SELESAI (13 Nov malam). Tahap 4-5 belum.**
> Ruang, undangan, mikrofon, kamera, dan berbagi layar sudah jalan dan sudah diuji dua arah.
> Slot audio A/B dan jalur mutu musik (tahap 4) belum dikerjakan — itu bagian yang perlu
> disetel dengan telinga di perangkat Jeffry.
>
> **Dua hal berubah dari rancangan ini saat dibangun:**
> 1. **Tidak ada tabel database baru.** Ruangnya memakai ulang `listen_open()` yang sudah ada,
>    karena `/turn` memverifikasi kode ruang terhadap database sebelum memberi kredensial relay.
>    Ruang yang hanya ada di browser tidak akan dapat relay, jadi panggilannya gagal di data
>    seluler. Akibatnya: selama ruang studio terbuka, halaman vokalis juga menampilkan undangan
>    "Listen together", karena belum ada penanda jenis ruang. Memisahkannya butuh satu kolom
>    `kind` di `listen_rooms` — belum bisa dikerjakan karena Supabase tidak terhubung saat itu.
> 2. **Berbagi layar MENGGANTI kamera**, tidak jalan bersamaan (pertanyaan 2 di bagian 12).
>    Satu track video berarti tidak perlu perundingan ulang dan sisi penerima tidak perlu
>    menebak mana kamera mana layar. Kalau Jeffry mau keduanya sekaligus, itu bisa ditambahkan.
>
> Jangan tertukar dengan `VIDEO_CALL_DESIGN.md`. Dokumen itu tentang **Listen Together**
> (menyimak mixdown jadi, bersama-sama, sambil ngobrol) dan sudah selesai. Yang ini tujuannya
> berbeda: **rapat kerja untuk membahas editing di DAW**.

---

## 1. Tujuan

Jeffry ingin memperlihatkan proses editing di Studio One kepada seorang vokalis, lalu
membahasnya bersama, tanpa memakai Zoom, Google Meet, atau WhatsApp.

Yang sebenarnya dibutuhkan, menurut kata-katanya sendiri:

- **Berbagi layar** — ini intinya. Memperlihatkan Studio One saat sedang diedit.
- **Suara dari DAW** lewat loopback, supaya vokalis mendengar hasil editingnya langsung.
- **Kamera** — bukan kebutuhan utama, tapi berguna untuk menunjukkan barang atau memberi gestur
  saat menjelaskan sesuatu.
- **Slot input audio A/B** — dari rencana awalnya dulu: bisa berpindah antara dua sumber suara,
  misalnya mikrofon untuk bicara dan loopback DAW untuk memperdengarkan.
- **Satu lawan satu.** Dia dan satu vokalis. Bukan rapat banyak orang.

## 2. Kenapa tidak pakai Zoom atau Meet saja

Karena setelan audionya tidak bisa kita ubah, dan justru itu yang merusak.

Semua layanan panggilan memaksa tiga hal pada suara yang masuk: peredam gema, peredam bising,
dan auto-gain. Untuk suara bicara itu bagus. Untuk musik dari DAW itu bencana — stereo
diruntuhkan jadi mono, bagian sunyi dianggap bising lalu dipotong, dan volume dinaikkan-turunkan
sendiri persis saat kita sedang menilai dinamika. Codec-nya pun disetel untuk pita suara manusia,
sekitar 16–32 kbps.

Kalau kita bangun sendiri, **kita yang memegang setelan itu**. Ketiganya bisa dimatikan, kanal
dipaksa stereo, dan bitrate Opus dinaikkan jauh di atas kebiasaan panggilan suara. Hasilnya
bukan "sama seperti Zoom", tapi lebih baik — dan itu alasan utama fitur ini layak dibangun
sendiri, bukan sekadar menghindari langganan.

Catatan jujur: ini tetap **bukan** mutu monitoring. Untuk keputusan mixing yang serius, vokalis
tetap harus mendengar file aslinya (lewat tombol ▶ di aplikasi, atau Listen Together). FC Private
Studio untuk **membahas**, bukan untuk **memutuskan** detail halus.

## 3. Biaya

Gratis, dan ini bukan perkiraan kasar.

| Bagian | Biaya |
|---|---|
| WebRTC (kamera, mikrofon, berbagi layar) | Gratis, sudah ada di dalam browser |
| Jalur sinyal (saling tukar alamat) | Supabase Realtime, sudah dipakai dan sudah dibayar |
| Koneksi dua orang | **Langsung antar-browser — tidak lewat server mana pun, nol biaya** |
| TURN (relay, hanya kalau koneksi langsung gagal) | Cloudflare: **1.000 GB/bulan gratis**, lalu $0,05/GB |

Satu jam rapat lewat TURN kira-kira 2–3 GB. Jadi bahkan dalam keadaan terburuk — setiap rapat
terpaksa lewat relay — jatah gratisnya cukup untuk ratusan jam sebulan. Dalam keadaan normal
pemakaiannya **nol**, karena dua orang biasanya tersambung langsung.

Tidak ada API berbayar, tidak ada langganan, tidak ada SDK pihak ketiga.

## 4. Yang sudah ada dan yang benar-benar baru

Ini bukan membangun dari nol. Fitur panggilan suara (fase 9) sudah meninggalkan banyak fondasi.

| Bagian | Keadaan |
|---|---|
| Jalur sinyal lewat Supabase Realtime | **Sudah ada** (`web/js/core/listen.js`) |
| Negosiasi koneksi (perfect negotiation, host/guest) | **Sudah ada** (`web/js/core/voice.js`) |
| TURN Cloudflare | **Sudah ada** (lihat `TURN_SETUP.md`) |
| Mikrofon, bisukan, nada dering, tutup panggilan | **Sudah ada** |
| **Kamera** — nyala/mati, kirim track, tampilkan video lawan bicara | **Sudah ada**, lengkap dengan tombolnya |
| Berbagi layar | **Belum ada** — `getDisplayMedia` belum dipakai di mana pun |
| Slot input audio A/B | **Belum ada** |
| Jalur audio mutu musik (AEC/NS/AGC mati, stereo, bitrate tinggi) | **Belum ada** — setelan sekarang justru kebalikannya |
| Tata letak ruang rapat | **Belum ada** — yang ada baru dok kecil di dalam Listen Together |

Jadi pekerjaan nyatanya ada di empat baris terakhir.

## 5. Arsitektur

```
  Jeffry (admin)                                         Vokalis
  ┌──────────────────────────┐                ┌──────────────────────────┐
  │ kamera                   │                │ kamera                   │
  │ layar (Studio One)       │ ──── video ──► │ layar Jeffry (besar)     │
  │ slot A: mikrofon         │                │                          │
  │ slot B: loopback DAW     │ ──── audio ──► │ headphone                │
  │                          │ ◄─── audio ─── │ mikrofon                 │
  └────────────┬─────────────┘                └────────────┬─────────────┘
               │                                           │
               │   tawar-menawar koneksi (sekali di awal)  │
               └──────────► Supabase Realtime ◄────────────┘

  Setelah tersambung, suara dan gambar mengalir LANGSUNG antar-browser.
  Supabase hanya dipakai untuk perkenalan di awal, tidak dilewati media.
```

Satu lawan satu berarti tidak perlu server penyalur (SFU). Itu yang membuatnya gratis dan
mutunya paling tinggi — media tidak pernah dikompres ulang oleh pihak ketiga.

## 6. Slot input audio A/B

Ini bagian yang paling khas dan paling perlu dibicarakan.

Masalahnya: mikrofon dan loopback DAW butuh perlakuan yang **berlawanan**. Mikrofon ingin peredam
gema dan peredam bising menyala. Loopback DAW ingin ketiganya mati. Satu setelan tidak bisa
melayani keduanya.

Jadi di sisi Jeffry ada dua slot yang bisa diatur terpisah:

| | Slot A — Bicara | Slot B — DAW |
|---|---|---|
| Sumber | Mikrofon | Perangkat loopback (VB-Cable, Voicemeeter, BlackHole di Mac) |
| Peredam gema | Nyala | **Mati** |
| Peredam bising | Nyala | **Mati** |
| Auto-gain | Nyala | **Mati** |
| Kanal | Mono | **Stereo** |
| Bitrate | Secukupnya untuk bicara | **Tinggi** |

Tiga cara memakainya, dan ini perlu keputusan Jeffry (lihat bagian 12):

1. **Bergantian** — hanya satu slot aktif, ditekan untuk berpindah. Paling sederhana, dan paling
   aman dari gema.
2. **Dicampur** — keduanya terkirim bersamaan, dengan slider volume masing-masing. Lebih luwes
   (bisa bicara di atas musik), tapi perlu pencampur audio di browser dan lebih berisiko gema.
3. **A/B untuk membandingkan** — slot A dan B diisi dua versi mix yang berbeda, lalu ditukar
   bolak-balik untuk dibandingkan vokalis. Ini kemungkinan maksud asli "A/B" dalam catatan lama.

Ketiganya bisa dibangun di atas rangka yang sama; yang berbeda hanya tombolnya.

## 7. Masalah gema, dan aturan headphone

Ini risiko paling nyata, jadi ditulis terang-terangan.

Peredam gema (AEC) adalah yang mencegah suara dari speakermu masuk lagi ke mikrofonmu dan
berputar-putar. Begitu AEC dimatikan demi mutu musik, perlindungan itu hilang. Kalau salah satu
dari kalian memakai **speaker**, akan terjadi lolongan feedback.

Maka aturannya: **rapat ini wajib headphone, keduanya.**

Aplikasinya tidak bisa memeriksa apakah seseorang memakai headphone, jadi yang bisa dilakukan:

- Peringatan jelas di layar sebelum masuk ruang.
- Slot A (mikrofon) tetap memakai AEC — jadi kalau yang terbuka hanya slot bicara, risikonya
  seperti panggilan biasa.
- Indikator di layar saat slot DAW aktif, supaya jelas kapan sedang dalam mode rawan.

## 8. Berbagi layar

Satu panggilan browser: `getDisplayMedia`. Jeffry memilih seluruh layar, satu jendela, atau satu
tab, lalu track videonya dikirim lewat koneksi yang sudah ada.

Dua catatan teknis:

- **Resolusi dan frame rate.** Layar DAW penuh teks kecil. Lebih baik mengutamakan ketajaman
  (supaya tulisan terbaca) daripada gerakan halus. Rencananya: resolusi penuh, frame rate rendah
  (5–10 fps). Kalau nanti terasa patah-patah saat menggeser timeline, bisa dinaikkan.
- **Kamera dan layar bersamaan.** Mengirim dua track video sekaligus bisa, tapi memakan lebih
  banyak internet. Rencananya: saat berbagi layar menyala, kamera Jeffry mengecil jadi kotak
  kecil dengan resolusi rendah, atau dimatikan — lihat bagian 12.

Audio dari Studio One **tidak** diambil lewat `getDisplayMedia`. Jalur itu tidak bisa diandalkan
lintas sistem operasi dan tidak memberi kita kendali setelan. Dipakai loopback sebagai slot B,
seperti rencana Jeffry sendiri.

## 9. Tempat dan cara masuk

- Halaman tersendiri, bukan di dalam Listen Together. Tujuannya memang berbeda, dan
  menggabungkannya akan membuat dok yang sudah penuh makin padat.
- Tombol masuk di **area atas halaman admin** — tempat yang sejak dulu Jeffry sediakan untuk
  tombol ke halaman lain.
- Vokalis masuk lewat **link sekali pakai yang kedaluwarsa sendiri**, seperti kode Listen
  Together yang sudah ada. Tidak perlu akun, tidak perlu aplikasi.
- Hanya Jeffry yang bisa memulai ruang.

## 10. Keamanan

Mengikuti pola yang sudah berjalan di aplikasi ini, tidak membuat aturan baru:

- Kode ruang acak dan berumur pendek, seperti `listen_rooms`.
- Izin diperiksa di database lewat fungsi yang sudah ada polanya, bukan di sisi browser.
- Tidak ada rekaman. Tidak ada media yang disimpan di server mana pun — media tidak pernah
  menyentuh server kita sama sekali.
- Kamera dan mikrofon hanya menyala setelah izin diberikan browser, dan padam saat ruang ditutup.

## 11. Risiko

| Risiko | Penanganan |
|---|---|
| Feedback karena ada yang pakai speaker | Peringatan wajib headphone; slot mikrofon tetap ber-AEC |
| Koneksi langsung gagal (jaringan seluler ketat) | Jatuh ke TURN Cloudflare yang sudah terpasang; pemakaian masih jauh di bawah jatah gratis |
| Internet vokalis lemah | Turunkan otomatis: layar tetap diutamakan, kamera dikorbankan lebih dulu |
| Tulisan di layar DAW tidak terbaca di HP vokalis | Sarankan vokalis memakai laptop/tablet untuk rapat editing; di HP tetap jalan tapi kecil |
| Komputer Jeffry berat karena DAW + browser + encoding video | Frame rate rendah; dan ini perlu diuji sungguhan sebelum dianggap beres |

## 12. Yang belum diputuskan

Tiga hal yang perlu jawaban Jeffry sebelum mulai:

1. **Slot A/B dipakai yang mana** dari tiga cara di bagian 6 — bergantian, dicampur, atau untuk
   membandingkan dua versi mix?
2. **Saat berbagi layar menyala, kamera Jeffry tetap jalan atau mati?**
3. **Vokalis boleh berbagi layar juga, atau hanya Jeffry?**

## 13. Tahapan kerja

Dibangun bertahap supaya setiap langkah bisa dicoba sungguhan sebelum lanjut.

| Tahap | Isi | Bisa diuji dengan |
|---|---|---|
| 1 | Halaman ruang + kode undangan + tombol di admin | Dua browser di satu komputer |
| 2 | Pindahkan panggilan suara + kamera yang sudah ada ke ruang baru | Dua browser, lalu dua perangkat |
| 3 | Berbagi layar | Memperlihatkan Studio One ke HP sendiri |
| 4 | Slot audio A/B + jalur mutu musik | Loopback dari Studio One, dinilai dengan telinga |
| 5 | Penurunan otomatis saat internet lemah, polesan tata letak | Rapat sungguhan dengan satu vokalis |

Tahap 1–3 adalah bagian yang paling pasti. Tahap 4 yang paling perlu dicoba dan disetel dengan
telinga, karena di situlah letak alasan membangun ini sendiri.
