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
      <label>Folder: ${esc(v.folder_name)}${v.aliases?.length ? ' · also accepts: ' + v.aliases.map(esc).join(', ') : ''}${v.active ? '' : ' · <span style="color:var(--bad)">folder not found on PC</span>'}</label>
      <div class="linkbox">
        <input type="text" value="${esc(v.display_name)}" data-name="${v.id}" aria-label="Display name ${esc(v.display_name)}">
        <button data-savename="${v.id}">Save name</button>
        <button data-regen="${v.id}" title="The old link will stop working">New link</button>
      </div>
    </div>`).join('');
}

export function init(c) {
  ctx = c;
  const L = 'Settings';

  on($('showPrices'), 'change', L, async (e) => {
    const { error } = await sb.from('app_settings').update({ show_prices_public: e.target.checked }).eq('id', 1);
    if (error) { e.target.checked = !e.target.checked; return toast('Failed: ' + error.message, 'bad'); }
    state.settings.show_prices_public = e.target.checked;
    toast(e.target.checked ? 'Prices shown on the public page' : 'Prices hidden from the public page');
  });

  on($('vocSettings'), 'click', L, async (e) => {
    const sid = e.target.dataset.savename, rid = e.target.dataset.regen;
    if (sid) {
      const name = document.querySelector(`[data-name="${sid}"]`).value.trim();
      if (!name) return toast('Name cannot be empty', 'bad');
      const { error } = await sb.from('vocalists').update({ display_name: name }).eq('id', sid);
      if (error) return toast('Failed: ' + error.message, 'bad');
      state.vocalists.find((v) => v.id === sid).display_name = name;
      ctx.renderAll();
      toast('Name saved');
    }
    if (rid) {
      const v = state.vocalists.find((x) => x.id === rid);
      if (!confirm(`Create a new link for ${v.display_name}? The old link will stop working immediately.`)) return;
      const { data, error } = await sb.rpc('regenerate_token', { p_vocalist: rid });
      if (error) return toast('Failed: ' + error.message, 'bad');
      v.share_token = data;
      toast('New link created. See it on ' + v.display_name + "'s page");
    }
  });
}
