# FC Song Manager

Web app laporan backing track First Club (Jeffry Ferdian).

- `web/` — situs (Cloudflare Workers static assets di akun Cloudflare Evolution, lihat `wrangler.jsonc`; repo: github.com/evolutionofficial/Evo-Song-Manager): admin, halaman vokalis (Songlist + Invoice), daftar semua lagu.
- `sync/` — program di PC yang memantau `D:\FIRST CLUB` dan mengirim file Mixdown ke database (Supabase).
  `config.json` berisi kunci sync dan **tidak** disimpan di repo; lihat `config.example.json`.

Pembagian segmen dan aturan modul: lihat [ARCHITECTURE.md](ARCHITECTURE.md).
