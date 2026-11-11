# Panggilan suara — satu hal yang perlu Jeffry siapkan

Panggilan suara di dalam ruang menyimak **sudah jadi dan sudah tayang.** Di jaringan yang ramah
(wifi rumah, kantor) ia sudah bisa nyambung sekarang tanpa pengaturan apa pun.

Yang belum ada: **server relay (TURN).** Tanpa itu, sebagian panggilan di data seluler tidak akan
nyambung. Bukan karena aplikasinya rusak, tapi karena banyak operator seluler menaruh banyak
pelanggan di belakang satu alamat bersama, sehingga dua ponsel tidak bisa saling menemukan secara
langsung. Relay adalah titik temu di tengah.

Aplikasinya **tidak akan rusak** tanpa relay: tombol panggilnya tetap ada, dan kalau tidak nyambung
ia mengatakan apa adanya dan menyarankan telepon WhatsApp — sementara musiknya tetap serempak.

## Yang perlu kamu lakukan (sekitar 3 menit)

1. Buka Cloudflare dashboard → menu **Realtime** → **TURN**.
2. Buat **TURN key** baru. Namanya bebas, misalnya `evo-song-manager`.
3. Cloudflare akan menampilkan dua hal: **Key ID** dan **API Token**.
   **Jangan kirimkan keduanya ke chat ini.** Aku tidak boleh memegang kunci rahasiamu, dan juga
   tidak membutuhkannya — aplikasinya hanya perlu membacanya dari tempat penyimpanan rahasia.
4. Buka project Pages **evo-song-manager** → **Settings** → **Variables and Secrets**.
   Tambahkan dua **Secret** (bukan plaintext), untuk Production:

   | Nama | Isinya |
   |---|---|
   | `TURN_KEY_ID` | Key ID dari langkah 3 |
   | `TURN_KEY_API_TOKEN` | API Token dari langkah 3 |

5. Deploy ulang (atau tunggu push berikutnya). Setelah itu kabari aku, dan aku akan memeriksa
   bahwa relaynya benar-benar terpakai.

## Bagaimana aku tahu relaynya sudah jalan

Saat panggilan hidup, dok di halaman admin menulis `talking · 48 ms`, dan kalau relay yang dipakai
ia menambahkan `· via relay`. Sebelum kunci dipasang, saat memanggil akan muncul keterangan
"Relay isn't set up yet, so this may not connect on mobile data."

## Biayanya

TURN Cloudflare dibayar per GB yang dilewatkan, dan hanya terpakai kalau sambungan langsung gagal.
Panggilan suara memakai sekitar 1 MB per menit per orang, jadi satu jam ngobrol kira-kira 60–120 MB.
Untuk pemakaian seperti kalian itu sangat kecil. Kalau nanti kamu mau melihat angkanya, setiap
kredensial ditandai dengan kode ruangnya, jadi pemakaian bisa ditelusuri per sesi.

## Hal yang perlu kamu tahu saat memakainya

**Pakai headphone.** Kalau musiknya keluar dari speaker, mikrofon akan ikut menangkap musik itu dan
mengirimkannya balik — hasilnya bergema dan peredam gema browser akan menggerogoti musiknya. Dengan
headphone, mikrofon hanya menangkap suaramu. Peringatan ini juga ditulis di tombol panggilnya.

**Yang memimpin musik tetap kamu.** Selama sesi, tombol play/jeda/geser di sisi vokalis dinonaktifkan
dan diberi keterangan; volume dan mute tetap miliknya karena itu tidak menggeser posisi lagu.

**Kalau panggilannya gagal, musiknya tidak terpengaruh.** Itu dirancang begitu dan diuji: setelah
panggilan ditutup di tengah sesi, kedua sisi masih serempak dalam 2 milidetik.
