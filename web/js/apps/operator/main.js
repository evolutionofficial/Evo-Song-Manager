// OPERATOR FC — halaman unduhan. Link: /fc/<kode>.
// Dua tampilan:
//  • New     — laporan lagu yang baru masuk (vokalis menekan Send to FC) dan belum di-download.
//  • Folders — satu folder per vokalis. Begitu sebuah lagu di-download, lagu itu pindah dari New
//              ke folder vokalis pemiliknya.
// Tombol Download mengambil file lewat /dl/<kode>/<id> (server Cloudflare → Google Drive), jadi operator
// tidak perlu membuka Google Drive. Daftar diperbarui sendiri tiap 30 detik saat halaman terlihat.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { installGlobalHandlers, report } from '/js/core/guard.js';
import { esc, fmtDate, timeAgo } from '/js/core/format.js';

installGlobalHandlers();

const token = location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('t') || '';
const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
const FOLDER_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
let songs = [];
let timer = null;
let tab = 'new';
const openFolders = new Set(); // folder yang sedang dibuka (tetap terbuka saat daftar dimuat ulang)

const mb = (b) => (b ? `${(b / 1048576).toFixed(0)} MB` : '');
const dateOf = (s) => (s.date ? fmtDate(s.date + 'T12:00:00+07:00') : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

function fail(title, sub) {
  $('app').classList.add('hidden');
  $('sub').textContent = '';
  $('msgTitle').textContent = title;
  $('msgSub').textContent = sub;
  $('msg').classList.remove('hidden');
}

function rowHtml(s) {
  return `
      <div class="row op-row ${s.downloaded_at ? 'done' : 'is-new'}" data-id="${esc(s.id)}">
        <div class="op-main">
          <div class="op-title">${esc(s.title)} ${s.downloaded_at ? '' : '<span class="badge new">New</span>'}</div>
          <div class="op-meta"><span class="op-voc">${esc(s.vocalist)}</span> · ${esc(dateOf(s))}${s.size ? ' · ' + mb(s.size) : ''}
            ${s.downloaded_at ? `<span class="op-done" title="${esc(fmtDate(s.downloaded_at))}">✓ Downloaded ${esc(timeAgo(s.downloaded_at))}</span>` : `<span class="op-sent">Sent ${esc(timeAgo(s.sent_at))}</span>`}</div>
        </div>
        <a class="btn op-dl ${s.downloaded_at ? '' : 'hot'}" href="/dl/${encodeURIComponent(token)}/${encodeURIComponent(s.id)}" download="${esc(s.file_name)}" data-dl="${esc(s.id)}">${DL_ICON}<span>Download</span></a>
      </div>`;
}

// Laporan ringkas: "3 new songs · Jeffry 2, Ana 1".
function newReport(fresh) {
  if (!fresh.length) return '';
  const by = new Map();
  fresh.forEach((s) => by.set(s.vocalist, (by.get(s.vocalist) || 0) + 1));
  const parts = [...by].map(([v, n]) => `${esc(v)} ${n}`).join(', ');
  return `<b>${plural(fresh.length, 'new song')}</b> · ${parts}`;
}

function renderNew(fresh) {
  $('newReport').innerHTML = newReport(fresh);
  $('allBtn').hidden = fresh.length < 2;
  $('list').innerHTML = fresh.length
    ? fresh.map(rowHtml).join('')
    : `<div class="empty">No new songs right now.<br><span class="op-hint">When a vocalist sends a song, it shows up here.</span></div>`;
}

function renderFolders(done) {
  // Satu folder per vokalis yang pernah mengirim lagu (folder tetap ada walau masih kosong).
  const byVoc = new Map();
  songs.forEach((s) => { if (!byVoc.has(s.vocalist)) byVoc.set(s.vocalist, []); });
  done.forEach((s) => byVoc.get(s.vocalist).push(s));
  const names = [...byVoc.keys()].sort((a, b) => a.localeCompare(b));
  $('folders').innerHTML = names.length
    ? names.map((name) => {
        const items = byVoc.get(name).sort((a, b) => String(b.downloaded_at).localeCompare(String(a.downloaded_at)));
        return `
      <details class="table op-folder" data-voc="${esc(name)}" ${openFolders.has(name) ? 'open' : ''}>
        <summary class="op-folder-h">
          <span class="op-folder-ico">${FOLDER_ICON}</span>
          <span class="op-folder-name">${esc(name)}</span>
          <span class="badge muted">${items.length}</span>
          <span class="op-folder-chev" aria-hidden="true">›</span>
        </summary>
        ${items.length ? items.map(rowHtml).join('') : '<div class="empty op-folder-empty">Empty — downloaded songs will appear here.</div>'}
      </details>`;
      }).join('')
    : `<div class="empty">No folders yet.<br><span class="op-hint">A folder is created for each vocalist who sends a song.</span></div>`;
}

function render() {
  const fresh = songs.filter((s) => !s.downloaded_at);
  const done = songs.filter((s) => s.downloaded_at);
  $('sub').textContent = songs.length ? `${fresh.length} new · ${plural(done.length, 'song')} in folders` : 'No songs yet';
  $('newCount').innerHTML = fresh.length ? `<span class="badge new">${fresh.length}</span>` : '';
  document.querySelectorAll('#tabs .tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  $('paneNew').hidden = tab !== 'new';
  $('paneFolders').hidden = tab !== 'folders';
  renderNew(fresh);
  renderFolders(done);
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
  $('msg').classList.add('hidden');
  $('app').classList.remove('hidden');
  render();
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(async () => { if (!document.hidden) await load(false); schedule(); }, 30000);
}

function markDownloaded(id) {
  const s = songs.find((x) => x.id === id);
  if (s && !s.downloaded_at) {
    s.downloaded_at = new Date().toISOString();
    render();
    toast(`Moved to ${s.vocalist}'s folder`);
  }
  // Lagu lama vokalis yang sama mungkin baru saja dibersihkan → muat ulang sebentar lagi.
  setTimeout(() => load(false), 4000);
}

function start() {
  if (!token) return fail('Link not found', 'This link is incomplete. Ask the studio for the latest link.');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-dl]');
    if (a) { toast('Download started'); markDownloaded(a.dataset.dl); return; }
    const t = e.target.closest('#tabs .tab');
    if (t) { tab = t.dataset.tab; render(); }
  });
  // Ingat folder mana yang dibuka supaya tidak menutup sendiri saat daftar dimuat ulang.
  document.addEventListener('toggle', (e) => {
    const d = e.target;
    if (!d.classList || !d.classList.contains('op-folder')) return;
    if (d.open) openFolders.add(d.dataset.voc); else openFolders.delete(d.dataset.voc);
  }, true);
  $('allBtn').addEventListener('click', async () => {
    const fresh = songs.filter((s) => !s.downloaded_at);
    toast(`Downloading ${fresh.length} songs…`);
    for (const s of fresh) {
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
