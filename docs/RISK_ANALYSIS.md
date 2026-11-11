# RISK_ANALYSIS — Analisis risiko

Skala: kemungkinan dan dampak masing-masing Rendah / Sedang / Tinggi. "Sisa" adalah risiko yang
tetap ada setelah mitigasi.

## 1. Kehilangan data

| # | Risiko | Kemungkinan | Dampak | Mitigasi | Sisa |
|---|---|---|---|---|---|
| R1 | **WAV lama tertimpa ekspor ulang bernama sama sebelum sempat diarsipkan** (perangkat mati saat Revision, lalu admin langsung mengekspor) | Sedang | Tinggi (versi lama hilang) | Indikator "Old WAV not archived yet" di admin; arsip dijalankan sebagai pekerjaan pertama begitu agent menyala; pekerjaan arsip tidak memindahkan file yang fingerprint-nya sudah berbeda dan mencatat "versi lama tertimpa" | **Ada.** Penimpaan dilakukan DAW, di luar kendali sistem. Satu-satunya pencegahan penuh adalah salinan per versi (K4), yang ditolak karena ruang disk |
| R2 | Pemindahan ke `Cancel Song` menimpa arsip lama | Rendah | Tinggi | Pemindahan memakai tautan keras atau salin "gagal bila ada", tidak pernah `rename` yang bisa menimpa; bentrok nama masuk subfolder bertanggal | Sangat kecil |
| R3 | WAV yang ke Drive bukan file yang difinalisasi | Sedang hari ini | Tinggi (klien menerima versi salah) | Fingerprint diperiksa tepat sebelum unggah; tidak cocok → berhenti, admin diberi tahu | Kecil: pekerjaan tertahan, bukan salah kirim |
| R4 | Mati listrik di tengah pemindahan | Rendah | Sedang | Urutan tautan → verifikasi → hapus sumber; rekonsiliasi mengenali keadaan "dua-duanya ada" | Sangat kecil |
| R5 | Pembersih R2 menghapus audio yang masih dipakai | Rendah | Tinggi | Hanya menghapus kunci milik versi `superseded`/`cancelled`, ditunda 24 jam, dan dicek ulang bahwa bukan versi aktif tepat sebelum hapus | Sangat kecil |
| R6 | File Drive terhapus salah | Rendah | Sedang | Pindah ke Trash, bukan hapus permanen (K2) | Kecil; Trash dikosongkan Google setelah 30 hari |
| R7 | Backfill salah memasangkan lagu dengan versi | Rendah | Sedang | Jalankan dulu sebagai laporan; bandingkan laporan vokalis sebelum dan sesudah | Kecil |
| R8 | M4A lokal dihapus padahal belum aman (perilaku sekarang) | Rendah | Rendah | Di sistem target M4A dibuat agent di folder sementara; ekspor DAW tidak lagi dihapus | Hilang |

## 2. Unggah ganda

| # | Risiko | Mitigasi |
|---|---|---|
| D1 | Klik ganda / request ganda pada "Selesaikan & Upload" | Kunci idempotensi unik `finalize:<lagu>:<sha256>`; panggilan kedua mengembalikan pekerjaan yang sama |
| D2 | Agent restart di tengah unggah R2 | Kunci R2 tetap per versi; HEAD sebelum PUT; PUT ulang menimpa objek yang sama dengan isi sama |
| D3 | Agent restart di tengah unggah Drive | Label `evoUploadId`; rekonsiliasi mencari dulu sebelum mengunggah; sisa parsial dihapus |
| D4 | PC dan MacBook melihat file yang sama | Pekerjaan ditujukan ke satu perangkat; klaim memakai `SKIP LOCKED` + sewa; `activate_version` idempoten |
| D5 | Sewa habis saat agent lambat, lalu agent lain mengambil | `job_progress` ditolak untuk pemilik sewa lama, sehingga agent lama berhenti; hasil yang terlanjur terunggah dipakai agent baru lewat HEAD |
| D6 | Unggah berhasil, laporan ke database gagal | Rekonsiliasi: periksa R2/Drive, lalu catat tanpa unggah ulang |

Sisa: unggahan ke Drive yang putus di tengah tetap diulang dari awal (sesi resumable tidak disimpan).
Ini soal waktu, bukan duplikasi. Bisa ditambahkan nanti dengan menyimpan URL sesi di pekerjaan.

## 3. Race condition

| # | Kondisi | Penyelesaian |
|---|---|---|
| C1 | Revision ditekan saat WAV sedang diunggah | Database menandai batal; agent memeriksa status sebelum melapor; file yang terlanjur terunggah dibuang |
| C2 | Arsip WAV berjalan saat unggahan versi yang sama berjalan | Keduanya hanya bisa dikerjakan perangkat pemilik file, dan agent bekerja satu per satu; pekerjaan arsip menunggu unggahan berakhir. Satu instance agent dijamin penjaga (`supervisor.pid`) |
| C3 | Admin memfinalisasi kandidat B saat A masih berjalan | Indeks unik "satu finalisasi per lagu" menolak; admin membatalkan A dulu |
| C4 | Admin membatalkan finalisasi saat agent sedang mengunggah | `activate_version` gagal untuk versi `cancelled`; agent menghapus objek yang baru diunggah |
| C5 | Vokalis menekan Accept tepat saat versi baru diaktifkan | `accept_song` mengunci baris lagu; Accept mengikat versi yang aktif pada saat transaksi |
| C6 | File sedang ditulis DAW saat dihitung fingerprint-nya | Tunda 15 detik; validasi finalisasi memeriksa stabil dua kali dan header WAV; fingerprint dihitung ulang saat finalisasi dan saat unggah |
| C7 | Sync lama dan baru berjalan bersamaan saat transisi | Parameter baru `sync_files` opsional; Sync lama tidak mengisi kandidat tetapi tidak merusak |
| C8 | Dua tab admin | Sama dengan D1 dan C3; database yang memutuskan |

## 4. Konflik multi-perangkat

| # | Risiko | Mitigasi |
|---|---|---|
| M1 | Nama sama, isi beda, di PC dan MacBook | Dua kandidat untuk satu lagu; tidak ada yang otomatis menang; admin memilih |
| M2 | Sistem otomatis memilih "yang terbaru" | Tidak ada jalur kode yang mengaktifkan versi tanpa `finalize_song` dari admin |
| M3 | Perangkat offline membawa file lama saat online lagi | File itu hanya menjadi kandidat; versi aktif tidak berubah |
| M4 | Jam dua perangkat berbeda | Urutan versi memakai `version_no` dari database, bukan jam perangkat; `mtime` hanya ditampilkan |
| M5 | Pekerjaan untuk perangkat yang mati | Status "Waiting for <perangkat>" di admin dan "Preparing…" di vokalis. Kalau file yang sama (fingerprint sama) ada di perangkat lain yang hidup, admin bisa mengalihkan pekerjaan |
| M6 | Penggabungan lagu lintas sumber salah | Tidak ada penggabungan otomatis untuk data yang sudah ada; hanya saran |

## 5. Gangguan layanan cloud

| Layanan mati | Yang terjadi | Pemulihan |
|---|---|---|
| Supabase | Halaman tidak memuat data; agent menunggu dan tidak mengubah disk | Otomatis saat kembali; pekerjaan ada di database, tidak ada yang hilang |
| Cloudflare Pages / Functions | Halaman dan streaming mati; agent tetap bekerja | Otomatis |
| Cloudflare R2 | Finalisasi berhenti di tahap UPLOAD dan di-retry; pemutaran gagal | Otomatis; versi lama tetap aktif sampai versi baru terverifikasi |
| Google Drive | Unggah WAV dan unduhan operator/vokalis gagal; Accept tetap tercatat | Retry dengan jeda; setelah 8 kali → needs admin + tombol "Coba lagi" |
| Token Google kedaluwarsa atau dicabut | Semua unggah WAV dan unduhan gagal | Tidak otomatis: Jeffry menjalankan `login-google` dan `setup-cloudflare` lagi. Panel System menampilkannya sebagai galat khusus |
| Internet studio putus | Agent menunggu; pekerjaan tetap diklaim sampai sewa habis | Otomatis |

Ketergantungan tunggal yang perlu diketahui: Supabase adalah satu-satunya tempat status. Kalau
proyek Supabase hilang, R2 dan Drive masih berisi file tetapi tanpa peta. Mitigasi murah di luar
lingkup ini: ekspor database berkala.

## 6. Kegagalan pemulihan

| # | Risiko | Mitigasi |
|---|---|---|
| V1 | Rekonsiliasi menandai berhasil tanpa bukti | Status berhasil hanya setelah HEAD R2 / metadata Drive cocok ukuran dan MD5 |
| V2 | Retry tanpa akhir untuk kesalahan yang tidak akan sembuh (file hilang, fingerprint beda) | Kesalahan itu langsung `needs_admin`, tidak di-retry |
| V3 | Pekerjaan macet tidak terlihat | Panel System: pekerjaan yang lebih tua dari ambang, perangkat yang tidak terlihat, jumlah di menu admin |
| V4 | M4A sementara menumpuk | Dihapus di tahap CLEANUP dan saat agent menyala (file sementara lebih tua dari 24 jam) |
| V5 | Cache fingerprint lokal rusak | Cache hanya percepatan; bila tidak terbaca, file dihitung ulang |
| V6 | Agent baru punya galat dan terus mati | Penjaga sudah memberi jeda bertambah; versi agent tercatat per perangkat; rollback = menaruh kembali file versi lama |

## 7. Risiko terhadap fitur yang sudah berjalan

| Fitur | Risiko | Pengaman |
|---|---|---|
| Halaman operator | tidak disentuh | uji halaman operator yang ada tetap dijalankan tiap fase |
| Harga, lunas, invoice | tidak disentuh | kolom dan fungsi tidak berubah |
| Player | header cache berubah (F0) | diuji di iPhone sebelum rilis |
| Accept / Send to FC | fungsi diubah di F4–F5 | saklar; uji Accept → unggah → Send → unduh dari ujung ke ujung dengan lagu uji |
| Sync sumber `backup` | fingerprint ratusan file arsip | pindai bertahap, hanya saat drive tersambung |
| MacBook | disk hampir penuh | tidak ada salinan WAV; M4A sementara kecil dan langsung dihapus |

## 8. Tiga risiko terbesar

1. **R1** — WAV lama tertimpa sebelum diarsipkan. Tidak bisa dihapus sepenuhnya tanpa salinan per versi.
2. **F5 memindahkan file klien.** Fase ini dirilis terakhir di antara fitur inti, dengan saklar sendiri, dan diuji dulu pada lagu uji.
3. **Konversi M4A di PC** bergantung pada satu program tambahan (`ffmpeg.exe`). Kalau tidak diinginkan, K1 jatuh ke alternatif: tetap ekspor M4A dari DAW.
