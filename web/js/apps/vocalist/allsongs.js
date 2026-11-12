// VOKALIS — modul All Song List (dibuka dari laci): tampilan seperti spreadsheet —
// satu kolom per vokalis, judul ke bawah, terbaru di atas, tanpa harga. Ada pencarian sendiri.
// Urutan kolom: milik vokalis pemilik halaman di paling kiri, lalu vokalis lain urut abjad.
import { $ } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;

function render() {
  const q = norm($('qAll').value.trim());
  const byVoc = new Map();
  for (const s of rep.all_songs) {
    if (!byVoc.has(s.vocalist)) byVoc.set(s.vocalist, { mine: s.mine, list: [] });
    byVoc.get(s.vocalist).list.push(s);
  }
  // Kolom milik vokalis pemilik halaman ini paling kiri; vokalis lain menyusul urut abjad.
  const cols = [...byVoc.entries()].sort((a, b) => (Number(b[1].mine) - Number(a[1].mine)) || a[0].localeCompare(b[0])).map(([name, g]) => {
    const list = g.list
      .filter((s) => !q || norm(s.title).includes(q) || norm(name).includes(q))
      .sort((a, b) => new Date(b.mtime || 0) - new Date(a.mtime || 0));
    return { name, mine: g.mine, total: g.list.length, list };
  });
  const depth = Math.max(0, ...cols.map((c) => c.list.length));
  if (!depth) { $('allTable').innerHTML = `<div class="empty">No matching songs.</div>`; return; }
  const head = `<tr><th class="rn" scope="col">#</th>${cols.map((c) =>
    `<th scope="col" class="${c.mine ? 'me' : ''}"><span class="vn">${esc(c.name)}</span>${c.mine ? '<span class="badge ok">you</span>' : ''}<span class="vc">${q ? `${c.list.length}/` : ''}${c.total}</span></th>`).join('')}</tr>`;
  let body = '';
  for (let i = 0; i < depth; i++) {
    body += `<tr><td class="rn">${i + 1}</td>${cols.map((c) => {
      const s = c.list[i];
      return s ? `<td class="${c.mine ? 'me' : ''}"><span class="st">${esc(s.title)}</span><span class="sd">${esc(dateLabel(s))}</span></td>` : `<td class="${c.mine ? 'me' : ''} blank"></td>`;
    }).join('')}</tr>`;
  }
  $('allTable').innerHTML = `<div class="sheet" role="region" aria-label="All songs by vocalist" tabindex="0"><table style="--cols:${cols.length}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

export function mount(report) {
  rep = report;
  on($('qAll'), 'input', 'All Song List', render);
  render();
}
