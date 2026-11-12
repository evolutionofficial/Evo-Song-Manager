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
import { createVoice } from '/js/core/voice.js';

const I = {
  call: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M6.6 10.8c1.4 2.8 3.8 5.1 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1-9.4 0-17-7.6-17-17 0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1l-2.2 2.3z"/></svg>',
  hang: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 9c-1.6 0-3.1.3-4.5.7v3c0 .4-.2.7-.6.9-.9.4-1.7 1-2.4 1.7-.2.2-.4.3-.7.3s-.5-.1-.7-.3L.3 12.7a.9.9 0 0 1-.3-.7c0-.3.1-.5.3-.7C3.3 8.6 7.4 7 12 7s8.7 1.6 11.7 4.3c.2.2.3.4.3.7s-.1.5-.3.7l-2.8 2.6c-.2.2-.4.3-.7.3s-.5-.1-.7-.3a9.6 9.6 0 0 0-2.4-1.7c-.4-.2-.6-.5-.6-.9v-3C15.1 9.3 13.6 9 12 9z"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V22h2v-3.1A7 7 0 0 0 19 12h-2z"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M15 11.2V6a3 3 0 0 0-5.9-.7L15 11.2zM19 12h-2a5 5 0 0 1-.6 2.4l1.5 1.5A7 7 0 0 0 19 12zM3.3 2 2 3.3l7 7V12a3 3 0 0 0 4.4 2.7l1.3 1.3A5 5 0 0 1 7 12H5a7 7 0 0 0 6 6.9V22h2v-3.1c.8-.1 1.6-.4 2.3-.8l4.4 4.4 1.3-1.3L3.3 2z"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M16 10.5V7a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l6 3.5v-10l-6 3.5z"/></svg>',
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
let voice = null;     // panggilan suara; null berarti belum pernah ada sesi
let vState = 'idle';
let vInfo = {};
let qTimer = null;    // mutu sambungan, dibaca berkala untuk ditampilkan apa adanya
let remoteStream = null;

const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

// Elemen suara/gambar panggilan dibuat sekali di luar dok. Kalau ia ikut di dalam innerHTML
// dok, setiap gambar-ulang akan memutus srcObject dan panggilan terdengar putus-putus.
let media = null;
function mediaEl() {
  if (media) return media;
  media = document.createElement('div');
  media.className = 'call-media';
  media.hidden = true;
  media.innerHTML = `<video class="cm-remote" autoplay playsinline></video>
    <video class="cm-local" autoplay playsinline muted></video>`;
  document.body.appendChild(media);
  return media;
}

function attachRemote(stream) {
  remoteStream = stream || null;
  const box = mediaEl();
  const v = box.querySelector('.cm-remote');
  const l = box.querySelector('.cm-local');
  v.srcObject = remoteStream;
  const localStream = voice?.localStream || null;
  l.srcObject = localStream;
  const theirVideo = !!remoteStream?.getVideoTracks?.().length;
  const myVideo = !!localStream?.getVideoTracks?.().length;
  // Tanpa gambar, elemennya tetap ada (itu yang membawa SUARA), hanya tidak ditampilkan.
  box.hidden = !remoteStream;
  box.classList.toggle('audio-only', !theirVideo);
  l.hidden = !myVideo;
  if (remoteStream) v.play?.().catch(() => {});
}
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
  // Pemutar biasa di admin dihentikan: selama menyimak bersama, hanya dok ini yang boleh bersuara.
  window.dispatchEvent(new Event('admin:listen-start'));

  ses = createSession({
    code,
    role: 'host',
    onPeers: (all) => { guests = all.filter((p) => p.role !== 'host'); paint(); },
    onReport: (r) => { guestInfo[r.from] = r; paint(); },
    onSignal: (ev, p) => voice?.handle(ev, p),
    onError: (e) => report('Listen together', e),
  });
  await ses.join({ name: 'Jeffry' });

  // Panggilan suara dibuat terpisah dari musik: kalau panggilannya gagal, musiknya tetap jalan.
  voice = createVoice({
    session: ses,
    role: 'host',
    onState: (st, inf) => { vState = st; vInfo = inf || {}; paint(); },
    onRemote: (stream) => attachRemote(stream),
    onError: (e) => report('Voice call', e),
  });
  clearInterval(qTimer);
  qTimer = setInterval(async () => {
    if (vState !== 'live') return;
    const q = await voice?.quality();
    if (q) { vInfo = { ...vInfo, ...q }; paint(); }
  }, 4000);

  const first = playable()[0];
  if (first) load(first.id);
  paint();
}

export async function end({ quiet = false } = {}) {
  const code = room?.code;
  audio.pause();
  audio.removeAttribute('src');
  clearInterval(qTimer); qTimer = null;
  try { voice?.hangUp(); } catch {}
  voice = null; vState = 'idle'; vInfo = {};
  attachRemote(null);
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

/** Baris panggilan. Hanya muncul kalau vokalisnya sudah ikut — memanggil ruang kosong tidak ada gunanya. */
function callRow() {
  if (!guests.length && vState === 'idle') return '';
  const relayWarn = vInfo.relay === false && (vState === 'calling' || vState === 'connecting' || vState === 'failed');

  if (vState === 'idle') {
    return `<div class="lt-call">
      <button class="lt-cbtn go" data-act="call" title="Talk while you listen">${I.call} Call</button>
      <span class="sub">Use headphones, or your microphone will send the music back and it will echo.</span>
    </div>`;
  }
  if (vState === 'asking') return `<div class="lt-call"><span class="lt-wait">Allow the microphone…</span></div>`;
  if (vState === 'calling' || vState === 'ringing') {
    return `<div class="lt-call">
      <span class="lt-wait">${vState === 'calling' ? 'Ringing…' : `${esc(room.vocalist.display_name)} is calling`}</span>
      ${vState === 'ringing' ? `<button class="lt-cbtn go" data-act="call">${I.call} Answer</button>` : ''}
      <button class="lt-cbtn" data-act="hang">${I.hang} Cancel</button>
      ${relayWarn ? `<span class="sub">Relay isn't set up yet, so this may not connect on mobile data.</span>` : ''}
    </div>`;
  }
  if (vState === 'failed') {
    const why = vInfo.note === 'mic_denied' ? 'The microphone was blocked in this browser.'
      : vInfo.note === 'insecure' ? 'The microphone needs a secure (https) connection.'
      : vInfo.note === 'unsupported' ? "This browser can't use the microphone."
      : vInfo.note === 'no_relay' ? "Couldn't connect, and the relay server isn't set up yet."
      : "Couldn't connect — the networks in between wouldn't allow it.";
    return `<div class="lt-call">
      <span class="lt-bad">${esc(why)} Call on WhatsApp instead; the music stays in sync either way.</span>
      <button class="lt-cbtn" data-act="call">Try again</button>
      <button class="lt-cbtn" data-act="hang">Dismiss</button>
    </div>`;
  }
  // connecting / live
  const q = vState === 'live'
    ? `talking${Number.isFinite(vInfo.rtt) ? ` · ${vInfo.rtt} ms` : ''}${vInfo.relay ? ' · via relay' : ''}`
    : 'connecting…';
  return `<div class="lt-call">
    <span class="${vState === 'live' ? 'lt-on' : 'lt-wait'}">${esc(q)}</span>
    <button class="lt-cbtn${voice?.muted ? ' off' : ''}" data-act="mute" title="${voice?.muted ? 'Unmute' : 'Mute'}">${voice?.muted ? I.micOff : I.mic}</button>
    <button class="lt-cbtn${vInfo.video ? ' on' : ''}" data-act="cam" title="${vInfo.video ? 'Turn camera off' : 'Turn camera on'}">${I.cam}</button>
    <button class="lt-cbtn bad" data-act="hang">${I.hang} Hang up</button>
  </div>`;
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
    </div>
    ${callRow()}`;
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
    if (b.dataset.act === 'call') return voice?.call({ video: false });
    if (b.dataset.act === 'hang') return voice?.hangUp();
    if (b.dataset.act === 'mute') return voice?.setMuted(!voice.muted);
    if (b.dataset.act === 'cam') {
      // Setelah kamera dinyalakan/dimatikan, pratinjau lokal perlu dipasang ulang.
      return voice?.setCamera(!vInfo.video).then(() => attachRemote(remoteStream));
    }
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
    get call() { return vState; },
    get callInfo() { return vInfo; },
    get callDebug() { return voice?.debug || null; },
  };
}

/** Dipanggil kerangka setiap kali data dimuat ulang. */
export function render() { paint(); }
