// VOKALIS — modul Songlist (My Songs): lagu milik vokalis ini.
// Tombol per lagu: belum di-Accept → [Accept] [▶]; sudah di-Accept → [Revision] [Send to FC] [▶].
// All Song List ada di modul terpisah (allsongs.js), dibuka dari laci.
// Tombol "Send to FC" mengirim event 'fc:send' ke modul Send (send.js).
// Tombol ▶ mengirim event 'fc:play' ke modul Player (bar bawah). Kalau modul Player tidak
// berjalan, tombol tetap berfungsi sebagai link biasa ke halaman player terpisah.
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, norm, dateLabel } from '/js/core/format.js';

let rep;
let playing = 0;

const CHECK_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const SEND_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4 20-7z"/></svg>';

const REV_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';

const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

// Unduh WAV (cadangan pribadi vokalis): muncul hanya kalau WAV sudah siap di Drive.
function downloadButton(s) {
  if (s.wav !== 'complete' || s.on_drive === false) return '';
  return `<a class="btn dlbtn" href="/vdl/${encodeURIComponent(rep.token)}/${encodeURIComponent(s.id)}" download data-vdl="${s.n}" title="Download WAV" aria-label="Download WAV: ${esc(s.title)}">${DL_ICON}</a>`;
}

// Tombol kirim ke FC sesuai status: Preparing… → Send to FC → Sent → Downloaded by FC.
function sendButton(s) {
  const t = esc(s.title);
  if (s.fc_downloaded_at) return `<button class="sendbtn done" disabled title="FC downloaded this song" aria-label="${t}: downloaded by FC">${CHECK_ICON}<span>Downloaded</span></button>`;
  if (s.sent_at) return `<button class="sendbtn sent" disabled title="Waiting for FC to download" aria-label="${t}: sent to FC">${CHECK_ICON}<span>Sent</span></button>`;
  if (s.wav === 'complete' && s.on_drive !== false) return `<button class="sendbtn" data-send="${s.n}" aria-label="Send to FC: ${t}">${SEND_ICON}<span>Send to FC</span></button>`;
  if (s.wav === 'complete') return `<button class="sendbtn" disabled title="This file is no longer stored. Ask the studio." aria-label="${t}: not available">${SEND_ICON}<span>Unavailable</span></button>`;
  return `<button class="sendbtn preparing" disabled aria-label="Preparing ${t} for sending" title="${s.wav === 'failed' ? 'Upload is being retried automatically' : 'Getting the WAV ready…'}"><i class="spin" aria-hidden="true"></i><span>Preparing…</span></button>`;
}

const playUrl = (n) => `/v/${encodeURIComponent(rep.token)}/play/${n}`;

function render() {
  const q = norm($('qSongs').value.trim());
  const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).reverse().filter((s) => !q || norm(s.title).includes(q));
  $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list play"><span>#</span><span>Date</span><span>Title</span><span></span></div>` +
        rows.map((s) => `<div class="row cols-list play ${s.n === playing ? 'playing' : ''}"><span class="no">${s.n === playing ? '<span class="eq" aria-label="Now playing"><i></i><i></i><i></i></span>' : s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}${!s.accepted_at && s.revision_requested_at ? ' <span class="badge rev">Revision requested</span>' : ''}</span>` +
          `<span class="pl">${s.accepted_at
            ? downloadButton(s) + `<button class="revbtn" data-revision="${s.n}" aria-label="Request a revision: ${esc(s.title)}" title="Request a revision">${REV_ICON}<span>Revision</span></button>` +
              sendButton(s)
            : `<button class="acceptbtn" data-accept="${s.n}" aria-label="Accept ${esc(s.title)}">${CHECK_ICON}<span>Accept</span></button>`}<a class="btn playbtn${s.audio ? '' : ' noaudio'}" data-play="${s.n}" href="${playUrl(s.n)}" aria-label="Play ${esc(s.title)}"${s.audio ? '' : ' title="No audio yet"'}>▶</a></span></div>`).join('')
      : `<div class="empty">${q ? 'No matching songs.' : 'No songs yet.'}</div>`;
}

export function mount(report) {
  rep = report;
  on($('qSongs'), 'input', 'Songlist', render);
  on($('songsTable'), 'click', 'Songlist', (e) => {
    const ab = e.target.closest('[data-accept]');
    if (ab) {
      // Accept dulu (lagu dikunci), baru tombol berubah jadi Send to FC. Diurus modul send.js.
      if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:accept', { detail: { n: Number(ab.dataset.accept) } }));
      else toast('Accept is not available right now');
      return;
    }
    const rb = e.target.closest('[data-revision]');
    if (rb) {
      if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:revision', { detail: { n: Number(rb.dataset.revision) } }));
      else toast('Revision is not available right now');
      return;
    }
    if (e.target.closest('[data-vdl]')) { toast('Download started'); return; } // biarkan browser mengunduh
    const sb = e.target.closest('[data-send]');
    if (sb) {
      // Diteruskan ke modul Send to FC (nanti: kirim ke FC lewat WhatsApp). Modul tidak jalan → pesan saja.
      if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:send', { detail: { n: Number(sb.dataset.send) } }));
      else toast('Send to FC is not available yet');
      return;
    }
    const a = e.target.closest('[data-play]'); if (!a) return;
    if (!window.FC_PLAYER?.ready) return; // modul Player tidak jalan → biarkan link biasa
    e.preventDefault();
    window.dispatchEvent(new CustomEvent('fc:play', { detail: { n: Number(a.dataset.play) } }));
  });
  window.addEventListener('fc:track', (e) => { playing = e.detail.n; render(); });
  window.addEventListener('fc:songs-changed', () => render());
  render();
}
