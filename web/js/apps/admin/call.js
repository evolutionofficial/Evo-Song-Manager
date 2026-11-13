// ADMIN — halaman Call. Isinya tipis: panel panggilannya sendiri ada di core/callpanel.js
// karena halaman vokalis memakai modul yang sama. Yang beda hanya perannya.
import { $, toast } from '/js/core/ui.js';
import { createCallPanel } from '/js/core/callpanel.js';
import { state } from './data.js';

let panel = null;
let ctx = null;

export function init(c) {
  ctx = c;
  panel = createCallPanel({
    mount: $('callPanel'),
    role: 'host',
    // Daftar vokalis diambil saat panel digambar, bukan disimpan sekali: kalau Jeffry
    // menambah vokalis baru lalu Reload, pilihannya ikut terbarui sendiri.
    vocalists: () => state.vocalists || [],
    onError: (e) => toast('Call: ' + (e?.message || e), 'bad'),
  });
}

export function render() {
  // render() dipanggil setiap data dimuat ulang, termasuk saat tab lain sedang terbuka.
  // Panggilan yang sedang hidup tidak boleh terganggu oleh itu.
  if (state.tab === 'call') panel?.show();
  else panel?.hide();
}

/** Dipakai main.js untuk memperingatkan sebelum pergi, kalau nanti diperlukan. */
export const busy = () => !!panel?.busy;
