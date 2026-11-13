// VOKALIS — tab Call. Satu tombol saja: Call (jadi "Answer" kalau Jeffry menelepon lebih
// dulu). Saat tersambung hanya ada tiga tombol: tutup telepon, bisukan mikrofon, matikan
// kamera. Tidak ada berbagi layar di sisi ini — itu memang hanya untuk admin.
//
// Panelnya sendiri ada di core/callpanel.js, dipakai bersama halaman admin.
import { $ } from '/js/core/ui.js';
import { report } from '/js/core/guard.js';
import { createCallPanel } from '/js/core/callpanel.js';

let panel = null;

export function mount(rep) {
  panel = createCallPanel({
    mount: $('vCallPanel'),
    role: 'guest',
    token: rep.token,
    onError: (e) => report('call', e),
  });

  // Kamera dan mikrofon baru diminta saat tab Call dibuka, bukan saat halaman dimuat.
  // Vokalis yang hanya mau melihat daftar lagunya tidak perlu ditanyai izin apa pun.
  window.addEventListener('fc:view', (e) => {
    if (e.detail === 'call') panel.show(); else panel.hide();
  });
  if (location.hash === '#call') panel.show();
}
