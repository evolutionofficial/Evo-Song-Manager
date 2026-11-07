// PUBLIK — daftar semua lagu. Satu modul; error ditangkap supaya halaman tidak blank.
import { sb } from '/js/core/supabase.js';
import { $ } from '/js/core/ui.js';
import { ribu, esc, norm, dateLabel } from '/js/core/format.js';
import { safe, on, installGlobalHandlers } from '/js/core/guard.js';

installGlobalHandlers();
let data = { songs: [], show_prices: false };
let who = '';

async function load() {
  const { data: d, error } = await sb.rpc('get_public_songs');
  if (error) { $('table').innerHTML = `<div class="empty">Gagal memuat data. Coba muat ulang halaman.</div>`; return; }
  data = d || { songs: [] };
  if (data.show_prices) $('status').classList.remove('hidden');
  renderChips();
  render();
}

function renderChips() {
  const counts = {};
  data.songs.forEach((s) => (counts[s.vocalist] = (counts[s.vocalist] || 0) + 1));
  const names = Object.keys(counts).sort((a, b) => a.localeCompare(b));
  $('chips').innerHTML =
    `<button class="chip" aria-pressed="${who === ''}" data-v="">Semua <span class="n">${data.songs.length}</span></button>` +
    names.map((n) => `<button class="chip" aria-pressed="${who === n}" data-v="${esc(n)}">${esc(n)} <span class="n">${counts[n]}</span></button>`).join('');
}

function render() {
  const q = norm($('q').value.trim());
  const st = $('status').value;
  const rows = data.songs.filter((s) =>
    (!who || s.vocalist === who) &&
    (!q || norm(s.title + ' ' + s.vocalist).includes(q)) &&
    (!st || (st === 'paid' ? s.paid : !s.paid)));
  const cls = data.show_prices ? 'cols-all prices' : 'cols-all';
  $('sub').textContent = `${rows.length} dari ${data.songs.length} lagu`;
  if (!rows.length) { $('table').innerHTML = `<div class="empty">Tidak ada lagu yang cocok dengan pencarian.</div>`; return; }
  $('table').innerHTML =
    `<div class="row head ${cls}"><span>Vokalis</span><span>Tanggal</span><span>Judul</span>${data.show_prices ? '<span>Harga</span><span>Status</span>' : ''}</div>` +
    rows.map((s) => `<div class="row ${cls}">
      <span class="who">${esc(s.vocalist)}</span>
      <span class="date">${esc(dateLabel(s))}</span>
      <span class="title">${esc(s.title)}</span>
      ${data.show_prices ? `<span class="price">${s.price ? ribu(s.price) : '—'}</span>
      <span class="act">${s.paid ? '<span class="badge ok">Lunas</span>' : (s.price ? '<span class="badge warn">Belum</span>' : '')}</span>` : ''}
    </div>`).join('');
}

on($('q'), 'input', 'Daftar lagu', render);
on($('status'), 'change', 'Daftar lagu', render);
on($('chips'), 'click', 'Daftar lagu', (e) => {
  const b = e.target.closest('.chip'); if (!b) return;
  who = b.dataset.v; renderChips(); render();
});
safe('Daftar lagu', load, $('table'));
