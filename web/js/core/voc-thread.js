// CORE — riwayat balasan dari sisi vokalis. Dipakai halaman Order dan dialog Revisi.
// Hanya memakai RPC vocalist_thread / vocalist_post dengan share_token vokalis.
import { sb } from './supabase.js';
import { report } from './guard.js';
import { bubblesHtml, composerHtml } from './thread.js';

/**
 * Isi `el` dengan riwayat dan kotak balas. `kind` = 'revision' | 'order', `ref` = id lagu / group.
 * Pemanggil bertanggung jawab memanggil lagi bila perlu (mis. setelah membuka menu).
 */
export async function mountVocThread(el, { token, kind, ref }) {
  el.innerHTML = `<div class="thread-body"><p class="thread-empty">Loading…</p></div>${composerHtml('vt-' + kind + '-' + ref)}`;
  const box = el.querySelector('textarea');
  const btn = el.querySelector('[data-thread-send]');

  const paint = (data) => {
    el.querySelector('.thread-body').innerHTML = bubblesHtml(data.messages, data.initial, 'vocalist');
    const body = el.querySelector('.thread-body');
    body.scrollTop = body.scrollHeight;
  };

  const load = async () => {
    const { data, error } = await sb.rpc('vocalist_thread', { p_token: token, p_kind: kind, p_ref: ref });
    if (error) { el.querySelector('.thread-body').innerHTML = '<p class="thread-empty">Could not load messages.</p>'; report('Messages', error); return; }
    paint(data);
  };

  btn.addEventListener('click', async () => {
    const text = box.value.trim();
    if (!text) return;
    btn.disabled = true;
    try {
      const { error } = await sb.rpc('vocalist_post', { p_token: token, p_kind: kind, p_ref: ref, p_body: text });
      if (error) {
        const msg = error.message?.includes('too many') ? 'Too many messages. Wait a minute.'
          : error.message?.includes('too long') ? 'That message is too long.'
          : 'Could not send. Try again in a moment.';
        el.querySelector('.thread-body').insertAdjacentHTML('beforeend', `<p class="thread-empty">${msg}</p>`);
        return;
      }
      box.value = '';
      await load();
    } finally { btn.disabled = false; }
  });

  await load();
}
