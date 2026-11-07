// VOKALIS — modul Songlist: My songs (dengan tombol ▶) dan All songs (tanpa harga).
// Tombol ▶ mengirim event 'fc:play' ke modul Player (bar bawah). Kalau modul Player tidak
// berjalan, tombol tetap berfungsi sebagai link biasa ke halaman player terpisah.
import { $ } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;
let scope = 'mine';
let playing = 0;

const playUrl = (n) => `/v/${encodeURIComponent(rep.token)}/play/${n}`;

function render() {
  const q = norm($('qSongs').value.trim());
  if (scope === 'mine') {
    const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => !q || norm(s.title).includes(q));
    $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list play"><span>No</span><span>Tanggal</span><span>Judul</span><span></span></div>` +
        rows.map((s) => `<div class="row cols-list play ${s.n === playing ? 'playing' : ''}"><span class="no">${s.n === playing ? '<span class="eq" aria-label="Sedang dibuka"><i></i><i></i><i></i></span>' : s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}</span>` +
          `<span class="pl"><a class="btn playbtn" data-play="${s.n}" href="${playUrl(s.n)}" aria-label="Putar ${esc(s.title)}">▶</a></span></div>`).join('')
      : `<div class="empty">${q ? 'Tidak ada lagu yang cocok.' : 'Belum ada lagu.'}</div>`;
    return;
  }
  const rows = rep.all_songs.filter((s) => !q || norm(s.title + ' ' + s.vocalist).includes(q));
  if (!rows.length) { $('songsTable').innerHTML = `<div class="empty">Tidak ada lagu yang cocok.</div>`; return; }
  const groups = new Map();
  rows.forEach((s) => {
    if (!groups.has(s.vocalist)) groups.set(s.vocalist, { mine: s.mine, list: [] });
    groups.get(s.vocalist).list.push(s);
  });
  const ordered = [...groups.entries()].sort((a, b) => (b[1].mine - a[1].mine) || a[0].localeCompare(b[0]));
  $('songsTable').innerHTML = ordered.map(([name, g]) =>
    `<div class="group-h"><span>${esc(name)}${g.mine ? ' <span class="badge ok">kamu</span>' : ''}</span><span class="note">${g.list.length} lagu</span></div>` +
    g.list.map((s, i) => `<div class="row cols-list ${g.mine ? 'me' : ''}"><span class="no">${i + 1}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}</span></div>`).join('')
  ).join('');
}

export function mount(report) {
  rep = report;
  $('nMine').textContent = rep.songs.length;
  $('nAll').textContent = rep.all_songs.length;
  on($('scope'), 'click', 'Songlist', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    scope = b.dataset.scope;
    [...$('scope').children].forEach((c) => c.setAttribute('aria-pressed', c === b));
    render();
  });
  on($('qSongs'), 'input', 'Songlist', render);
  on($('songsTable'), 'click', 'Songlist', (e) => {
    const a = e.target.closest('[data-play]'); if (!a) return;
    if (!window.FC_PLAYER?.ready) return; // modul Player tidak jalan → biarkan link biasa
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('fc:play', { detail: { n: Number(a.dataset.play) } }));
  });
  window.addEventListener('fc:track', (e) => { playing = e.detail.n; if (scope === 'mine') render(); });
  render();
}
