// ADMIN — modul Orders: link YouTube yang dipesan vokalis, satu halaman, dikelompokkan per vokalis.
// Accept memasukkan order ke antrean; PC (program agen) membuat folder
// D:\FIRST CLUB\<vokalis>\<tanggal> dan mengunduh mp3-nya. Gagal 3 kali: tombol Try again
// berubah jadi Copy link supaya bisa diunduh manual di web.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, timeAgo } from '/js/core/format.js';
import { state } from './data.js';

let ctx;
let orders = [];
export const MAX_TRIES = 3;

export const waitingCount = () => orders.filter((o) => o.status === 'waiting').length;

const STATUS = {
  accepted: ['Waiting for PC', 'warn'],
  downloading: ['Downloading', ''],
  done: ['Done', 'ok'],
  failed: ['Failed', 'bad'],
  rejected: ['Rejected', 'muted'],
};

async function load() {
  const { data, error } = await sb.from('song_orders').select('*').order('created_at', { ascending: false });
  if (error) { $('ordAdmin').innerHTML = `<div class="table"><div class="empty">Could not load orders.</div></div>`; return false; }
  orders = data || [];
  return true;
}

function actions(o) {
  if (o.status === 'waiting') return `<button class="primary" data-ord-accept="${o.id}">Accept</button><button data-ord-reject="${o.id}">Reject</button>`;
  if (o.status === 'downloading') return '';
  if (o.status === 'failed') {
    const main = o.fail_count >= MAX_TRIES
      ? `<button class="primary" data-ord-copy="${o.id}">Copy link</button>`
      : `<button data-ord-retry="${o.id}">Try again</button>`;
    return `${main}<button class="ghost" data-ord-reject="${o.id}">Reject</button>`;
  }
  return '';
}

function status(o) {
  if (o.status === 'downloading') return `<span class="badge">Downloading ${o.progress ?? 0}%</span>`;
  if (o.status === 'done') return `<span class="badge ok">Done${o.result?.file ? ' · 1 file' : ''}</span>`;
  const [t, c] = STATUS[o.status] || [o.status, ''];
  const tries = o.status === 'failed' ? ` <span class="ord-when">${o.fail_count}/${MAX_TRIES}</span>` : '';
  return `<span class="badge ${c}">${t}</span>${tries}`;
}

function rowHtml(o) {
  const err = o.status === 'failed' && o.last_error ? `<span class="ord-err">${esc(o.last_error)}${o.fail_count >= MAX_TRIES ? ' — download it manually with the copied link.' : ''}</span>` : '';
  return `<div class="ord-row">
    <a class="ord-url" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">${esc(o.url.replace(/^https?:\/\/(www\.)?/, ''))}</a>
    <span class="ord-when">${esc(timeAgo(o.created_at))}</span>
    ${status(o)}${actions(o)}${err}
  </div>`;
}

function draw() {
  const el = $('ordAdmin');
  const list = orders.filter((o) => o.status !== 'rejected');
  if (!list.length) { el.innerHTML = `<div class="table"><div class="empty">No orders.</div></div>`; return; }
  const groups = state.vocalists
    .map((v) => ({ v, list: list.filter((o) => o.vocalist_id === v.id) }))
    .filter((g) => g.list.length);
  el.innerHTML = groups.map(({ v, list: l }) => {
    const folder = l.find((o) => o.date_folder)?.date_folder;
    const path = `D:\\FIRST CLUB\\${v.folder_name}${folder ? `\\${folder}` : ''}`;
    return `<div class="ord-group"><div class="ord-gh">${esc(v.display_name)}<small>${esc(path)}</small></div>
      <div class="table">${l.map(rowHtml).join('')}</div></div>`;
  }).join('');
}

/** Dipanggil saat tab dibuka: ambil data terbaru, lalu gambar. */
export async function render() { if (await load()) draw(); }

async function act(fn, args, okMsg) {
  const { error } = await sb.rpc(fn, args);
  if (error) { toast(error.message || 'Could not do that', 'bad'); }
  else if (okMsg) toast(okMsg);
  if (await load()) { draw(); ctx.renderAll?.(); }
}

export async function init(c) {
  ctx = c;
  await load();
  if (!$('appView').classList.contains('hidden')) ctx.renderAll?.();
  on($('ordAdmin'), 'click', 'Orders', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.ordAccept) return act('accept_order', { p_id: d.ordAccept }, 'Order accepted');
    if (d.ordReject) {
      if (!confirm('Reject this order?')) return;
      return act('reject_order', { p_id: d.ordReject }, 'Order rejected');
    }
    if (d.ordRetry) return act('retry_order', { p_id: d.ordRetry }, 'Queued again');
    if (d.ordCopy) {
      const o = orders.find((x) => x.id === d.ordCopy); if (!o) return;
      try { await navigator.clipboard.writeText(o.url); toast('Link copied'); }
      catch { window.prompt('Copy this link:', o.url); }
    }
  });
  on($('ordReload'), 'click', 'Orders', async () => { if (await load()) draw(); });
  // Status, persen unduhan, dan lencana jumlah order menunggu ikut diperbarui.
  setInterval(async () => {
    const before = waitingCount();
    if (!(await load())) return;
    if (!$('ordView').classList.contains('hidden')) draw();
    if (waitingCount() !== before && !$('appView').classList.contains('hidden')) ctx.renderAll?.();
  }, 8000);
}
