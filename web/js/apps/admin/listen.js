// ADMIN — modul Listen together: sisi PEMIMPIN sesi menyimak bersama.
//
// Dok di bawah layar supaya sesinya tetap berjalan sambil pindah tab. Yang dikirim ke vokalis
// hanya perintah (lagu ini, dari detik berapa, pada pukul berapa menurut jam saya); musiknya
// diputar masing-masing dari R2, jadi kualitasnya tidak turun sedikit pun.
//
// Halaman admin sebelumnya tidak punya pemutar sama sekali, jadi pemutar kecil di dok ini
// sekaligus menjadi pemutar pertama di sisi admin.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';
import { esc, dateLabel } from '/js/core/format.js';
import { createSession, targetPosition } from '/js/core/listen.js';

const I = {
  play: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
};

let ctx;
const audio = new Audio();
audio.preload = 'metadata';

// Keadaan sesi. room = null berarti tidak ada sesi berjalan.
let room = null;      // { code, vocalist, songs }
let ses = null;       // saluran realtime
let songId = null;
let guests = [];      // peserta selain saya
let guestInfo = {};   // id -> { ready, drift }
let starting = false;

const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');
const song = () => room?.songs.find((s) => s.id === songId) || null;
const playable = () => (room?.songs || []).filter((s) => s.has_audio);

/** Kabarkan keadaan sekarang ke vokalis. */
function announce() {
  if (!ses || !songId) return;
  ses.setState({ songId, pos: audio.currentTime || 0, playing: !audio.paused && !audio.ended, duration: audio.duration });
}

// ---------------------------------------------------------------- memulai & mengakhiri

export async function open(vocalistId) {
  if (starting) return;
  const voc = (ctx.vocalists() || []).find((v) => v.id === vocalistId);
  if (!voc) return toast('Vocalist not found', 'bad');
  if (room && room.vocalist.id === vocalistId) { paint(); return; }
  if (room) await end({ quiet: true });

  starting = true;
  paint();
  try {
    const { data, error } = await sb.rpc('listen_open', { p_vocalist: vocalistId });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r?.code) throw new Error('no room');
    await enter(r.code, voc);
    toast(`Listening room open for ${voc.display_name}`);
  } catch (e) {
    report('Listen together', e);
    toast("Couldn't open the listening room", 'bad');
    room = null;
  } finally {
    starting = false;
    paint();
  }
}

/** Masuk ke sebuah ruang (baru dibuka, atau yang masih terbuka setelah halaman dimuat ulang). */
async function enter(code, voc) {
  const { data: songs, error } = await sb.rpc('listen_songs', { p_code: code });
  if (error) throw error;
  room = { code, vocalist: voc, songs: songs || [] };
  guests = []; guestInfo = {};

  ses = createSession({
    code,
    role: 'host',
    onPeers: (all) => { guests = all.filter((p) => p.role !== 'host'); paint(); },
    onReport: (r) => { guestInfo[r.from] = r; paint(); },
    onError: (e) => report('Listen together', e),
  });
  await ses.join({ name: 'Jeffry' });

  const first = playable()[0];
  if (first) load(first.id);
  paint();
}

export async function end({ quiet = false } = {}) {
  const code = room?.code;
  audio.pause();
  audio.removeAttribute('src');
  try { await ses?.leave(); } catch {}
  ses = null; songId = null; guests = []; guestInfo = {};
  room = null;
  paint();
  if (code) {
    try { await sb.rpc('listen_close', { p_code: code }); } catch (e) { report('Listen together', e); }
    if (!quiet) toast('Listening session ended');
  }
}

/** Setelah halaman dimuat ulang: sambung lagi ke ruang yang masih terbuka, kalau ada. */
export async function resume() {
  if (room) return;
  for (const v of ctx.vocalists() || []) {
    try {
      const { data } = await sb.rpc('listen_active', { p_vocalist: v.id });
      const r = Array.isArray(data) ? data[0] : data;
      if (r?.code) { await enter(r.code, v); return; }
    } catch { /* tidak ada ruang terbuka untuk vokalis ini */ }
  }
}

// ---------------------------------------------------------------- pemutar

function load(id) {
  songId = id;
  const s = song();
  if (!s || !s.has_audio) { audio.removeAttribute('src'); return paint(); }
  audio.src = `/audio/${encodeURIComponent(room.code)}/${encodeURIComponent(id)}`;
  paint();
}

async function toggle() {
  if (!audio.getAttribute('src')) return toast('Pick a song with audio first');
  if (audio.paused) {
    try { await audio.play(); } catch (e) {
      if (e?.name !== 'AbortError') { report('Listen together', e); toast("This song can't be played right now", 'bad'); }
      return;
    }
  } else audio.pause();
  announce();
}

function seekTo(frac) {
  const d = audio.duration;
  if (!Number.isFinite(d) || !d) return;
  audio.currentTime = Math.min(Math.max(0, frac), 1) * d;
  announce();
}

// ---------------------------------------------------------------- tampilan

function guestLine() {
  if (!guests.length) return `<span class="lt-wait">Waiting for ${esc(room.vocalist.display_name)} to join…</span>`;
  const names = guests.map((g) => esc(g.name || room.vocalist.display_name)).join(', ');
  const info = guests.map((g) => guestInfo[g.id]).filter(Boolean);
  if (!info.length) return `<span class="lt-on">${names} joined</span>`;
  const worst = Math.max(...info.map((i) => Math.abs(i.drift ?? 0)));
  const ready = info.every((i) => i.ready);
  if (!ready) return `<span class="lt-wait">${names} is loading the song…</span>`;
  return `<span class="lt-on">${names} · in sync within ${Math.round(worst * 1000)} ms</span>`;
}

function paint() {
  const dock = $('listenDock');
  if (!dock) return;
  if (starting && !room) {
    dock.hidden = false;
    dock.innerHTML = `<div class="lt-row"><span class="lt-wait">Opening the listening room…</span></div>`;
    return;
  }
  if (!room) { dock.hidden = true; dock.innerHTML = ''; document.body.classList.remove('has-listen'); return; }

  document.body.classList.add('has-listen');
  dock.hidden = false;
  const d = audio.duration, c = audio.currentTime || 0;
  const pct = Number.isFinite(d) && d ? (c / d) * 100 : 0;
  const list = playable();
  const s = song();

  dock.innerHTML = `
    <div class="lt-prog" data-seek${audio.getAttribute('src') ? '' : ' aria-disabled="true"'}><i style="width:${pct}%"></i></div>
    <div class="lt-row">
      <button class="lt-pp" data-act="play" aria-label="${audio.paused ? 'Play' : 'Pause'}">${audio.paused ? I.play : I.pause}</button>
      <div class="lt-mid">
        <div class="lt-title">${s ? esc(s.title) : 'No song with audio yet'}${s ? ` <span class="lt-dim">· ${esc(dateLabel(s))}</span>` : ''}</div>
        <div class="lt-sub">Listening with ${esc(room.vocalist.display_name)} · ${guestLine()}</div>
      </div>
      <span class="lt-time">${fmt(c)} / ${fmt(d)}</span>
      ${list.length > 1 ? `<select class="lt-pick" aria-label="Choose song">${
        list.map((x) => `<option value="${x.id}"${x.id === songId ? ' selected' : ''}>${esc(x.title)}</option>`).join('')
      }</select>` : ''}
      <button class="lt-end" data-act="end">End</button>
    </div>`;
}

function paintProgress() {
  const dock = $('listenDock'); if (!dock || !room) return;
  const d = audio.duration, c = audio.currentTime || 0;
  const pct = Number.isFinite(d) && d ? (c / d) * 100 : 0;
  dock.querySelector('.lt-prog i')?.style.setProperty('width', pct + '%');
  const t = dock.querySelector('.lt-time'); if (t) t.textContent = `${fmt(c)} / ${fmt(d)}`;
}

// ---------------------------------------------------------------- pemasangan

export function init(c) {
  ctx = c;
  const L = 'Listen together';

  on($('listenDock'), 'click', L, (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'play') return toggle();
    if (b.dataset.act === 'end') return end();
  });
  on($('listenDock'), 'change', L, (e) => {
    if (e.target.classList.contains('lt-pick')) load(e.target.value);
  });
  let dragging = false;
  const at = (bar, x) => { const r = bar.getBoundingClientRect(); seekTo((x - r.left) / r.width); paintProgress(); };
  on($('listenDock'), 'pointerdown', L, (e) => {
    const bar = e.target.closest('[data-seek]'); if (!bar || !audio.getAttribute('src')) return;
    dragging = true; bar.setPointerCapture?.(e.pointerId); at(bar, e.clientX);
  });
  on($('listenDock'), 'pointermove', L, (e) => {
    if (!dragging) return; const bar = $('listenDock').querySelector('[data-seek]'); if (bar) at(bar, e.clientX);
  });
  on($('listenDock'), 'pointerup', L, () => { dragging = false; });
  on($('listenDock'), 'pointercancel', L, () => { dragging = false; });

  // Perubahan yang perlu dikabarkan: mulai, jeda, geser, lagu selesai.
  for (const ev of ['play', 'pause', 'seeked', 'loadedmetadata']) audio.addEventListener(ev, () => { announce(); paint(); });
  audio.addEventListener('ended', () => { announce(); paint(); });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    toast("This song can't be played right now", 'bad'); paint();
  });

  // Kalau pemutaran di sisi saya tersendat (menyangga, atau sistem menjeda), ramalan di sisi
  // vokalis jadi salah. Jadi keadaan dikabarkan ulang begitu posisi sebenarnya menyimpang.
  audio.addEventListener('timeupdate', () => {
    paintProgress();
    if (!ses || !ses.state) return;
    const predicted = targetPosition(ses.state, 0, Date.now());
    if (Number.isFinite(predicted) && Math.abs(predicted - audio.currentTime) > 0.25) announce();
  });

  // Jendela kecil untuk diperiksa dari tes (sama seperti FC_PLAYER di halaman vokalis).
  window.ADMIN_LISTEN = {
    get code() { return room?.code || null; },
    get guests() { return guests.length; },
    get pos() { return audio.currentTime || 0; },
    get playing() { return !audio.paused && !audio.ended; },
    get songId() { return songId; },
  };
}

/** Dipanggil kerangka setiap kali data dimuat ulang. */
export function render() { paint(); }
