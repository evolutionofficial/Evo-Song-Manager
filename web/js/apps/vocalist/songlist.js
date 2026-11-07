// VOKALIS — modul Songlist: My songs (dengan tombol ▶) dan All songs (seperti spreadsheet: kolom per vokalis,
// lagu terbaru di atas, tanpa harga).
// Tombol "Send to FC" mengirim event 'fc:send' ke modul Send (send.js).
// Tombol ▶ mengirim event 'fc:play' ke modul Player (bar bawah). Kalau modul Player tidak
// berjalan, tombol tetap berfungsi sebagai link biasa ke halaman player terpisah.
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;
let scope = 'mine';
let playing = 0;

const SEND_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

const playUrl = (n) => `/v/${encodeURIComponent(rep.token)}/play/${n}`;

function render() {
  const q = norm($('qSongs').value.trim());
  if (scope === 'mine') {
    const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => !q || norm(s.title).includes(q));
    $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list play"><span>No</span><span>Tanggal</span><span>Judul</span><span></span></div>` +
        rows.map((s) => `<div class="row cols-list play ${s.n === playing ? 'playing' : ''}"><span class="no">${s.n === playing ? '<span class="eq" aria-label="Sedang dibuka"><i></i><i></i><i></i></span>' : s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}</span>` +
          `<span class="pl"><button class="sendbtn" data-send="${s.n}" aria-label="Send to FC: ${esc(s.title)}">${SEND_ICON}<span>Send to FC</span></button><a class="btn playbtn" data-play="${s.n}" href="${playUrl(s.n)}" aria-label="Putar ${esc(s.title)}">▶</a></span></div>`).join('')
      : `<div class="empty">${q ? 'Tidak ada lagu yang cocok.' : 'Belum ada lagu.'}</div>`;
    return;
  }
  renderSheet(q);
}

// All songs: tampilan seperti spreadsheet — satu kolom per vokalis, judul ke bawah, terbaru di atas.
function renderSheet(q) {
  const byVoc = new Map();
  for (const s of rep.all_songs) {
    if (!byVoc.has(s.vocalist)) byVoc.set(s.vocalist, { mine: s.mine, list: [] });
    byVoc.get(s.vocalist).list.push(s);
  }
  const cols = [...byVoc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([name, g]) => {
    const list = g.list
      .filter((s) => !q || norm(s.title).includes(q) || norm(name).includes(q))
      .sort((a, b) => new Date(b.mtime || 0) - new Date(a.mtime || 0));
    return { name, mine: g.mine, total: g.list.length, list };
  });
  const depth = Math.max(0, ...cols.map((c) => c.list.length));
  if (!depth) { $('songsTable').innerHTML = `<div class="empty">Tidak ada lagu yang cocok.</div>`; return; }
  const head = `<tr><th class="rn" scope="col">#</th>${cols.map((c) =>
    `<th scope="col" class="${c.mine ? 'me' : ''}"><span class="vn">${esc(c.name)}</span>${c.mine ? '<span class="badge ok">kamu</span>' : ''}<span class="vc">${q ? `${c.list.length}/` : ''}${c.total}</span></th>`).join('')}</tr>`;
  let body = '';
  for (let i = 0; i < depth; i++) {
    body += `<tr><td class="rn">${i + 1}</td>${cols.map((c) => {
      const s = c.list[i];
      return s ? `<td class="${c.mine ? 'me' : ''}"><span class="st">${esc(s.title)}</span><span class="sd">${esc(dateLabel(s))}</span></td>` : `<td class="${c.mine ? 'me' : ''} blank"></td>`;
    }).join('')}</tr>`;
  }
  $('songsTable').innerHTML = `<div class="sheet" role="region" aria-label="Semua lagu per vokalis" tabindex="0"><table style="--cols:${cols.length}"><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
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
    const sb = e.target.closest('[data-send]');
    if (sb) {
      // Diteruskan ke modul Send to FC (nanti: kirim ke FC lewat WhatsApp). Modul tidak jalan → pesan saja.
      if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:send', { detail: { n: Number(sb.dataset.send) } }));
      else toast('Send to FC belum tersedia');
      return;
    }
    const a = e.target.closest('[data-play]'); if (!a) return;
    if (!window.FC_PLAYER?.ready) return; // modul Player tidak jalan → biarkan link biasa
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('fc:play', { detail: { n: Number(a.dataset.play) } }));
  });
  window.addEventListener('fc:track', (e) => { playing = e.detail.n; if (scope === 'mine') render(); });
  render();
}
