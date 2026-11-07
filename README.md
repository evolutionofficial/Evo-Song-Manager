# First Club Songs

Web app laporan backing track First Club (Jeffry Ferdian).

- `web/` — situs (Netlify, publish directory `web`): halaman admin, halaman vokalis (Songlist + Invoice), daftar semua lagu.
- `sync/` — program kecil di PC yang memantau `D:\FIRST CLUB` dan mengirim file Mixdown ke database (Supabase).
  `config.json` berisi kunci sync dan **tidak** disimpan di repo; lihat `config.example.json`.
