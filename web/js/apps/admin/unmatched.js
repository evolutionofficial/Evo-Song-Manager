// ADMIN — modul Perlu dicek: file dengan nama depan yang tidak cocok dengan vokalis mana pun.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc } from '/js/core/format.js';
import { state } from './data.js';

let ctx;

export function render() {
  if (state.errors.unmatched) { $('unList').innerHTML = `<div class="table"><div class="empty">Data gagal dimuat. Tekan Muat ulang.</div></div>`; return; }
  if (!state.unmatched.length) { $('unList').innerHTML = `<div class="table"><div class="empty">Tidak ada file yang perlu dicek.</div></div>`; return; }
  const groups = {};
  state.unmatched.forEach((u) => (groups[u.prefix] ||= []).push(u));
  const opts = state.vocalists.map((v) => `<option value="${v.id}">${esc(v.display_name)}</option>`).join('');
  $('unList').innerHTML = Object.entries(groups).map(([prefix, files]) => `
    <div class="panel">
      <h2>Nama di file: “${esc(prefix)}” <span class="badge warn">${files.length} file</span></h2>
      <ul class="note" style="margin:0 0 12px;padding-left:18px">${files.map((f) => `<li>${esc(f.file_name)} <span style="color:var(--faint)">· ${esc(f.rel_path)}</span></li>`).join('')}</ul>
      <div class="bar" style="margin:0">
        <select data-assign-sel="${esc(prefix)}" style="width:auto"><option value="">Masukkan ke tabel…</option>${opts}</select>
        <button data-assign="${esc(prefix)}">Simpan</button>
      </div>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  on($('unList'), 'click', 'Perlu dicek', async (e) => {
    const prefix = e.target.dataset.assign; if (prefix === undefined) return;
    const sel = [...document.querySelectorAll('[data-assign-sel]')].find((s) => s.dataset.assignSel === prefix);
    if (!sel.value) return toast('Pilih vokalis dulu', 'bad');
    const { data, error } = await sb.rpc('assign_prefix', { p_prefix: prefix, p_vocalist: sel.value });
    if (error) return toast('Gagal: ' + error.message, 'bad');
    toast(`${data} file dipindahkan`);
    await ctx.reload();
  });
}
