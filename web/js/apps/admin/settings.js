// ADMIN — modul Pengaturan: harga di halaman publik, nama tampilan vokalis, ganti link.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc } from '/js/core/format.js';
import { state } from './data.js';

let ctx;

export function render() {
  $('showPrices').checked = !!state.settings?.show_prices_public;
  $('vocSettings').innerHTML = state.vocalists.map((v) => `
    <div class="field" style="border-top:1px solid var(--line);padding-top:12px">
      <label>Folder: ${esc(v.folder_name)}${v.aliases?.length ? ' · juga menerima nama: ' + v.aliases.map(esc).join(', ') : ''}${v.active ? '' : ' · <span style="color:var(--bad)">folder tidak ada di PC</span>'}</label>
      <div class="linkbox">
        <input type="text" value="${esc(v.display_name)}" data-name="${v.id}" aria-label="Nama tampilan ${esc(v.display_name)}">
        <button data-savename="${v.id}">Simpan nama</button>
        <button data-regen="${v.id}" title="Link lama tidak bisa dipakai lagi">Ganti link</button>
      </div>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  const L = 'Pengaturan';

  on($('showPrices'), 'change', L, async (e) => {
    const { error } = await sb.from('app_settings').update({ show_prices_public: e.target.checked }).eq('id', 1);
    if (error) { e.target.checked = !e.target.checked; return toast('Gagal: ' + error.message, 'bad'); }
    state.settings.show_prices_public = e.target.checked;
    toast(e.target.checked ? 'Harga ditampilkan di halaman publik' : 'Harga disembunyikan dari halaman publik');
  });

  on($('vocSettings'), 'click', L, async (e) => {
    const sid = e.target.dataset.savename, rid = e.target.dataset.regen;
    if (sid) {
      const name = document.querySelector(`[data-name="${sid}"]`).value.trim();
      if (!name) return toast('Nama tidak boleh kosong', 'bad');
      const { error } = await sb.from('vocalists').update({ display_name: name }).eq('id', sid);
      if (error) return toast('Gagal: ' + error.message, 'bad');
      state.vocalists.find((v) => v.id === sid).display_name = name;
      ctx.renderAll();
      toast('Nama disimpan');
    }
    if (rid) {
      const v = state.vocalists.find((x) => x.id === rid);
      if (!confirm(`Ganti link ${v.display_name}? Link lama langsung tidak bisa dibuka lagi.`)) return;
      const { data, error } = await sb.rpc('regenerate_token', { p_vocalist: rid });
      if (error) return toast('Gagal: ' + error.message, 'bad');
      v.share_token = data;
      toast('Link baru dibuat. Lihat di tab ' + v.display_name);
    }
  });
}
