// VOKALIS — modul Invoice: harga, status lunas, ringkasan tagihan.
import { $ } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { rupiah, ribu, esc, norm, dateLabel, summarize } from '/js/core/format.js';

let rep;

function render() {
  const q = norm($('qInv').value.trim());
  const st = $('status').value;
  const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => (!q || norm(s.title).includes(q)) && (!st || (st === 'paid' ? s.paid : !s.paid)));
  if (!rows.length) { $('invTable').innerHTML = `<div class="empty">Tidak ada lagu yang cocok.</div>`; return; }
  const sum = summarize(rows);
  $('invTable').innerHTML =
    `<div class="row head cols-view"><span>No</span><span>Tanggal</span><span>Judul</span><span>Harga</span><span>Status</span></div>` +
    rows.map((s) => `<div class="row cols-view ${s.paid ? 'paid' : ''}">
      <span class="no dim">${s.n}</span>
      <span class="date dim">${esc(dateLabel(s))}</span>
      <span class="title dim">${esc(s.title)}</span>
      <span class="price dim">${s.price ? ribu(s.price) : '—'}</span>
      <span class="act">${s.paid ? '<span class="badge ok">Lunas</span>' : (s.price ? '<span class="badge warn">Belum</span>' : '<span class="badge muted">—</span>')}</span>
    </div>`).join('') +
    `<div class="row foot cols-view"><span class="no"></span><span class="date"></span><span class="title" style="text-align:right">Total${q || st ? ' (tersaring)' : ''}</span><span class="price">${ribu(sum.total)}</span><span class="act"></span></div>`;
}

export function mount(report) {
  rep = report;
  const sum = summarize(rep.songs);
  $('sTotal').textContent = rupiah(sum.total);
  $('sPaid').textContent = rupiah(sum.paid);
  $('sRest').textContent = rupiah(sum.rest);
  $('sCount').textContent = `${sum.paidCount} / ${sum.count}`;
  on($('qInv'), 'input', 'Invoice', render);
  on($('status'), 'change', 'Invoice', render);
  render();
}
