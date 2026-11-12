// VOKALIS — modul Songlist (My Songs): lagu milik vokalis ini.
// Tombol per lagu: belum di-Accept → [Accept] [▶]; sudah di-Accept → [Download WAV] [Send to FC] [▶].
// Setelah operator FC mengunduh: tombol Download hilang, muncul keterangan "Finish" (bukan tombol)
// dan status menjadi "Ready".
// Revision tidak lagi berupa tombol: klik kanan (desktop) / tekan lama (HP) pada lagu yang sudah
// di-Accept → menu "Request a revision" → event 'fc:revision' ke modul Send (send.js).
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

const DL_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/></svg>';

// Unduh WAV (cadangan pribadi vokalis): muncul hanya kalau WAV sudah siap di Drive,
// dan hilang setelah lagu diunduh operator FC.
function downloadButton(s) {
  if (s.fc_downloaded_at) return '';
  if (s.wav !== 'complete' || s.on_drive === false) return '';
  return `<a class="btn dlbtn" href="/vdl/${encodeURIComponent(rep.token)}/${encodeURIComponent(s.id)}" download data-vdl="${s.n}" title="Download WAV" aria-label="Download WAV: ${esc(s.title)}">${DL_ICON}</a>`;
}

// Tombol kirim ke FC sesuai status: Preparing… → Send to FC → Sent → Ready (sudah diunduh FC).
/**
 * Selama lagu dalam revisi, semua tombolnya mati: versi lama sudah dicabut dan versi barunya
 * belum ada, jadi tidak ada yang bisa diputar, diunduh, atau dikirim.
 */
/** Satu sumber kebenaran: lagu sedang direvisi selama revision_requested_at terisi. */
const onRevision = (s) => !!s.revision_requested_at;

function buttons(s) {
  if (onRevision(s)) {
    return '<button class="sendbtn wait" disabled title="The studio is working on your revision">On revision</button>';
  }
  if (s.accepted_at) {
    // Keterangan "Finish" menggantikan tempat tombol Revision yang lama; ini teks, bukan tombol.
    // Revisi tetap bisa diminta lewat klik kanan / tekan lama pada lagu.
    const finish = s.fc_downloaded_at ? '<span class="finishtag" title="Press and hold (or right-click) the song to request a revision">Finish</span>' : '';
    return downloadButton(s) + finish + sendButton(s);
  }
  return `<button class="acceptbtn" data-accept="${s.n}" aria-label="Accept ${esc(s.title)}">${CHECK_ICON}<span>Accept</span></button>`;
}

function playButton(s) {
  const off = onRevision(s) || !s.audio;
  const why = onRevision(s) ? 'Being revised — the new version is not ready yet' : (s.audio ? '' : 'No audio yet');
  return `<a class="btn playbtn${off ? ' noaudio' : ''}" data-play="${s.n}" href="${playUrl(s.n)}" aria-label="Play ${esc(s.title)}"${why ? ` title="${esc(why)}"` : ''}>▶</a>`;
}

function sendButton(s) {
  const t = esc(s.title);
  if (s.fc_downloaded_at) return `<button class="sendbtn done" disabled title="FC downloaded this song" aria-label="${t}: ready">${CHECK_ICON}<span>Ready</span></button>`;
  if (s.sent_at) return `<button class="sendbtn sent" disabled title="Waiting for FC to download" aria-label="${t}: sent to FC">${CHECK_ICON}<span>Sent</span></button>`;
  if (s.wav === 'complete' && s.on_drive !== false) return `<button class="sendbtn" data-send="${s.n}" aria-label="Send to FC: ${t}">${SEND_ICON}<span>Send to FC</span></button>`;
  if (s.wav === 'complete') return `<button class="sendbtn" disabled title="This file is no longer stored. Ask the studio." aria-label="${t}: not available">${SEND_ICON}<span>Unavailable</span></button>`;
  return `<button class="sendbtn preparing" disabled aria-label="Preparing ${t} for sending" title="${s.wav === 'failed' ? 'Upload is being retried automatically' : 'Getting the WAV ready…'}"><i class="spin" aria-hidden="true"></i><span>Preparing…</span></button>`;
}

const playUrl = (n) => `/v/${encodeURIComponent(rep.token)}/play/${n}`;

// Revisi hanya bisa diminta untuk lagu yang sudah di-Accept dan belum sedang direvisi
// (sama seperti syarat tombol Revision yang lama).
const canRevise = (s) => !!s.accepted_at && !onRevision(s);

// ---------- Menu klik kanan / tekan lama ----------
let menuEl = null;
let menuAt = 0; // kapan menu terakhir dibuka (untuk mencegah dobel di HP)
function closeMenu() { menuEl?.remove(); menuEl = null; }

function openMenu(n, x, y) {
  const s = rep.songs[n - 1];
  if (!s || !canRevise(s)) return;
  if (menuEl && menuEl.dataset.n === String(n) && Date.now() - menuAt < 900) return;
  closeMenu();
  menuEl = document.createElement('div');
  menuEl.className = 'ctxmenu';
  menuEl.setAttribute('role', 'menu');
  menuEl.dataset.n = String(n);
  menuEl.innerHTML = `<div class="ctx-title">${esc(s.title)}</div>
    <button role="menuitem" data-act="revision">Request a revision…</button>`;
  document.body.appendChild(menuEl);
  menuAt = Date.now();
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  on(menuEl, 'click', 'Song menu', (e) => {
    if (!e.target.closest('[data-act="revision"]')) return;
    closeMenu();
    if (window.FC_SEND?.ready) window.dispatchEvent(new CustomEvent('fc:revision', { detail: { n } }));
    else toast('Revision is not available right now');
  });
  menuEl.querySelector('button').focus({ preventScroll: true });
}

function render() {
  const q = norm($('qSongs').value.trim());
  const rows = rep.songs.map((s, i) => ({ ...s, n: i + 1 })).reverse().filter((s) => !q || norm(s.title).includes(q));
  $('songsTable').innerHTML = rows.length
      ? `<div class="row head cols-list play"><span>#</span><span>Date</span><span>Title</span><span></span></div>` +
        rows.map((s) => `<div class="row cols-list play ${s.n === playing ? 'playing' : ''}"${canRevise(s) ? ` data-rev-menu="${s.n}"` : ''}><span class="no">${s.n === playing ? '<span class="eq" aria-label="Now playing"><i></i><i></i><i></i></span>' : s.n}</span><span class="date">${esc(dateLabel(s))}</span><span class="title">${esc(s.title)}${onRevision(s) ? ' <span class="badge rev">On revision</span>' : ''}</span>` +
          `<span class="pl">${buttons(s)}${playButton(s)}</span></div>`).join('')
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

  // Klik kanan (desktop). Juga dipicu tombol Menu / Shift+F10 di keyboard (koordinat 0,0 → pakai posisi baris).
  on($('songsTable'), 'contextmenu', 'Songlist', (e) => {
    const row = e.target.closest('[data-rev-menu]'); if (!row) return;
    e.preventDefault();
    const rc = row.getBoundingClientRect();
    const kb = e.clientX === 0 && e.clientY === 0;
    openMenu(Number(row.dataset.revMenu), kb ? rc.left + 24 : e.clientX, kb ? rc.bottom : e.clientY);
  });

  // Tekan lama (HP). Klik yang menyusul setelah tekan lama diabaikan supaya tidak menekan tombol di bawah jari.
  let lp = null;
  let swallowClickUntil = 0;
  const cancelLp = () => { clearTimeout(lp?.timer); lp = null; };
  on($('songsTable'), 'touchstart', 'Songlist', (e) => {
    const row = e.target.closest('[data-rev-menu]'); if (!row) return;
    const p = e.touches[0];
    lp = {
      x: p.clientX, y: p.clientY,
      timer: setTimeout(() => {
        navigator.vibrate?.(15);
        swallowClickUntil = Date.now() + 700;
        openMenu(Number(row.dataset.revMenu), lp.x, lp.y);
        lp = null;
      }, 550),
    };
  }, { passive: true });
  on($('songsTable'), 'touchmove', 'Songlist', (e) => {
    if (!lp) return;
    const p = e.touches[0];
    if (Math.abs(p.clientX - lp.x) > 10 || Math.abs(p.clientY - lp.y) > 10) cancelLp();
  }, { passive: true });
  on($('songsTable'), 'touchend', 'Songlist', cancelLp);
  on($('songsTable'), 'touchcancel', 'Songlist', cancelLp);
  $('songsTable').addEventListener('click', (e) => {
    if (Date.now() < swallowClickUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  document.addEventListener('pointerdown', (e) => { if (menuEl && !menuEl.contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('scroll', closeMenu, { passive: true });
  window.addEventListener('fc:songs-changed', closeMenu);

  window.addEventListener('fc:track', (e) => { playing = e.detail.n; render(); });
  window.addEventListener('fc:songs-changed', () => render());
  render();
}
