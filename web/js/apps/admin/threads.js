// ADMIN — riwayat balasan untuk Revisions dan Orders. Dipakai bersama oleh kedua modul itu.
// Kontainer: <div data-thread data-kind="revision|order" data-ref="<id>" data-vocalist="<id>"
//                 data-initial="<json {body, created_at}|null>"></div>
// Tulisan admin disimpan ke thread_messages (RLS: admin saja), lalu fungsi reply-notify
// dipanggil untuk mengirim notifikasi ke HP vokalis. Kegagalan notifikasi tidak membatalkan balasan.
import { sb } from '/js/core/supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '/js/core/config.js';
import { toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';
import { bubblesHtml, composerHtml } from '/js/core/thread.js';

const NOTIFY = SUPABASE_URL + '/functions/v1/reply-notify';

function slotOf(el) {
  const d = el.dataset;
  let initial = null;
  try { initial = JSON.parse(d.initial || 'null'); } catch { initial = null; }
  return { kind: d.kind, ref: d.ref, vocalist: d.vocalist, initial, el };
}

async function fill(slot) {
  const { data, error } = await sb.from('thread_messages')
    .select('id, sender, body, created_at, read_at').eq('kind', slot.kind).eq('ref_id', slot.ref)
    .order('created_at', { ascending: true });
  if (error) { slot.el.querySelector('.thread-body').innerHTML = '<p class="thread-empty">Could not load messages.</p>'; return; }
  // Admin membaca pesan vokalis: tandai terbaca.
  const unread = data.filter((m) => m.sender === 'vocalist' && !m.read_at).map((m) => m.id);
  if (unread.length) await sb.from('thread_messages').update({ read_at: new Date().toISOString() }).in('id', unread);
  slot.el.querySelector('.thread-body').innerHTML = bubblesHtml(data, slot.initial, 'admin');
}

/** Isi semua riwayat di dalam `root`. Panggil setiap kali daftar dirender ulang. */
export async function loadThreads(root) {
  if (!root) return;
  const slots = [...root.querySelectorAll('[data-thread]')].map(slotOf);
  for (const s of slots) {
    if (!s.el.querySelector('.thread-body')) {
      s.el.innerHTML = `<div class="thread-body"></div>${composerHtml('reply-' + s.ref)}`;
    }
    await fill(s);
  }
}

/** Pasang sekali di init modul. Menangani tombol kirim balasan di dalam `root`. */
export function bindThreads(root) {
  on(root, 'click', 'Replies', async (e) => {
    const btn = e.target.closest('[data-thread-send]');
    if (!btn) return;
    const holder = btn.closest('[data-thread]');
    const slot = slotOf(holder);
    const box = holder.querySelector('textarea');
    const body = box.value.trim();
    if (!body) return toast('Write a reply first', 'bad');
    btn.disabled = true;
    try {
      const { error } = await sb.from('thread_messages').insert({
        vocalist_id: slot.vocalist, kind: slot.kind, ref_id: slot.ref, sender: 'admin', body,
      });
      if (error) { report('Replies', error); return toast('Could not send the reply. Try again.', 'bad'); }
      box.value = '';
      toast('Reply sent');
      await fill(slot);
      // Notifikasi ke vokalis: best effort.
      const { data: sess } = await sb.auth.getSession();
      const token = sess?.session?.access_token;
      if (token) {
        fetch(NOTIFY, {
          method: 'POST',
          headers: { 'content-type': 'application/json', apikey: SUPABASE_KEY, authorization: 'Bearer ' + token },
          body: JSON.stringify({ vocalist_id: slot.vocalist, kind: slot.kind, ref_id: slot.ref }),
        }).catch((err) => report('Replies notify', err));
      }
    } finally { btn.disabled = false; }
  });
}
