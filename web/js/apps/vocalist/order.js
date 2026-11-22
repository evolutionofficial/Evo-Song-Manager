// VOKALIS — modul Order Song: tempel satu link YouTube, kirim ke admin, lihat statusnya.
// Pengunduhan terjadi di PC admin; vokalis hanya melihat Waiting / Accepted / Ready / Not accepted.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, timeAgo } from '/js/core/format.js';

let rep;

const LABEL = {
  waiting: ['Waiting', 'warn'],
  accepted: ['Accepted', 'ok'],
  downloading: ['Accepted', 'ok'],
  failed: ['Accepted', 'ok'],
  done: ['Ready', 'ok'],
  rejected: ['Not accepted', 'muted'],
};

const MSG = {
  'not a YouTube video link': 'That is not a YouTube video link. Paste the link of one video.',
  'already ordered': 'You already ordered this song.',
  'too many waiting orders': 'You have too many orders waiting. Wait for the admin to accept some first.',
  'link too long': 'That link is too long.',
};

function short(u) { return String(u).replace(/^https?:\/\/(www\.)?/, ''); }

function row(o) {
  const [text, cls] = LABEL[o.status] || ['Waiting', 'warn'];
  return `<div class="ord-row">
    <span class="ord-url" title="${esc(o.url)}">${esc(short(o.url))}</span>
    <span class="ord-when">${esc(timeAgo(o.created_at))}</span>
    <span class="badge ${cls}">${text}</span>
  </div>`;
}

async function load() {
  const { data, error } = await sb.rpc('my_orders', { p_token: rep.token });
  if (error) { $('ordList').innerHTML = `<div class="empty">Could not load your orders. Reload the page in a moment.</div>`; return; }
  $('ordList').innerHTML = data.length ? data.map(row).join('') : `<div class="empty">No orders yet.</div>`;
}

async function send() {
  const url = $('ordUrl').value.trim();
  if (!url) { toast('Paste a YouTube link first', 'bad'); return; }
  $('ordSend').disabled = true;
  try {
    const { error } = await sb.rpc('place_order', { p_token: rep.token, p_url: url });
    if (error) {
      const key = Object.keys(MSG).find((k) => error.message?.includes(k));
      toast(key ? MSG[key] : 'Could not send the order. Try again in a moment.', 'bad');
      return;
    }
    $('ordUrl').value = '';
    toast('Order sent');
    await load();
  } finally { $('ordSend').disabled = false; }
}

export function mount(report) {
  rep = report;
  on($('ordSend'), 'click', 'Order Song', send);
  on($('ordUrl'), 'keydown', 'Order Song', (e) => { if (e.key === 'Enter') send(); });
  on(window, 'fc:view', 'Order Song', (e) => { if (e.detail === 'order') load(); });
  load();
}
