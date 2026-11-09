// VOKALIS — modul Accept, Revision & Send to FC.
//
// Alur: lagu baru → tombol "Accept". Vokalis mendengarkan dulu; kalau sudah oke, tekan Accept
// (lagu dikunci). Setelah itu muncul "Revision" dan "Send to FC".
// Revision = batalkan Accept + minta revisi (boleh dengan catatan); tombol kembali ke "Accept".
// Pengiriman ke FC (mis. lewat WhatsApp Business) belum diputuskan, jadi Send masih "coming soon".
import { sb } from '/js/core/supabase.js';
import { toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';

let rep, dlg, rdlg;

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

function askRevision(song) {
  return new Promise((resolve) => {
    rdlg.querySelector('.cf-title').textContent = song.title;
    const ta = rdlg.querySelector('textarea'); ta.value = '';
    rdlg.returnValue = '';
    rdlg.showModal();
    rdlg.addEventListener('close', () => resolve(rdlg.returnValue === 'ok' ? { note: ta.value.trim() } : null), { once: true });
  });
}

async function revision(n) {
  const s = rep.songs[n - 1];
  if (!s || !s.accepted_at) return;
  const ans = await askRevision(s);
  if (!ans) return;
  const { data, error } = await Promise.resolve()
    .then(() => sb.rpc('request_revision', { p_token: rep.token, p_song: s.id, p_note: ans.note }))
    .catch((e) => ({ error: e }));
  if (error || !data) { report('Revision', error || new Error('no data')); return toast('Could not send the request. Please try again.', 'bad'); }
  s.accepted_at = null;
  s.revision_requested_at = data.revision_requested_at;
  window.dispatchEvent(new CustomEvent('fc:songs-changed'));
  toast(`Revision requested · "${s.title}"`);
}

export function mount(report_) {
  rep = report_;
  dlg = document.createElement('dialog');
  dlg.className = 'confirm';
  dlg.innerHTML = `<form method="dialog">
      <h2>Accept this song?</h2>
      <p class="cf-title"></p>
      <p class="note">After accepting, this mixdown is locked and you can send it to FC. If something still needs fixing later, use Revision.</p>
      <div class="bar" style="margin:14px 0 0;justify-content:flex-end">
        <button value="cancel">Not yet</button>
        <button class="primary" value="ok">Accept</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);

  rdlg = document.createElement('dialog');
  rdlg.className = 'confirm';
  rdlg.innerHTML = `<form method="dialog">
      <h2>Request a revision?</h2>
      <p class="cf-title"></p>
      <p class="note">Your Accept is cancelled and the song is unlocked, so a revised mixdown can be made.</p>
      <label class="rv-label" for="rvNote">What should be changed? <span>(optional)</span></label>
      <textarea id="rvNote" rows="3" maxlength="500" placeholder="e.g. shorter intro, key down 1"></textarea>
      <div class="bar" style="margin:14px 0 0;justify-content:flex-end">
        <button value="cancel">Cancel</button>
        <button class="primary" value="ok">Request revision</button>
      </div>
    </form>`;
  document.body.appendChild(rdlg);

  on(window, 'fc:accept', 'Accept', (e) => accept(e.detail.n));
  on(window, 'fc:revision', 'Revision', (e) => revision(e.detail.n));
  on(window, 'fc:send', 'Send to FC', (e) => {
    const s = rep.songs[e.detail.n - 1];
    if (!s) return;
    toast(`Send to FC is coming soon · ${s.title}`);
  });
  window.FC_SEND = { ready: true };
}
