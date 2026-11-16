// ADMIN — halaman Call. Isinya tipis: panel panggilannya sendiri ada di core/callpanel.js
// karena halaman vokalis memakai modul yang sama. Yang beda hanya perannya.
//
// Pindah ke tab lain SELAGI menelepon tidak menutup panggilan: tampilannya disembunyikan dan
// pil hijau "In a call · Return" muncul di pojok untuk kembali. Hanya tombol tutup telepon
// yang mengakhiri panggilan.
import { $, toast } from '/js/core/ui.js';
import { createCallPanel } from '/js/core/callpanel.js';
import { state } from './data.js';

let panel = null;
let ctx = null;
let pill = null;

function paintPill() {
  if (!pill) return;
  pill.hidden = !(panel?.busy && state.tab !== 'call');
}

export function init(c) {
  ctx = c;
  pill = document.createElement('button');
  pill.className = 'call-pill';
  pill.type = 'button';
  pill.hidden = true;
  pill.textContent = 'In a call · Return';
  pill.addEventListener('click', () => ctx.openTab('call'));
  document.body.appendChild(pill);

  panel = createCallPanel({
    mount: $('callPanel'),
    role: 'host',
    // Daftar vokalis diambil saat panel digambar, bukan disimpan sekali: kalau Jeffry
    // menambah vokalis baru lalu Reload, pilihannya ikut terbarui sendiri.
    vocalists: () => state.vocalists || [],
    onError: (e) => toast('Call: ' + (e?.message || e), 'bad'),
    onBusyChange: (busy) => {
      // Panggilan berakhir selagi Jeffry di tab lain: lepaskan semua perangkat sekarang.
      if (!busy && state.tab !== 'call') { panel?.setAway(false); panel?.hide(); }
      paintPill();
    },
  });
}

export function render() {
  // render() dipanggil setiap data dimuat ulang, termasuk saat tab lain sedang terbuka.
  // Panggilan yang sedang hidup tidak boleh terganggu oleh itu.
  if (state.tab === 'call') { panel?.setAway(false); panel?.show(); }
  else if (panel?.busy) panel.setAway(true);
  else panel?.hide();
  paintPill();
}

/** Dipakai main.js untuk memperingatkan sebelum pergi, kalau nanti diperlukan. */
export const busy = () => !!panel?.busy;

/** Dari notifikasi "… is calling": pilih vokalisnya dan masuk ruangnya (tab Meeting sudah dibuka main.js). */
export function open(vocalistId) { return panel?.openVocalist(vocalistId); }
