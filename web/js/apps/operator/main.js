// OPERATOR FC — halaman unduhan. Link: /fc/<kode>.
// Daftar lagu yang sudah dikirim vokalis (Send to FC) dan masih tersimpan. Tombol Download
// mengambil file lewat /dl/<kode>/<id> (server Cloudflare → Google Drive), jadi operator tidak
// perlu membuka Google Drive. Daftar diperbarui sendiri tiap 30 detik saat halaman terlihat.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { installGlobalHandlers, report } from '/js/core/guard.js';
import { esc, fmtDate, timeAgo } from '/js/core/format.js';

installGlobalHandlers();

const token = location.pathname.split('/').filter(Boolean)[1] || new URLSearchParams(location.search).get('t') || '';
const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';
let songs = [];
let timer = null;

const mb = (b) => (b ? `${(b / 1048576).toFixed(0)} MB` : '');
const dateOf = (s) => (s.date ? fmtDate(s.date + 'T12:00:00+07:00') : '');

function fail(title, sub) {
  $('app').classList.add('hidden');
  $('sub').textContent = '';
  $('msgTitle').textContent = title;
  $('msgSub').textContent = sub;
  $('msg').classList.remove('hidden');
}

function render() {
  const fresh = songs.filter((s) => !s.downloaded_at);
  $('sub').textContent = songs.length ? `${songs.length} song${songs.length > 1 ? 's' : ''} ready` : 'No songs yet';
  $('newCount').innerHTML = fresh.length ? `<span class="badge new">${fresh.length} new</span>` : '';
  $('allBtn').hidden = fresh.length < 2;
  $('list').innerHTML = songs.length
    ? songs.map((s) => `
      <div class="row op-row ${s.downloaded_at ? 'done' : 'is-new'}" data-id="${esc(s.id)}">
        <div class="op-main">
          <div class="op-title">${esc(s.title)} ${s.downloaded_at ? '' : '<span class="badge new">New</span>'}</div>
          <div class="op-meta"><span class="op-voc">${esc(s.vocalist)}</span> · ${esc(dateOf(s))}${s.size ? ' · ' + mb(s.size) : ''}
            ${s.downloaded_at ? `<span class="op-done" title="${esc(fmtDate(s.downloaded_at))}">✓ Downloaded ${esc(timeAgo(s.downloaded_at))}</span>` : `<span class="op-sent">Sent ${esc(timeAgo(s.sent_at))}</span>`}</div>
        </div>
        <a class="btn op-dl ${s.downloaded_at ? '' : 'hot'}" href="/dl/${encodeURIComponent(token)}/${encodeURIComponent(s.id)}" download="${esc(s.file_name)}" data-dl="${esc(s.id)}">${DL_ICON}<span>Download</span></a>
      </div>`).join('')
    : `<div class="empty">No songs to download right now.<br><span class="op-hint">When a vocalist sends a song, it shows up here.</span></div>`;
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
  if (s && !s.downloaded_at) { s.downloaded_at = new Date().toISOString(); render(); }
  // Lagu lama vokalis yang sama mungkin baru saja dibersihkan → muat ulang sebentar lagi.
  setTimeout(() => load(false), 4000);
}

function start() {
  if (!token) return fail('Link not found', 'This link is incomplete. Ask the studio for the latest link.');
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-dl]');
    if (a) { toast('Download started'); markDownloaded(a.dataset.dl); }
  });
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
