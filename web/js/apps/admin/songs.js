// ADMIN — modul Tabel lagu & harga: ringkasan, link vokalis, harga (pilihan + custom), Paid,
// tombol ▶ (memutar lewat modul playback.js), menu klik kanan / tekan lama di judul (Ganti revisi, Hapus).
// "Ganti revisi" diteruskan ke modul revisi lewat ctx.openReplace().
import { sb } from '/js/core/supabase.js';
import { PRICES } from '/js/core/config.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { rupiah, ribu, esc, norm, dateLabel, summarize, fmtDate } from '/js/core/format.js';
import { state, curVoc, vocSongs, shareUrl, updateSong, wavOf } from './data.js';

let ctx;

export function render() {
  const v = curVoc(); if (!v) return;
  const songs = vocSongs();
  const sum = summarize(songs);
  $('vName').textContent = v.display_name;
  $('vSub').textContent = `${songs.length} songs · ${sum.priced} priced` + (v.active ? '' : ' · folder not found on PC');
  $('vLink').value = shareUrl(v);
  $('openLink').href = shareUrl(v);
  renderTable();
}

function renderTable() {
  if (state.errors.songs) { $('table').innerHTML = `<div class="empty">Song data failed to load. Press Reload.</div>`; return; }
  const q = norm($('q').value.trim());
  const st = $('status').value;
  // Nomor = urutan dibuat (1 = paling lama); tampil terbaru di atas.
  const all = vocSongs().map((s, i) => ({ ...s, n: i + 1 })).reverse();
  showDue($('due'), summarize(all).rest);
  const rows = all.filter((s) => (!q || norm(s.title).includes(q)) &&
    (!st || (st === 'paid' ? s.paid : st === 'unpaid' ? !s.paid && s.price !== 0 : s.price == null && !s.paid)));
  if (!all.length) { $('table').innerHTML = `<div class="empty">No songs for this vocalist yet.</div>`; return; }
  if (!rows.length) { $('table').innerHTML = `<div class="empty">No matching songs.</div>`; return; }
  $('table').innerHTML =
    `<div class="row head cols-admin"><span>#</span><span>Date</span><span>Title</span><span>Price</span><span>Status</span></div>` +
    rows.map((s) => `<div class="row cols-admin ${s.paid ? 'paid' : ''}${s.id === state.playingId ? ' playing' : ''}" data-id="${s.id}">
      <span class="no dim">${s.n}</span>
      <span class="date dim" title="${esc(s.rel_path)}">${esc(dateLabel(s))}</span>
      <span class="title dim" data-menu="${s.id}" title="${esc(s.file_name)}">${esc(s.title)}${s.revision ? ` <span class="badge muted" title="Replaced ${esc(fmtDate(s.replaced_at))} · file: ${esc(s.file_name)}">revision ${s.revision}</span>` : ''}${s.source && s.source !== 'pc' ? ` <span class="badge muted src" title="From ${esc(s.source === 'backup' ? 'the backup drive' : s.source === 'mac' ? 'the MacBook' : s.source)}">${esc(s.source === 'backup' ? 'Backup' : s.source === 'mac' ? 'MacBook' : s.source)}</span>` : ''}${s.accepted_at ? wavBadge(s) : ''}${s.accepted_at ? ` <span class="badge acc" title="Accepted by the vocalist on ${esc(fmtDate(s.accepted_at))} — locked, no more revisions">✓ Accepted</span>` : ''}${!s.accepted_at && s.revision_requested_at ? ` <span class="badge rev" title="Requested by the vocalist on ${esc(fmtDate(s.revision_requested_at))}">Revision requested</span>` : ''}${!s.accepted_at && s.revision_requested_at && s.revision_note ? `<span class="revnote">“${esc(s.revision_note)}”</span>` : ''}${s.missing ? ' <span class="badge bad" title="The file is no longer on the PC; the song is kept as history">file missing on PC</span>' : ''}</span>
      ${s.paid
        ? `<span class="price dim paid-price" title="Saved price: ${ribu(s.price)} (shows again if Paid is undone)">—</span>`
        : `<span class="price"><select data-price="${s.id}" aria-label="Price ${esc(s.title)}">
        <option value="">—</option>
        <option value="0" ${s.price === 0 ? 'selected' : ''}>Free/Revision</option>
        ${PRICES.concat(s.price && !PRICES.includes(s.price) ? [s.price] : []).map((p) => `<option value="${p}" ${s.price === p ? 'selected' : ''}>${ribu(p)}</option>`).join('')}
        <option value="custom">Custom…</option>
      </select></span>`}
      <span class="act">${playButton(s)}${s.price === 0 && !s.paid
        ? '<span class="badge muted freebadge">Free</span>'
        : `<button class="paidbtn ${s.paid ? 'on' : ''}" data-paid="${s.id}" aria-pressed="${s.paid}">${s.paid ? '✓ Paid' : 'Mark paid'}</button>`}</span>
    </div>`).join('');
}

/** Tombol ▶ seperti di halaman vokalis; redup kalau lagu belum punya audio. */
function playButton(s) {
  const ok = ctx.canPlay(s);
  const tip = ok ? 'Play' : (s.revision_requested_at ? 'Being revised — no audio right now' : 'No audio yet');
  // Dua ikon ikut tercetak; CSS memilih mana yang tampak, memakai kelas .playing di baris
  // (dipasang playback.js) dan .is-playing di <body> (dipasang pemutar vokalis yang dipakai
  // ulang di sini). Aturan CSS-nya sama persis dengan yang dipakai daftar lagu vokalis.
  return `<button type="button" class="btn playbtn${ok ? '' : ' noaudio'}" data-aplay="${s.id}" aria-label="Play ${esc(s.title)}" title="${esc(tip)}"><span class="ico-play" aria-hidden="true">▶</span><span class="ico-pause" aria-hidden="true">❚❚</span></button>`;
}

/** Total "Belum dibayar" di samping filter; disembunyikan kalau semua sudah lunas. */
export function showDue(el, amount) {
  el.hidden = !amount;
  el.querySelector('.due-v').textContent = rupiah(amount);
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
  if (await updateSong(id, { price }, ctx.renderAll)) toast('Price saved');
}

// Ganti dropdown dengan kolom ketik nominal. Enter/keluar = simpan, Esc = batal.
function startCustom(sel, id) {
  const s = state.songs.find((x) => x.id === id);
  const cell = sel.parentElement;
  const inp = document.createElement('input');
  inp.type = 'text'; inp.inputMode = 'numeric'; inp.className = 'price-input';
  inp.placeholder = 'e.g. 85.000'; inp.setAttribute('aria-label', 'Custom price ' + s.title);
  inp.value = s.price && !PRICES.includes(s.price) ? String(s.price) : '';
  cell.replaceChildren(inp);
  inp.focus();
  let done = false;
  const finish = (save) => {
    if (done) return; done = true;
    if (!save || !inp.value.trim()) return ctx.renderAll();
    const p = parsePrice(inp.value);
    if (!p) { toast('Invalid amount', 'bad'); return ctx.renderAll(); }
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
  menuEl.innerHTML = `<div class="ctx-title">${esc(s.title)}${s.accepted_at ? ' · accepted' : ''}</div>
    ${s.accepted_at
      ? `<button role="menuitem" data-act="rep" disabled title="Accepted by the vocalist — unlock first">Replace with revision… (locked)</button>
         <button role="menuitem" data-act="unlock">Unlock (undo Accept)</button>`
      : '<button role="menuitem" data-act="rep">Replace with revision…</button>'}
    ${['failed', 'needs_admin'].includes(wavOf(s)?.status) ? '<button role="menuitem" data-act="retry">Retry WAV upload</button>' : ''}
    <button role="menuitem" data-act="del" class="danger">Remove from list</button>`;
  document.body.appendChild(menuEl);
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  on(menuEl, 'click', 'Song menu', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; if (!act) return;
    closeMenu();
    if (act === 'rep') ctx.openReplace(id);
    if (act === 'del') deleteSong(id);
    if (act === 'unlock') unlockSong(id);
    if (act === 'retry') retryWav(id);
  });
  menuEl.querySelector('button').focus();
}

function wavBadge(s) {
  const w = wavOf(s);
  if (!w) return '';
  const mb = w.size_bytes ? ` · ${(w.size_bytes / 1048576).toFixed(1)} MB` : '';
  const map = {
    waiting: ['warn', 'WAV waiting', 'Waiting for the studio computer that has this WAV to upload it to Google Drive'],
    uploading: ['warn', 'WAV uploading…', 'Uploading to Google Drive'],
    complete: ['wav ok', 'On Drive', `WAV uploaded to Google Drive ${fmtDate(w.uploaded_at)}${mb}`],
    failed: w.attempts >= 8
      ? ['bad', 'WAV failed — stopped', `Upload failed ${w.attempts} times and stopped: ${w.last_error || ''}. Right-click the title → Retry WAV upload.`]
      : ['bad', 'WAV failed', `Upload failed (try ${w.attempts}), retrying automatically: ${w.last_error || ''}`],
    needs_admin: ['bad', 'WAV needs you', `The WAV on the computer no longer matches the version the vocalist accepted: ${w.last_error || ''} Right-click the title → Retry WAV upload once the right file is in place.`],
    cancelled: ['muted', 'WAV cancelled', 'Cancelled by Revision / Unlock'],
  };
  if (w.status === 'complete' && (w.drive_deleted_at || w.cleanup_eligible_at)) {
    map.complete = ['muted', 'Cleaned from Drive', 'Removed from Google Drive (limit of 40 files per vocalist). The WAV on the computer is kept.'];
  } else if (w.status === 'complete' && w.downloaded_at) {
    map.complete = ['wav ok', 'Downloaded by FC', `FC downloaded it ${fmtDate(w.downloaded_at)}${mb}`];
  } else if (w.status === 'complete' && w.sent_at) {
    map.complete = ['warn', 'Sent to FC', `Sent by the vocalist ${fmtDate(w.sent_at)} — waiting for FC to download`];
  }
  const [cls, label, tip] = map[w.status] || ['muted', w.status, ''];
  return ` <span class="badge ${cls}" title="${esc(tip)}">${esc(label)}</span>`;
}

async function retryWav(id) {
  const { error } = await sb.rpc('retry_wav', { p_song: id });
  if (error) return toast('Failed: ' + error.message, 'bad');
  toast('WAV upload queued again');
  ctx.reload();
}

async function unlockSong(id) {
  const s = state.songs.find((x) => x.id === id);
  if (!confirm(`Unlock "${s.title}"?\n\nThe vocalist's Accept is undone, so you can replace it with a revision again. The vocalist will need to Accept it again before sending it to FC.`)) return;
  const { error } = await sb.rpc('unlock_song', { p_song: id });
  if (error) return toast('Failed: ' + error.message, 'bad');
  s.accepted_at = null;
  ctx.renderAll();
  toast('Song unlocked');
}

async function deleteSong(id) {
  const s = state.songs.find((x) => x.id === id);
  const extra = s.paid ? `\n\nThis song is already PAID (${ribu(s.price)}). If removed, it no longer counts on the invoice.` : '';
  if (!confirm(`Remove "${s.title}" from the list?\n\nIt disappears from the vocalist page and won't be re-added by sync. You can restore it from "Deleted".${extra}`)) return;
  if (await updateSong(id, { deleted: true }, ctx.renderAll)) toast('Song removed from list');
}

export function init(c) {
  ctx = c;
  const L = 'Song table';

  on($('q'), 'input', L, renderTable);
  on($('status'), 'change', L, renderTable);

  on($('table'), 'change', L, (e) => {
    const id = e.target.dataset.price; if (!id) return;
    if (e.target.value === 'custom') return startCustom(e.target, id);
    savePrice(id, e.target.value ? Number(e.target.value) : null);
  });

  on($('table'), 'click', L, async (e) => {
    const ap = e.target.closest('[data-aplay]');
    if (ap) return ctx.play(ap.dataset.aplay);
    const pid = e.target.closest('[data-paid]')?.dataset.paid;
    if (!pid) return;
    const s = state.songs.find((x) => x.id === pid);
    if (!s.paid && s.price == null) { toast('Set a price before marking as paid', 'bad'); return; }
    if (await updateSong(pid, { paid: !s.paid }, ctx.renderAll)) toast(s.paid ? 'Marked as paid' : 'Paid status removed');
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
    try { await navigator.clipboard.writeText($('vLink').value); toast('Link copied'); }
    catch { $('vLink').select(); toast('Press Ctrl+C to copy'); }
  });
}
