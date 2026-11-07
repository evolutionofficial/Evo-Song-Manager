// VOKALIS — modul Send to FC. Menerima event 'fc:send' { n } dari Songlist.
// Alur pengirimannya (mis. lewat WhatsApp Business ke operator FC) belum diputuskan,
// jadi untuk sekarang hanya memberi tahu bahwa fitur ini segera hadir.
// Saat alurnya disepakati, cukup file ini yang diisi; Songlist tidak perlu diubah.
import { toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';

let rep;

export function mount(report) {
  rep = report;
  on(window, 'fc:send', 'Send to FC', (e) => {
    const s = rep.songs[e.detail.n - 1];
    if (!s) return;
    toast(`Send to FC is coming soon · ${s.title}`);
  });
  window.FC_SEND = { ready: true };
}
