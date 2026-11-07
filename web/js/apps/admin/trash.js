// ADMIN — modul Terhapus: daftar lagu yang disembunyikan + Kembalikan.
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { ribu, esc, dateLabel } from '/js/core/format.js';
import { vocDeleted, updateSong } from './data.js';

let ctx;

export function render() {
  const del = vocDeleted();
  $('delCount').textContent = del.length;
  $('delBox').classList.toggle('hidden', !del.length);
  $('delList').innerHTML = del.map((s) => `<div class="delrow">
      <span><b>${esc(s.title)}</b> <span class="note">· ${esc(dateLabel(s))}${s.price ? ' · ' + ribu(s.price) : ''}${s.paid ? ' · lunas' : ''}</span></span>
      <button data-restore="${s.id}">Kembalikan</button>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  on($('delList'), 'click', 'Terhapus', async (e) => {
    const id = e.target.dataset.restore; if (!id) return;
    if (await updateSong(id, { deleted: false }, ctx.renderAll)) toast('Lagu dikembalikan');
  });
}
