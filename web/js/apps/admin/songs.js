// ADMIN — modul Tabel lagu & harga: ringkasan, link vokalis, harga (pilihan + custom), Paid,
// menu klik kanan / tekan lama di judul (Ganti revisi, Hapus).
// "Ganti revisi" diteruskan ke modul revisi lewat ctx.openReplace().
import { PRICES } from '/js/core/config.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { ribu, esc, norm, dateLabel, summarize, fmtDate } from '/js/core/format.js';
import { state, curVoc, vocSongs, shareUrl, updateSong } from './data.js';

let ctx;

export function render() {
  const v = curVoc(); if (!v) return;
  const songs = vocSongs();
  const sum = summarize(songs);
  $('vName').textContent = v.display_name;
  $('vSub').textContent = `${songs.length} lagu · ${sum.priced} sudah diberi harga` + (v.active ? '' : ' · folder tidak ditemukan di PC');
  $('vLink').value = shareUrl(v);
  $('openLink').href = shareUrl(v);
  renderTable();
}

function renderTable() {
  if (state.errors.songs) { $('table').innerHTML = `<div class="empty">Data lagu gagal dimuat. Tekan Muat ulang.</div>`; return; }
  const q = norm($('q').value.trim());
  const st = $('status').value;
  const all = vocSongs().map((s, i) => ({ ...s, n: i + 1 }));
  const rows = all.filter((s) => (!q || norm(s.title).includes(q)) &&
    (!st || (st === 'paid' ? s.paid : st === 'unpaid' ? !s.paid : !s.price)));
  if (!all.length) { $('table').innerHTML = `<div class="empty">Belum ada lagu untuk vokalis ini.</div>`; return; }
  if (!rows.length) { $('table').innerHTML = `<div class="empty">Tidak ada lagu yang cocok.</div>`; return; }
  const sum = summarize(rows);
  $('table').innerHTML =
    `<div class="row head cols-admin"><span>No</span><span>Tanggal</span><span>Judul</span><span>Harga</span><span>Status</span></div>` +
    rows.map((s) => `<div class="row cols-admin ${s.paid ? 'paid' : ''}" data-id="${s.id}">
      <span class="no dim">${s.n}</span>
      <span class="date dim" title="${esc(s.rel_path)}">${esc(dateLabel(s))}</span>
      <span class="title dim" data-menu="${s.id}" title="${esc(s.file_name)}">${esc(s.title)}${s.revision ? ` <span class="badge muted" title="Diganti ${esc(fmtDate(s.replaced_at))} · file: ${esc(s.file_name)}">revisi ${s.revision}</span>` : ''}${s.missing ? ' <span class="badge bad" title="File sudah tidak ada di PC; lagu tetap tersimpan sebagai riwayat">file tidak ada di PC</span>' : ''}</span>
      ${s.paid
        ? `<span class="price dim paid-price" title="Harga tersimpan: ${ribu(s.price)} (muncul lagi kalau status Lunas dibatalkan)">—</span>`
        : `<span class="price"><select data-price="${s.id}" aria-label="Harga ${esc(s.title)}">
        <option value="">—</option>
        ${PRICES.concat(s.price && !PRICES.includes(s.price) ? [s.price] : []).map((p) => `<option value="${p}" ${s.price === p ? 'selected' : ''}>${ribu(p)}</option>`).join('')}
        <option value="custom">Custom…</option>
      </select></span>`}
      <span class="act"><button class="paidbtn ${s.paid ? 'on' : ''}" data-paid="${s.id}" aria-pressed="${s.paid}">${s.paid ? '✓ Lunas' : 'Paid'}</button></span>
    </div>`).join('') +
    `<div class="row foot cols-admin"><span class="no"></span><span class="date"></span><span class="title" style="text-align:right">Belum dibayar${q || st ? ' (tersaring)' : ''}</span><span class="price">${ribu(sum.rest)}</span><span class="act"></span></div>`;
}

export function resetFilters() {
  $('q').value = '';
  $('status').value = '';
}

/** "85000", "85.000", "85rb", "85k", "85" → 85000. Kosong/tidak valid → NaN. */
export function parsePrice(str) {
  const t = String(str).toLowerCase().replace(/\s/g, '');
  if (!t) return NaN;
  const k = /(rb|ribu|k)$/.test(t);
  const n = Number(t.replace(/(rb|ribu|k)$/, '').replace(/[.,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) return NaN;
  return Math.round(k || n < 1000 ? n * 1000 : n);
}

async function savePrice(id, price) {
  if (await updateSong(id, { price }, ctx.renderAll)) toast('Harga disimpan');
}

// Ganti dropdown dengan kolom ketik nominal. Enter/keluar = simpan, Esc = batal.
function startCustom(sel, id) {
  const s = state.songs.find((x) => x.id === id);
  const cell = sel.parentElement;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'numeric'; inp.className = 'price-input';
  inp.placeholder = 'mis. 85.000'; inp.setAttribute('aria-label', 'Harga custom ' + s.title);
  inp.value = s.price && !PRICES.includes(s.price) ? String(s.price) : '';
  cell.replaceChildren(inp);
  inp.focus();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    if (!save || !inp.value.trim()) return ctx.renderAll();
    const p = parsePrice(inp.value);
    if (!p) { toast('Nominal tidak valid', 'bad'); return ctx.renderAll(); }
    savePrice(id, p);
  };
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') finish(false);
  });
  inp.addEventListener('blur', () => finish(true));
}

// ---------- Menu klik kanan / tekan lama ----------
let menuEl = null;
function closeMenu() { menuEl?.remove(); menuEl = null; }

function openMenu(id, x, y) {
  closeMenu();
  const s = state.songs.find((t) => t.id === id); if (!s) return;
  menuEl = document.createElement('div');
  menuEl.className = 'ctxmenu'; menuEl.setAttribute('role', 'menu');
  menuEl.innerHTML = `<div class="ctx-title">${esc(s.title)}</div>
    <button role="menuitem" data-act="rep">Ganti revisi…</button>
    <button role="menuitem" data-act="del" class="danger">Hapus dari daftar</button>`;
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  on(menuEl, 'click', 'Menu lagu', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    closeMenu();
    if (act === 'rep') ctx.openReplace(id);
    if (act === 'del') deleteSong(id);
  });
  menuEl.querySelector('button').focus();
}

async function deleteSong(id) {
  const s = state.songs.find((x) => x.id === id);
  const extra = s.paid ? `\n\nLagu ini sudah LUNAS (${ribu(s.price)}). Kalau dihapus, nilainya tidak dihitung lagi di invoice.` : '';
  if (!confirm(`Hapus "${s.title}" dari daftar?\n\nLagu ini hilang dari halaman vokalis dan tidak dimasukkan lagi oleh sync. Bisa dikembalikan dari bagian "Terhapus".${extra}`)) return;
  if (await updateSong(id, { deleted: true }, ctx.renderAll)) toast('Lagu dihapus dari daftar');
}

export function init(c) {
  ctx = c;
  const L = 'Tabel lagu';

  on($('q'), 'input', L, renderTable);
  on($('status'), 'change', L, renderTable);

  on($('table'), 'change', L, (e) => {
    const id = e.target.dataset.price; if (!id) return;
    if (e.target.value === 'custom') return startCustom(e.target, id);
    savePrice(id, e.target.value ? Number(e.target.value) : null);
  });

  on($('table'), 'click', L, async (e) => {
    const pid = e.target.closest('[data-paid]')?.dataset.paid;
    if (!pid) return;
    const s = state.songs.find((x) => x.id === pid);
    if (!s.paid && !s.price) { toast('Isi harga dulu sebelum menandai lunas', 'bad'); return; }
    if (await updateSong(pid, { paid: !s.paid }, ctx.renderAll)) toast(s.paid ? 'Ditandai lunas' : 'Status lunas dibatalkan');
  });

  // Klik kanan (desktop)
  on($('table'), 'contextmenu', L, (e) => {
    const t = e.target.closest('[data-menu]'); if (!t) return;
    e.preventDefault();
    openMenu(t.dataset.menu, e.clientX, e.clientY);
  });
  // Tekan lama (HP)
  let lp = null;
  const cancelLp = () => { clearTimeout(lp?.timer); lp = null; };
  on($('table'), 'touchstart', L, (e) => {
    const t = e.target.closest('[data-menu]'); if (!t) return;
    const p = e.touches[0];
    lp = { x: p.clientX, y: p.clientY, timer: setTimeout(() => { navigator.vibrate?.(15); openMenu(t.dataset.menu, lp.x, lp.y); lp = null; }, 550) };
  });
  on($('table'), 'touchmove', L, (e) => {
    if (!lp) return;
    const p = e.touches[0];
    if (Math.abs(p.clientX - lp.x) > 10 || Math.abs(p.clientY - lp.y) > 10) cancelLp();
  });
  on($('table'), 'touchend', L, cancelLp);
  on($('table'), 'touchcancel', L, cancelLp);
  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, { passive: true });

  on($('copyLink'), 'click', L, async () => {
    try { await navigator.clipboard.writeText($('vLink').value); toast('Link disalin'); }
    catch { $('vLink').select(); toast('Tekan Ctrl+C untuk menyalin'); }
  });
}
