// VOKALIS — modul Order Song: tempel satu atau beberapa link YouTube (medley), tulis catatan,
// kirim ke admin, lihat statusnya. Pengunduhan terjadi di PC admin; vokalis hanya melihat
// Waiting / Accepted / Ready. Catatan hanya dibaca admin; tidak ada balasan.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, timeAgo } from '/js/core/format.js';

let rep;
const MAX_LINKS = 10;

const LABEL = {
  waiting: ['Waiting', 'warn'], accepted: ['Accepted', 'ok'], downloading: ['Accepted', 'ok'],
  failed: ['Accepted', 'ok'], done: ['Ready', 'ok'],
};

const MSG = {
  'not a YouTube video link': 'That is not a YouTube video link. Paste the link of one video.',
  'already ordered': 'One of these songs is already ordered.',
  'too many waiting orders': 'You have too many orders waiting. Wait for the admin to accept some first.',
  'too many links': 'An order can have up to 10 links.',
  'link too long': 'That link is too long.',
};
const failMsg = (error) => {
  const key = Object.keys(MSG).find((k) => error.message?.includes(k));
  return key ? MSG[key] : 'Could not send. Try again in a moment.';
};

const short = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '');
const inputs = () => [...document.querySelectorAll('#ordLinks .ord-link')];

function syncTitleBox() {
  $('ordTitleBox').classList.toggle('hidden', inputs().filter((i) => i.value.trim()).length < 2);
}

function addInput() {
  if (inputs().length >= MAX_LINKS) { toast('An order can have up to 10 links', 'bad'); return; }
  const i = document.createElement('input');
  i.type = 'url'; i.className = 'ord-link'; i.autocomplete = 'off';
  i.placeholder = 'Another link'; i.setAttribute('aria-label', 'Another YouTube link');
  i.style.marginTop = '6px';
  $('ordLinks').appendChild(i);
  i.focus();
}

function groupHtml(g) {
  const multi = g.links.length > 1;
  const links = g.links.map((l) => {
    const [t, c] = LABEL[l.status] || ['Waiting', 'warn'];
    return `<div class="ord-row"><span class="ord-url" title="${esc(l.url)}">${esc(short(l.url))}</span><span class="badge ${c}">${t}</span></div>`;
  }).join('');
  return `<div class="ord-group">
    <div class="ord-gh">${multi ? esc(g.title || 'Medley') : ''}<small>${multi ? g.links.length + ' links · ' : ''}${esc(timeAgo(g.created_at))}</small></div>
    <div class="table">${links}</div>
    <div class="bar" style="margin:6px 0 0"><button class="ghost" data-add-to="${g.group_id}">+ Add link</button></div>
  </div>`;
}

async function load() {
  const { data, error } = await sb.rpc('my_orders', { p_token: rep.token });
  if (error) { $('ordList').innerHTML = `<div class="empty">Could not load your orders. Reload the page in a moment.</div>`; return; }
  $('ordList').innerHTML = data.length ? data.map(groupHtml).join('') : `<div class="empty">No orders yet.</div>`;
}

async function send() {
  const urls = inputs().map((i) => i.value.trim()).filter(Boolean);
  if (!urls.length) { toast('Paste a YouTube link first', 'bad'); return; }
  $('ordSend').disabled = true;
  try {
    const { error } = await sb.rpc('place_order', {
      p_token: rep.token, p_urls: urls,
      p_title: urls.length > 1 ? $('ordTitle').value : null, p_note: $('ordNote').value,
    });
    if (error) { toast(failMsg(error), 'bad'); return; }
    for (const i of inputs().slice(1)) i.remove();
    $('ordUrl').value = ''; $('ordTitle').value = ''; $('ordNote').value = '';
    syncTitleBox();
    toast('Order sent');
    await load();
  } finally { $('ordSend').disabled = false; }
}

async function addTo(group) {
  const url = (window.prompt('Paste another YouTube link for this order:') || '').trim();
  if (!url) return;
  const { error } = await sb.rpc('add_order_link', { p_token: rep.token, p_group: group, p_url: url });
  if (error) { toast(failMsg(error), 'bad'); return; }
  toast('Link added');
  await load();
}

export function mount(report) {
  rep = report;
  on($('ordSend'), 'click', 'Order Song', send);
  on($('ordAdd'), 'click', 'Order Song', addInput);
  on($('ordLinks'), 'input', 'Order Song', syncTitleBox);
  on($('ordList'), 'click', 'Order Song', (e) => {
    const b = e.target.closest('[data-add-to]'); if (b) addTo(b.dataset.addTo);
  });
  on(window, 'fc:view', 'Order Song', (e) => { if (e.detail === 'order') load(); });
  load();
}
