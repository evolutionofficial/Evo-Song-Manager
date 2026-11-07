// VOKALIS — modul Songlist: My songs dan All songs (tanpa harga).
import { $ } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;
let scope = 'mine';

function render() {
  const q = norm($('qSongs').value.trim());
  if (scope === 'mine') {
    const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => !q || norm(s.title).includes(q));
    $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list"><span>No</span><span>Tanggal</span><span>Judul</span></div>` +
        rows.map((s) => `<div class="row cols-list"><span class="no">${s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}</span></div>`).join('')
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
  render();
}
