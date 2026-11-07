// ADMIN — modul Ganti revisi: pilih file baru untuk mengambil alih baris lagu lama.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { ribu, esc, fmtDate } from '/js/core/format.js';
import { state, vocSongs } from './data.js';

let ctx;
let repFrom = null;

export function open(id) {
  const s = state.songs.find((x) => x.id === id);
  const cands = vocSongs().filter((x) => x.id !== id)
    .sort((a, b) => new Date(b.file_mtime || 0) - new Date(a.file_mtime || 0));
  if (!cands.length) return toast('Belum ada file lain dari vokalis ini untuk dijadikan revisi', 'bad');
  repFrom = s;
  $('repTitle').textContent = s.title;
  $('repErr').textContent = '';
  $('repSel').innerHTML = `<option value="">Pilih file…</option>` + cands.map((c) =>
    `<option value="${c.id}">${esc(fmtDate(c.file_mtime))} · ${esc(c.file_name)}${c.price ? ' · ' + ribu(c.price) : ''}${c.paid ? ' · lunas' : ''}</option>`).join('');
  $('repDlg').showModal();
}

export function init(c) {
  ctx = c;
  const L = 'Ganti revisi';
  on($('repOk'), 'click', L, async (e) => {
    e.preventDefault();
    const to = $('repSel').value;
    if (!to) { $('repErr').textContent = 'Pilih file revisinya dulu.'; return; }
    $('repOk').disabled = true;
    try {
      const { error } = await sb.rpc('replace_song', { p_old: repFrom.id, p_new: to });
      if (error) { $('repErr').textContent = error.message; return; }
    } finally {
      $('repOk').disabled = false;
    }
    $('repDlg').close();
    toast(`"${repFrom.title}" diganti dengan file revisi`);
    await ctx.reload();
  });
  on($('repSel'), 'change', L, () => ($('repErr').textContent = ''));
}
