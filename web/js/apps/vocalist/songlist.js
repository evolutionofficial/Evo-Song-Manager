// VOKALIS — modul Songlist (My Songs): lagu milik vokalis ini, dengan tombol Send to FC dan ▶.
// All Song List ada di modul terpisah (allsongs.js), dibuka dari laci.
// Tombol "Send to FC" mengirim event 'fc:send' ke modul Send (send.js).
// Tombol ▶ mengirim event 'fc:play' ke modul Player (bar bawah). Kalau modul Player tidak
// berjalan, tombol tetap berfungsi sebagai link biasa ke halaman player terpisah.
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;
let playing = 0;

const SEND_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

const playUrl = (n) => `/v/${encodeURIComponent(rep.token)}/play/${n}`;

function render() {
  const q = norm($('qSongs').value.trim());
  const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).reverse().filter((s) => !q || norm(s.title).includes(q));
  $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list play"><span>#</span><span>Date</span><span>Title</span><span></span></div>` +
        rows.map((s) => `<div class="row cols-list play ${s.n === playing ? 'playing' : ''}"><span class="no">${s.n === playing ? '<span class="eq" aria-label="Now playing"><i></i><i></i><i></i></span>' : s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}</span>` +
          `<span class="pl"><button class="sendbtn" data-send="${s.n}" aria-label="Send to FC: ${esc(s.title)}">${SEND_ICON}<span>Send to FC</span></button><a class="btn playbtn" data-play="${s.n}" href="${playUrl(s.n)}" aria-label="Play ${esc(s.title)}">▶</a></span></div>`).join('')
      : `<div class="empty">${q ? 'No matching songs.' : 'No songs yet.'}</div>`;
}

export function mount(report) {
  rep = report;
  on($('qSongs'), 'input', 'Songlist', render);
  on($('songsTable'), 'click', 'Songlist', (e) => {
    const sb = e.target.closest('[data-send]');
    if (sb) {
      // Diteruskan ke modul Send to FC (nanti: kirim ke FC lewat WhatsApp). Modul tidak jalan → pesan saja.
      if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:send', { detail: { n: Number(sb.dataset.send) } }));
      else toast('Send to FC is not available yet');
      return;
    }
    const a = e.target.closest('[data-play]'); if (!a) return;
    if (!window.FC_PLAYER?.ready) return; // modul Player tidak jalan → biarkan link biasa
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('fc:play', { detail: { n: Number(a.dataset.play) } }));
  });
  window.addEventListener('fc:track', (e) => { playing = e.detail.n; render(); });
  render();
}
