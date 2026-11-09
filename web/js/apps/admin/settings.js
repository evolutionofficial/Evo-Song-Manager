// ADMIN — modul Pengaturan: harga di halaman publik, nama tampilan vokalis, foto vokalis, ganti link.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc } from '/js/core/format.js';
import { state } from './data.js';
import { photoUrl } from '/js/core/config.js';

let ctx;

const initials = (t) => {
  const w = String(t).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '?').slice(0, 2)).toUpperCase();
};

/** Potong tengah jadi persegi, perkecil ke 640×640, simpan sebagai JPEG. */
async function squareJpeg(file, size = 640) {
  let src;
  try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('This file is not a supported image')); i.src = URL.createObjectURL(file); });
  }
  const w = src.width, h = src.height, side = Math.min(w, h);
  const c = document.createElement('canvas'); c.width = c.height = Math.min(size, side);
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high';
  g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, c.width, c.height);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the image'))), 'image/jpeg', 0.86));
}

async function setPhoto(v, file) {
  const blob = await squareJpeg(file);
  const path = `${v.id}/${Date.now()}.jpg`; // nama baru tiap kali → tidak tertahan cache
  const up = await sb.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg', cacheControl: '31536000', upsert: false });
  if (up.error) throw up.error;
  const old = v.photo_path;
  const { error } = await sb.from('vocalists').update({ photo_path: path }).eq('id', v.id);
  if (error) { await sb.storage.from('photos').remove([path]); throw error; }
  v.photo_path = path;
  if (old) sb.storage.from('photos').remove([old]).catch(() => {});
}

export function render() {
  $('showPrices').checked = !!state.settings?.show_prices_public;
  $('vocSettings').innerHTML = state.vocalists.map((v) => `
    <div class="field vset" style="border-top:1px solid var(--line);padding-top:12px">
      <div class="vphoto">
        <div class="avatar lg">${v.photo_path ? `<img src="${esc(photoUrl(v.photo_path))}" alt="">` : esc(initials(v.display_name))}</div>
        <div class="vphoto-btns">
          <label class="btn sm">${v.photo_path ? 'Change photo' : 'Upload photo'}<input type="file" accept="image/*" data-photo="${v.id}" hidden></label>
          ${v.photo_path ? `<button class="sm" data-rmphoto="${v.id}">Remove</button>` : ''}
          <span class="hint">Shown as the cover in ${esc(v.display_name)}'s player</span>
        </div>
      </div>
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

  on($('vocSettings'), 'change', L, async (e) => {
    const id = e.target.dataset.photo; if (!id || !e.target.files?.[0]) return;
    const v = state.vocalists.find((x) => x.id === id);
    const file = e.target.files[0]; e.target.value = '';
    toast('Uploading photo…');
    try { await setPhoto(v, file); render(); toast(`Photo saved for ${v.display_name}`); }
    catch (err) { toast('Failed: ' + (err.message || err), 'bad'); }
  });

  on($('vocSettings'), 'click', L, async (e) => {
    const rm = e.target.dataset.rmphoto;
    if (rm) {
      const v = state.vocalists.find((x) => x.id === rm);
      if (!confirm(`Remove ${v.display_name}'s photo? The player will show initials instead.`)) return;
      const old = v.photo_path;
      const { error } = await sb.from('vocalists').update({ photo_path: null }).eq('id', v.id);
      if (error) return toast('Failed: ' + error.message, 'bad');
      v.photo_path = null; render();
      sb.storage.from('photos').remove([old]).catch(() => {});
      return toast('Photo removed');
    }
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
