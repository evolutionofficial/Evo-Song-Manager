# FC Song Manager

Web app laporan backing track First Club (Jeffry Ferdian).

- `web/` — situs (Cloudflare Workers static assets, lihat `wrangler.jsonc`; https://fc-song-manager.jeffryfe0609.workers.dev): admin, halaman vokalis (Songlist + Invoice), daftar semua lagu.
- `sync/` — program di PC yang memantau `D:\FIRST CLUB` dan mengirim file Mixdown ke database (Supabase).
  `config.json` berisi kunci sync dan **tidak** disimpan di repo; lihat `config.example.json`.

Pembagian segmen dan aturan modul: lihat [ARCHITECTURE.md](ARCHITECTURE.md).
