// VOKALIS — modul Accept, Revision & Send to FC.
//
// Alur: lagu baru → tombol "Accept". Vokalis mendengarkan dulu; kalau sudah oke, tekan Accept
// (lagu dikunci). Setelah itu muncul "Send to FC".
// Revision = batalkan Accept + minta revisi (boleh dengan catatan); tombol kembali ke "Accept".
// Revision bukan tombol: diminta lewat klik kanan / tekan lama pada lagu (lihat songlist.js).
// Send to FC: lagu muncul di halaman unduhan operator FC (/fc/<kode>). Vokalis memberi tahu
// operator sendiri lewat WhatsApp. Status tombol: Send to FC → Ready (terkirim) → Finish (vokalis
// sudah mengunduh WAV-nya sendiri). Lihat songlist.js.
import { sb } from '/js/core/supabase.js';
import { toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';

let rep, dlg, rdlg, sdlg;

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
  if (s.wav !== 'complete') s.wav = 'waiting';
  window.dispatchEvent(new CustomEvent('fc:songs-changed'));
  toast(`Accepted · preparing "${s.title}" for sending`);
  watchWav();
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
  s.wav = null; s.sent_at = null; s.fc_downloaded_at = null;
  s.revision_requested_at = data.revision_requested_at;
  window.dispatchEvent(new CustomEvent('fc:songs-changed'));
  toast(`Revision requested · "${s.title}"`);
}

// Setelah Accept, WAV diunggah ke Google Drive oleh program di komputer studio.
// Selama ada lagu yang belum siap, status dicek ulang tiap 15 detik (hanya saat halaman terlihat).
let wavTimer = null;
const pendingWav = () => rep.songs.some((s) => s.accepted_at && (s.wav !== 'complete' || (s.sent_at && !s.fc_downloaded_at)));
async function refreshWav() {
  wavTimer = null;
  if (!pendingWav()) return;
  if (!document.hidden) {
    const { data } = await Promise.resolve().then(() => sb.rpc('get_vocalist_report', { p_token: rep.token })).catch(() => ({}));
    if (data?.songs) {
      let changed = false;
      for (const fresh of data.songs) {
        const s = rep.songs.find((x) => x.id === fresh.id);
        if (!s) continue;
        if (s.wav !== fresh.wav && fresh.wav === 'complete' && s.accepted_at && !s.sent_at) toast(`"${s.title}" is ready to send`);
        if (!s.fc_downloaded_at && fresh.fc_downloaded_at) toast(`FC downloaded "${s.title}"`);
        for (const k of ['wav', 'on_drive', 'sent_at', 'fc_downloaded_at', 'vocalist_downloaded_at']) {
          if (s[k] !== fresh[k]) { s[k] = fresh[k]; changed = true; }
        }
      }
      if (changed) window.dispatchEvent(new CustomEvent('fc:songs-changed'));
    }
  }
  watchWav();
}
function watchWav() {
  if (wavTimer || !pendingWav()) return;
  const waitingFile = rep.songs.some((s) => s.accepted_at && s.wav !== 'complete');
  wavTimer = setTimeout(refreshWav, waitingFile ? 15000 : 30000);
}

function askSend(song) {
  return new Promise((resolve) => {
    sdlg.querySelector('.cf-title').textContent = song.title;
    sdlg.returnValue = '';
    sdlg.showModal();
    sdlg.addEventListener('close', () => resolve(sdlg.returnValue === 'ok'), { once: true });
  });
}

async function send(n) {
  const s = rep.songs[n - 1];
  if (!s || !s.accepted_at || s.sent_at || s.wav !== 'complete') return;
  if (!(await askSend(s))) return;
  const { data, error } = await Promise.resolve()
    .then(() => sb.rpc('send_to_fc', { p_token: rep.token, p_song: s.id }))
    .catch((e) => ({ error: e }));
  if (error || !data) {
    report('Send to FC', error || new Error('no data'));
    return toast(/not ready/.test(error?.message || '') ? 'The file is not ready yet. Please wait a moment.' : 'Could not send. Please try again.', 'bad');
  }
  s.sent_at = data;
  window.dispatchEvent(new CustomEvent('fc:songs-changed'));
  toast(`Sent · let FC know "${s.title}" is ready to download`);
  watchWav();
}

export function mount(report_) {
  rep = report_;
  dlg = document.createElement('dialog');
  dlg.className = 'confirm';
  dlg.innerHTML = `<form method="dialog">
      <h2>Accept this song?</h2>
      <p class="cf-title"></p>
      <p class="note">After accepting, this mixdown is locked and you can send it to FC. If something still needs fixing later, right-click the song (on phone: press and hold) and choose Request a revision.</p>
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

  sdlg = document.createElement('dialog');
  sdlg.className = 'confirm';
  sdlg.innerHTML = `<form method="dialog">
      <h2>Send to FC?</h2>
      <p class="cf-title"></p>
      <p class="note">The song will appear on FC's download page. Then message FC that it's ready.</p>
      <div class="bar" style="margin:14px 0 0;justify-content:flex-end">
        <button value="cancel">Cancel</button>
        <button class="primary" value="ok">Send</button>
      </div>
    </form>`;
  document.body.appendChild(sdlg);

  on(window, 'fc:accept', 'Accept', (e) => accept(e.detail.n));
  on(window, 'fc:revision', 'Revision', (e) => revision(e.detail.n));
  on(window, 'fc:send', 'Send to FC', (e) => send(e.detail.n));
  document.addEventListener('visibilitychange', () => { if (!document.hidden && pendingWav()) { clearTimeout(wavTimer); wavTimer = null; refreshWav(); } });
  watchWav();
  window.FC_SEND = { ready: true };
}
