// ADMIN — judul kembar: dua file dengan judul sama untuk vokalis yang sama.
// Sistem tidak pernah menggabungkan atau memilih sendiri — menggabungkan dua lagu yang ternyata
// memang berbeda tidak bisa dibatalkan. Halaman ini hanya menyajikan kandidatnya.
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, fmtDate } from '/js/core/format.js';
import { state, updateSong } from './data.js';

let ctx;
const mb = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '—');

function songCard(s) {
  const tags = [
    // Yang menentukan bagi vokalis: ada audionya atau tidak. "Finalized" adalah istilah
    // jalur manual yang sudah dibuang, jadi tidak ditampilkan lagi supaya tidak membingungkan.
    s.has_audio || s.finalized
      ? '<span class="badge ok">vocalist can hear it</span>'
      : '<span class="badge muted">no audio yet</span>',
    s.accepted ? '<span class="badge ok">accepted</span>' : '',
    s.on_revision ? '<span class="badge rev">on revision</span>' : '',
    s.paid ? '<span class="badge ok">paid</span>' : '',
  ].filter(Boolean).join(' ');
  return `<div class="cf-song">
    <div class="cf-head"><b>${esc(s.title)}</b> ${tags}</div>
    <div class="cf-meta">${esc(s.device || s.source)} · ${esc(s.source)} · ${esc(s.mtime ? fmtDate(s.mtime) : '—')}
      · ${esc(mb(s.size))}${s.sha ? ` · <span class="dim">${esc(s.sha)}</span>` : ''}</div>
    <div class="cf-path dim">${esc(s.rel_path)}</div>
    <div class="cf-acts">
      <button data-open="${esc(s.id)}">Open table</button>
      ${s.accepted ? '' : `<button class="danger" data-del="${esc(s.id)}">Remove from list</button>`}
    </div>
  </div>`;
}

export async function render() {
  const list = state.conflicts || [];
  if (state.errors.conflicts) {
    $('cfList').innerHTML = '<div class="empty">Could not load this list. Press Reload.</div>';
    return;
  }
  $('cfList').innerHTML = list.length
    ? list.map((g) => `<div class="panel cf-group">
        <h2>${esc(g.vocalist)} — ${esc(g.title)}</h2>
        <p class="note">${g.count} files share this title${g.sources > 1 ? ` across ${g.sources} folders` : ''}.
          Decide which one is the real version. Nothing is merged automatically.</p>
        ${g.songs.map(songCard).join('')}
      </div>`).join('')
    : `<div class="empty">No duplicate titles.<br><span class="op-hint">If the same song turns up twice — on two computers, or rendered into two folders — it appears here.</span></div>`;
}

export function count() { return (state.conflicts || []).length; }

export function init(c) {
  ctx = c;
  on($('cfList'), 'click', 'Conflicts', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const s = state.songs.find((x) => x.id === open.dataset.open);
      if (s) ctx.openTab('v:' + s.vocalist_id);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const s = state.songs.find((x) => x.id === del.dataset.del);
      if (!s || !confirm(`Remove "${s.title}" from the list?\n\nThe file on the computer is not touched. You can restore it from Deleted.`)) return;
      const { error } = await updateSong(s.id, { deleted: true });
      if (error) return toast('Failed: ' + error.message, 'bad');
      toast('Removed from the list');
      await ctx.reload();
    }
  });
}
