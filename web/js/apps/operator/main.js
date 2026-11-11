// OPERATOR — halaman unduhan. Link: /fc/<kode>.
// Dua tampilan:
//   1. "New" (halaman pertama yang terbuka) — lagu yang baru dikirim vokalis dan belum diunduh.
//   2. Folder per vokalis — begitu operator mengunduh, lagu pindah sendiri ke folder nama vokalisnya
//      dan tetap bisa diunduh lagi dari situ.
// Tombol Download mengambil file lewat /dl/<kode>/<id> (server Cloudflare → Google Drive), jadi
// operator tidak perlu membuka Google Drive. Daftar diperbarui sendiri tiap 30 detik saat terlihat.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { installGlobalHandlers, report } from '/js/core/guard.js';
import { esc, fmtDate, timeAgo } from '/js/core/format.js';

installGlobalHandlers();

const token = location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('t') || '';
const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
const FOLDER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.2a1.5 1.5 0 0 1 1.1.48l1.2 1.3a1.5 1.5 0 0 0 1.1.47h6.4A1.5 1.5 0 0 1 20 9.75V17.5A1.5 1.5 0 0 1 18.5 19h-14A1.5 1.5 0 0 1 3 17.5Z"/></svg>';
const BACK_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

let songs = [];
let names = []; // semua vokalis → folder selalu tampil walau masih kosong
let view = 'new'; // 'new' | nama vokalis
let timer = null;

const mb = (b) => (b ? `${(b / 1048576).toFixed(0)} MB` : '');
const dateOf = (s) => (s.date ? fmtDate(s.date + 'T12:00:00+07:00') : '');
const isNew = (s) => !s.downloaded_at;
const fresh = () => songs.filter(isNew);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Folder = vokalis yang punya lagu sudah diunduh. Urut sesuai nama.
function folders() {
  const by = new Map(names.map((n) => [n, []]));
  for (const s of songs) {
    if (isNew(s)) continue;
    if (!by.has(s.vocalist)) by.set(s.vocalist, []);
    by.get(s.vocalist).push(s);
  }
  return [...by.entries()]
    .map(([name, list]) => ({
      name,
      list: list.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.title).localeCompare(String(b.title))),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function fail(title, sub) {
  $('app').classList.add('hidden');
  $('sub').textContent = '';
  $('msgTitle').textContent = title;
  $('msgSub').textContent = sub;
  $('msg').classList.remove('hidden');
}

function songRow(s) {
  return `
    <div class="row op-row ${isNew(s) ? 'is-new' : 'done'}" data-id="${esc(s.id)}">
      <div class="op-main">
        <div class="op-title">${esc(s.title)}${isNew(s) ? ' <span class="badge new">New</span>' : ''}</div>
        <div class="op-meta"><span class="op-voc">${esc(s.vocalist)}</span> · ${esc(dateOf(s))}${s.size ? ' · ' + mb(s.size) : ''}
          ${s.downloaded_at
            ? `<span class="op-done" title="${esc(fmtDate(s.downloaded_at))}">✓ Downloaded ${esc(timeAgo(s.downloaded_at))}</span>`
            : `<span class="op-sent">Sent ${esc(timeAgo(s.sent_at))}</span>`}</div>
      </div>
      <a class="btn op-dl ${isNew(s) ? 'hot' : ''}" href="/dl/${encodeURIComponent(token)}/${encodeURIComponent(s.id)}" download="${esc(s.file_name)}" data-dl="${esc(s.id)}">${DL_ICON}<span>Download</span></a>
    </div>`;
}

function renderNew() {
  const list = fresh();
  const fs = folders();
  $('sub').textContent = list.length
    ? `${plural(list.length, 'new song')} waiting`
    : 'No new songs right now';
  $('newCount').innerHTML = list.length ? `<span class="badge new">${list.length} new</span>` : '';
  $('allBtn').hidden = list.length < 2;
  $('back').innerHTML = '';

  const folderGrid = fs.length
    ? `<div class="op-folders">
        <div class="op-sec">Folders</div>
        <div class="op-fgrid">${fs.map((f) => `
          <button class="op-folder" data-folder="${esc(f.name)}">
            <span class="op-ficon">${FOLDER_ICON}</span>
            <span class="op-fname">${esc(f.name)}</span>
            <span class="op-fcount">${f.list.length ? plural(f.list.length, 'song') : 'Empty'}</span>
          </button>`).join('')}</div>
      </div>`
    : '';

  $('list').innerHTML = list.length
    ? list.map(songRow).join('')
    : `<div class="empty">All caught up — nothing new to download.<br><span class="op-hint">When a vocalist presses Send, the song shows up here.</span></div>`;
  $('folders').innerHTML = folderGrid;
}

function renderFolder(name) {
  const f = folders().find((x) => x.name === name);
  if (!f) { view = 'new'; return renderNew(); }
  $('sub').textContent = `${plural(f.list.length, 'song')} in this folder`;
  $('newCount').innerHTML = '';
  $('allBtn').hidden = true;
  $('back').innerHTML = `<button class="btn op-back" data-back>${BACK_ICON}<span>All new songs</span></button>
    <span class="op-crumb">${FOLDER_ICON}<b>${esc(f.name)}</b></span>`;
  $('list').innerHTML = f.list.length
    ? f.list.map(songRow).join('')
    : `<div class="empty">This folder is empty.<br><span class="op-hint">Songs from ${esc(f.name)} land here after you download them.</span></div>`;
  $('folders').innerHTML = '';
}

function render() {
  if (view !== 'new' && !folders().some((f) => f.name === view)) view = 'new';
  if (view === 'new') renderNew(); else renderFolder(view);
}

async function load(first) {
  const res = await Promise.resolve().then(() => sb.rpc('get_operator_report', { p_token: token })).catch((e) => ({ error: e }));
  if (res.error) {
    report('operator:load', res.error);
    if (first) fail('Could not load', 'Connection problem. Please reload the page in a moment.');
    return;
  }
  if (!res.data) return fail('Link not found', 'This link is wrong or has been replaced. Ask the studio for the latest link.');
  songs = res.data.songs || [];
  names = res.data.vocalists || [];
  $('msg').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!document.hidden) await load(false); schedule(); }, 30000);
}

// Setelah diunduh, lagu langsung pindah ke folder vokalisnya.
function markDownloaded(id) {
  const s = songs.find((x) => x.id === id);
  if (s && !s.downloaded_at) {
    s.downloaded_at = new Date().toISOString();
    render();
    if (view === 'new') toast(`Moved to ${s.vocalist}`);
  }
  setTimeout(() => load(false), 4000);
}

function start() {
  if (!token) return fail('Link not found', 'This link is incomplete. Ask the studio for the latest link.');
  document.addEventListener('click', (e) => {
    const dl = e.target.closest('[data-dl]');
    if (dl) { toast('Download started'); markDownloaded(dl.dataset.dl); return; }
    const f = e.target.closest('[data-folder]');
    if (f) { view = f.dataset.folder; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
    if (e.target.closest('[data-back]')) { view = 'new'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  });
  $('allBtn').addEventListener('click', async () => {
    const list = fresh();
    toast(`Downloading ${list.length} songs…`);
    for (const s of list) {
      const a = document.createElement('a');
      a.href = `/dl/${encodeURIComponent(token)}/${encodeURIComponent(s.id)}`;
      a.download = s.file_name || '';
      document.body.appendChild(a); a.click(); a.remove();
      s.downloaded_at = new Date().toISOString();
      await new Promise((r) => setTimeout(r, 1500)); // jeda supaya browser tidak menolak unduhan beruntun
    }
    render();
    setTimeout(() => load(false), 4000);
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false); });
  load(true).then(schedule);
}

start();
