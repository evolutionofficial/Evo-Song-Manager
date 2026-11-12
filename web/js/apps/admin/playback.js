// ADMIN — modul Pemutar: admin bisa mendengarkan semua lagu vokalis, dengan pemutar yang SAMA
// seperti di halaman vokalis (bar bawah + tampilan penuh; modul vocalist/player.js dipakai ulang).
//
// Alur: tombol ▶ di baris lagu → ctx.play(idLagu) → daftar lagu vokalis itu dipasang ke pemutar
// → event 'fc:play'. Lagu yang tidak punya audio (menurut database, aturan yang sama dengan
// halaman vokalis) tidak diputar. Antrean mengikuti vokalis tempat lagu dimainkan; berpindah tab
// vokalis tidak memutus lagu yang sedang berjalan.
//
// Listen together punya pemutarnya sendiri di dok. Keduanya tidak boleh bersuara bersamaan, jadi:
// saat ruang menyimak dibuka pemutar ini dihentikan, dan selama ruangnya terbuka ▶ ditolak.
import { toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { mount, setReport, clear } from '/js/apps/vocalist/player.js';
import { state } from './data.js';

/** Lagu vokalis ini, urutannya sama dengan nomor (#) di tabel: lama → baru. */
const songsOf = (voc) => state.songs.filter((s) => s.vocalist_id === voc.id && !s.deleted);

/** Apakah lagu ini bisa diputar (menurut admin_playable). */
export const canPlay = (s) => !!state.playable[s.vocalist_id]?.has(s.id);

/** Laporan dalam bentuk yang dipakai pemutar vokalis. */
function reportFor(voc) {
  const ok = state.playable[voc.id] || new Set();
  return {
    token: voc.share_token,
    name: voc.display_name,
    photo: voc.photo_path,
    from: voc.display_name,
    // ?v= hanya pemecah cache; berubah tiap lagu diganti dengan revisi baru.
    songs: songsOf(voc).map((s) => ({ ...s, audio: ok.has(s.id) ? `r${s.revision || 0}` : null })),
  };
}

export function play(id) {
  const s = state.songs.find((x) => x.id === id);
  const voc = s && state.vocalists.find((v) => v.id === s.vocalist_id);
  if (!s || !voc) return;
  if (window.ADMIN_LISTEN?.code) return toast('A listening session is open — use the player at the bottom, or end it first');
  if (!canPlay(s)) return toast(s.revision_requested_at ? 'This song is being revised — no audio right now' : 'No audio yet for this song');
  const rep = reportFor(voc);
  setReport(rep);
  const n = rep.songs.findIndex((x) => x.id === id) + 1;
  window.dispatchEvent(new CustomEvent('fc:play', { detail: { n } }));
}

export function init() {
  mount({ token: '', name: '', photo: null, songs: [] });

  // Sorot baris lagu yang sedang dipilih di pemutar.
  on(window, 'fc:track', 'Player', (e) => {
    state.playingId = e.detail.id || null;
    document.querySelectorAll('#table .row[data-id]').forEach((r) => r.classList.toggle('playing', r.dataset.id === state.playingId));
  });
  // Ruang menyimak dibuka → hentikan pemutar ini (satu jalur suara saja).
  on(window, 'admin:listen-start', 'Player', () => clear());
}
