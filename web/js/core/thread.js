// CORE — tampilan riwayat balasan (dipakai admin dan vokalis). Fungsi murni: hanya membuat HTML.
// Pengambilan dan pengiriman data ada di modul masing-masing, tidak di sini.
import { esc, timeAgo } from './format.js';

/**
 * @param {Array<{sender:'admin'|'vocalist', body:string, created_at:string}>} messages
 * @param {{sender:'vocalist', body:string, created_at:string}|null} initial  catatan awal dari vokalis
 * @param {'admin'|'vocalist'} me  pihak yang sedang melihat (untuk sisi gelembung)
 */
export function bubblesHtml(messages, initial, me) {
  const items = [];
  if (initial?.body) items.push({ sender: 'vocalist', body: initial.body, created_at: initial.created_at, first: true });
  for (const m of messages || []) items.push(m);
  if (!items.length) return '<p class="thread-empty">No messages yet.</p>';
  return items.map((m) => {
    const mine = m.sender === me;
    const who = m.sender === 'admin' ? 'Admin' : 'Vocalist';
    return `<div class="bubble ${mine ? 'mine' : 'theirs'}">
      <div class="bubble-meta">${esc(who)}${m.first ? ' · note' : ''}${m.created_at ? ` · <span title="${esc(m.created_at)}">${esc(timeAgo(m.created_at))}</span>` : ''}</div>
      <div class="bubble-body">${esc(m.body)}</div>
    </div>`;
  }).join('');
}

/** Kotak tulis balasan. `id` harus unik di halaman. */
export function composerHtml(id) {
  return `<div class="thread-compose">
    <textarea id="${esc(id)}" rows="2" maxlength="1000" placeholder="Write a reply…" aria-label="Reply"></textarea>
    <button type="button" class="primary" data-thread-send="${esc(id)}">Send reply</button>
  </div>`;
}
