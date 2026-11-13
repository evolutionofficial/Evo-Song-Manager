// ADMIN — modul Perlu dicek: file dengan nama depan yang tidak cocok dengan vokalis mana pun.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc } from '/js/core/format.js';
import { state } from './data.js';

let ctx;

export function render() {
  if (state.errors.unmatched) { $('unList').innerHTML = `<div class="table"><div class="empty">Data failed to load. Press Reload.</div></div>`; return; }
  if (!state.unmatched.length) { $('unList').innerHTML = `<div class="table"><div class="empty">Nothing to review.</div></div>`; return; }
  const groups = {};
  state.unmatched.forEach((u) => (groups[u.prefix] ||= []).push(u));
  const opts = state.vocalists.map((v) => `<option value="${v.id}">${esc(v.display_name)}</option>`).join('');
  $('unList').innerHTML = Object.entries(groups).map(([prefix, files]) => `
    <div class="panel">
      <h2>Name in file: “${esc(prefix)}” <span class="badge warn">${files.length} file${files.length > 1 ? 's' : ''}</span></h2>
      <ul class="note" style="margin:0 0 12px;padding-left:18px">${files.map((f) => `<li>${esc(f.file_name)} <span style="color:var(--faint)">· ${esc(f.rel_path)}</span></li>`).join('')}</ul>
      <div class="bar" style="margin:0">
        <select data-assign-sel="${esc(prefix)}" style="width:auto"><option value="">Add to table…</option>${opts}</select>
        <button data-assign="${esc(prefix)}">Save</button>
        <button data-ignore="${esc(prefix)}" class="danger" title="Nama ini bukan vokalis di aplikasi ini. Filenya dibiarkan di komputer, hanya tidak ditanyakan lagi.">Not a vocalist — hide</button>
      </div>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  on($('unList'), 'click', 'Needs review', async (e) => {
    // "Bukan vokalis": nama disembunyikan untuk SETERUSNYA, bukan cuma barisnya dihapus.
    // File baru dengan nama yang sama pun tidak akan muncul lagi di sini. Tidak ada file
    // yang dipindah, diubah atau dihapus di komputer.
    const ign = e.target.closest('[data-ignore]')?.dataset.ignore;
    if (ign !== undefined) {
      if (!confirm(`Sembunyikan nama “${ign}”?\n\nFile dengan nama depan ini tidak akan ditanyakan lagi, sekarang maupun nanti. File di komputer tidak disentuh sama sekali.`)) return;
      const { data, error } = await sb.rpc('ignore_prefix', { p_prefix: ign });
      if (error) return toast('Failed: ' + error.message, 'bad');
      toast(`“${ign}” disembunyikan (${data} file)`);
      await ctx.reload();
      return;
    }
    const prefix = e.target.dataset.assign; if (prefix === undefined) return;
    const sel = [...document.querySelectorAll('[data-assign-sel]')].find((s) => s.dataset.assignSel === prefix);
    if (!sel.value) return toast('Choose a vocalist first', 'bad');
    const { data, error } = await sb.rpc('assign_prefix', { p_prefix: prefix, p_vocalist: sel.value });
    if (error) return toast('Failed: ' + error.message, 'bad');
    toast(`${data} file(s) moved`);
    await ctx.reload();
  });
}
