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
  if (o.status === 'waiting') return `<button data-ord-reject="${o.id}">Reject</button>`;
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
  el.innerHTML = state.vocalists.map((v) => {
    const mine = list.filter((o) => o.vocalist_id === v.id);
    if (!mine.length) return '';
    const groups = new Map();
    for (const o of mine) { if (!groups.has(o.group_id)) groups.set(o.group_id, []); groups.get(o.group_id).push(o); }
    const cards = [...groups.values()].map((l) => groupHtml(v, l)).join('');
    return `<div class="ord-group"><div class="ord-gh">${esc(v.display_name)}</div>${cards}</div>`;
  }).join('');
}

function groupHtml(v, l) {
  l.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  const multi = l.length > 1;
  const date = l.find((o) => o.date_folder)?.date_folder;
  const sub = multi ? (l[0].group_title || 'Medley') : '';
  const path = `D:\\FIRST CLUB\\${v.folder_name}${date ? `\\${date}` : ''}${sub ? `\\${sub}` : ''}`;
  const waiting = l.some((o) => o.status === 'waiting');
  const head = `<div class="ord-row"><span class="ord-url"><b>${multi ? esc(sub) + ' · ' + l.length + ' links' : 'Single song'}</b> <span class="ord-when">${esc(path)}</span></span>
    <span class="ord-when">${esc(timeAgo(l[0].created_at))}</span>
    ${waiting ? `<button class="primary" data-ord-accept="${l.find((o) => o.status === 'waiting').id}">Accept</button>` : ''}
    <button class="ghost" data-ord-add="${l[0].group_id}">+ Add link</button>
    ${l[0].note ? `<span class="ord-err">Note: ${esc(l[0].note)}</span>` : ''}</div>`;
  return `<div class="table" style="margin-bottom:10px">${head}${l.map(rowHtml).join('')}</div>`;
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
    if (d.ordAdd) {
      const url = (window.prompt('Paste another YouTube link for this order:') || '').trim();
      if (!url) return;
      return act('admin_add_order_link', { p_group: d.ordAdd, p_url: url }, 'Link added. Accept it to start the download');
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
