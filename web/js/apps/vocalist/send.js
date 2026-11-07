// VOKALIS — modul Accept & Send to FC.
//
// Alur: lagu baru → tombol "Accept". Vokalis mendengarkan dulu; kalau sudah oke, tekan Accept
// (lagu dikunci: tidak ada revisi lagi). Setelah itu tombol berubah jadi "Send to FC".
// Pengiriman ke FC (mis. lewat WhatsApp Business) belum diputuskan, jadi Send masih "coming soon".
import { sb } from '/js/core/supabase.js';
import { toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';

let rep, dlg;

function ask(song) {
  return new Promise((resolve) => {
    dlg.querySelector('.cf-title').textContent = song.title;
    dlg.returnValue = '';
    dlg.showModal();
    dlg.addEventListener('close', () => resolve(dlg.returnValue === 'ok'), { once: true });
  });
}

async function accept(n) {
  const s = rep.songs[n - 1];
  if (!s || s.accepted_at) return;
  if (!(await ask(s))) return;
  const { data, error } = await Promise.resolve()
    .then(() => sb.rpc('accept_song', { p_token: rep.token, p_song: s.id }))
    .catch((e) => ({ error: e }));
  if (error || !data) { report('Accept', error || new Error('no data')); return toast('Could not accept. Please try again.', 'bad'); }
  s.accepted_at = data;
  window.dispatchEvent(new CustomEvent('fc:songs-changed'));
  toast(`Accepted · you can now send "${s.title}" to FC`);
}

export function mount(report_) {
  rep = report_;
  dlg = document.createElement('dialog');
  dlg.className = 'confirm';
  dlg.innerHTML = `<form method="dialog">
      <h2>Accept this song?</h2>
      <p class="cf-title"></p>
      <p class="note">After accepting, this mixdown is final and locked — no more revisions. Then you can send it to FC.</p>
      <div class="bar" style="margin:14px 0 0;justify-content:flex-end">
        <button value="cancel">Not yet</button>
        <button class="primary" value="ok">Accept</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  on(window, 'fc:accept', 'Accept', (e) => accept(e.detail.n));
  on(window, 'fc:send', 'Send to FC', (e) => {
    const s = rep.songs[e.detail.n - 1];
    if (!s) return;
    toast(`Send to FC is coming soon · ${s.title}`);
  });
  window.FC_SEND = { ready: true };
}
