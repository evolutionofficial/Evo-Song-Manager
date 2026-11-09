// ADMIN — modul Revisions: daftar permintaan revisi dari vokalis (tombol Revision di halaman vokalis).
// Sebuah permintaan selesai otomatis saat lagunya diganti dengan "Replace with revision"
// atau saat vokalis menekan Accept lagi. Bisa juga ditutup manual (Dismiss).
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, timeAgo, fmtDate, dateLabel } from '/js/core/format.js';
import { state, updateSong } from './data.js';

let ctx;

/** Lagu yang sedang diminta revisi, terbaru di atas. */
export const pending = () => state.songs
  .filter((s) => !s.deleted && !s.accepted_at && s.revision_requested_at)
  .sort((a, b) => new Date(b.revision_requested_at) - new Date(a.revision_requested_at));

export function render() {
  const list = pending();
  if (!list.length) { $('rrList').innerHTML = `<div class="table"><div class="empty">No revision requests.</div></div>`; return; }
  const voc = (id) => state.vocalists.find((v) => v.id === id)?.display_name || '?';
  $('rrList').innerHTML = list.map((s) => `
    <div class="panel rr">
      <div class="rr-head">
        <div>
          <div class="rr-voc">${esc(voc(s.vocalist_id))}</div>
          <h2 class="rr-title">${esc(s.title)}${s.revision ? ` <span class="badge muted">revision ${s.revision}</span>` : ''}</h2>
          <div class="rr-meta">${esc(dateLabel(s))} · requested <span title="${esc(fmtDate(s.revision_requested_at))}">${esc(timeAgo(s.revision_requested_at))}</span></div>
        </div>
      </div>
      ${s.revision_note ? `<p class="rr-note">“${esc(s.revision_note)}”</p>` : '<p class="rr-note none">No note from the vocalist.</p>'}
      <div class="bar" style="margin:0">
        <button class="primary" data-rr-rep="${s.id}">Replace with revision…</button>
        <button data-rr-open="${s.vocalist_id}">Open ${esc(voc(s.vocalist_id))}'s table</button>
        <button class="ghost" data-rr-dismiss="${s.id}" title="Remove from this list without making a revision">Dismiss</button>
      </div>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  on($('rrList'), 'click', 'Revisions', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rrRep) return ctx.openReplace(b.dataset.rrRep);
    if (b.dataset.rrOpen) return ctx.openTab('v:' + b.dataset.rrOpen);
    const id = b.dataset.rrDismiss;
    if (id) {
      const s = state.songs.find((x) => x.id === id);
      if (!confirm(`Dismiss the revision request for "${s.title}"?\n\nIt is removed from this list. The vocalist can still Accept the song as it is.`)) return;
      if (await updateSong(id, { revision_requested_at: null, revision_note: null }, ctx.renderAll)) toast('Request dismissed');
    }
  });
}
