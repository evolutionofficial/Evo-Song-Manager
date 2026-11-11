// VOKALIS — modul Listen together: sisi PENUMPANG sesi menyimak bersama.
//
// Undangan muncul sendiri ketika Jeffry membuka ruang (ditanyakan tiap 10 detik; 10 detik tidak
// terasa untuk undangan, dan cara ini tidak bisa rusak). Setelah "Join" ditekan — dan tekanan
// itu penting, karena browser hanya mengizinkan suara dimulai oleh tindakan orang — lagunya
// diputar dari file aslinya sendiri, bukan dikirim dari komputer Jeffry. Jadi yang terdengar
// sama jernihnya dengan memutar lagu itu sendirian.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';
import { esc } from '/js/core/format.js';
import { createSession, targetPosition, correction } from '/js/core/listen.js';
import { createVoice } from '/js/core/voice.js';

const POLL_MS = 10_000;     // seberapa sering menanyakan undangan
const FOLLOW_MS = 250;      // seberapa sering memeriksa keserempakan
const TELL_MS = 2000;       // seberapa sering mengabari pemimpin

let rep, ctx;
let invite = null;          // { code, expires_at } — ruang yang sedang terbuka
let ses = null;             // sesi yang sudah diikuti
let follow = null, tell = null, poll = null;
let joining = false;
let lastDrift = 0, lastReady = false;
let ended = false;          // sesi baru saja berakhir → tampilkan keterangannya sebentar
let voice = null, vState = 'idle', vInfo = {}, qTimer = null, remoteStream = null;

const player = () => ctx?.player?.() || null;

// Elemen suara/gambar panggilan dibuat sekali dan TIDAK ikut digambar ulang: kalau ia berada di
// dalam innerHTML spanduk, setiap gambar-ulang memutus srcObject dan panggilan terdengar putus.
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
  const ls = voice?.localStream || null;
  l.srcObject = ls;
  box.hidden = !remoteStream;
  box.classList.toggle('audio-only', !remoteStream?.getVideoTracks?.().length);
  l.hidden = !ls?.getVideoTracks?.().length;
  if (remoteStream) v.play?.().catch(() => {});
}

// ---------------------------------------------------------------- undangan

async function check() {
  if (document.hidden) return;
  try {
    const { data, error } = await sb.rpc('listen_room_for', { p_token: rep.token || '' });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;

    if (ses && (!r || r.code !== ses.code)) return leave({ byHost: true });   // ruang ditutup Jeffry
    if (!ses) {
      const changed = (invite?.code || null) !== (r?.code || null);
      invite = r || null;
      if (changed) { ended = false; paint(); }
    }
  } catch (e) {
    // Gangguan jaringan sesaat bukan berarti sesinya berakhir — diamkan, coba lagi nanti.
    report('Listen together', e);
  }
}

// ---------------------------------------------------------------- ikut & keluar

async function join() {
  if (joining || ses || !invite) return;
  const p = player();
  if (!p?.mounted) return toast('The player is still loading, try again in a moment', 'bad');

  joining = true; paint();
  const code = invite.code;
  try {
    ses = createSession({
      code,
      role: 'guest',
      onState: apply,
      onClock: () => paint(),
      onSignal: (ev, pl) => voice?.handle(ev, pl),
      onError: (e) => report('Listen together', e),
    });
    await ses.join({ name: rep.name });

    // Panggilan suara terpisah dari musik: kalau panggilannya gagal, musiknya tetap serempak.
    voice = createVoice({
      session: ses,
      role: 'guest',
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

    p.lock(true);
    follow = setInterval(step, FOLLOW_MS);
    tell = setInterval(() => ses?.report({ ready: lastReady, drift: lastDrift }), TELL_MS);
    toast('Listening together with Jeffry');
  } catch (e) {
    report('Listen together', e);
    toast("Couldn't join the listening session", 'bad');
    ses = null;
  } finally {
    joining = false; paint();
  }
}

async function leave({ byHost = false } = {}) {
  clearInterval(follow); clearInterval(tell); clearInterval(qTimer); follow = tell = qTimer = null;
  try { voice?.hangUp(); } catch {}
  voice = null; vState = 'idle'; vInfo = {};
  attachRemote(null);
  const s = ses; ses = null;
  try { await s?.leave(); } catch {}
  player()?.stop();
  invite = null; lastReady = false; lastDrift = 0;
  ended = byHost;
  paint();
  if (byHost) toast('Jeffry ended the listening session');
}

// ---------------------------------------------------------------- mengikuti pemimpin

/** Keadaan baru dari pemimpin: pindah lagu / mulai / jeda sekarang. */
async function apply(state, offset) {
  const p = player();
  if (!p || !state) return;
  const target = targetPosition(state, offset, Date.now());
  const r = await p.goto(state.songId, target, state.playing);
  if (!r.ok && r.reason === 'noaudio') toast("That song has no audio on your side yet", 'bad');
  paint();
}

/** Tiap 250 ms: masih serempak? Selisih kecil dikejar halus, selisih besar dilompati. */
function step() {
  const p = player(), st = ses?.state, off = ses?.offset;
  if (!p || !st || off === null || off === undefined) return;

  const info = p.info();
  if (info.songId !== st.songId) { apply(st, off); return; }

  lastReady = info.ready;
  if (!st.playing || !info.ready) { p.rate(1); lastDrift = 0; return paint(); }

  const target = targetPosition(st, off, Date.now());
  const err = target - info.pos;           // positif = kita ketinggalan
  lastDrift = err;

  const c = correction(err);
  if (c.seek) p.goto(st.songId, target, true);
  else p.rate(c.rate);
  paint();
}

// ---------------------------------------------------------------- tampilan

/** Baris panggilan di dalam spanduk. */
function callRow() {
  if (vState === 'idle') {
    return `<div class="lb-call">
      <button class="lb-cbtn go" data-act="call">Call Jeffry</button>
      <span class="sub">Use headphones, or your microphone will send the music back and it will echo.</span>
    </div>`;
  }
  if (vState === 'asking') return `<div class="lb-call"><span class="lt-wait">Allow the microphone…</span></div>`;
  if (vState === 'ringing') {
    return `<div class="lb-call">
      <span class="lt-wait">Jeffry is calling</span>
      <button class="lb-cbtn go" data-act="call">Answer</button>
      <button class="lb-cbtn" data-act="hang">Decline</button>
    </div>`;
  }
  if (vState === 'calling') {
    return `<div class="lb-call"><span class="lt-wait">Ringing…</span>
      <button class="lb-cbtn" data-act="hang">Cancel</button></div>`;
  }
  if (vState === 'failed') {
    const why = vInfo.note === 'mic_denied' ? 'Your microphone is blocked in this browser.'
      : vInfo.note === 'insecure' ? 'The microphone needs a secure (https) connection.'
      : vInfo.note === 'unsupported' ? "This browser can't use the microphone."
      : "The call couldn't connect.";
    return `<div class="lb-call">
      <span class="lt-bad">${esc(why)} Call on WhatsApp instead — the music stays in sync either way.</span>
      <button class="lb-cbtn" data-act="call">Try again</button>
      <button class="lb-cbtn" data-act="hang">Dismiss</button>
    </div>`;
  }
  const q = vState === 'live'
    ? `Talking with Jeffry${Number.isFinite(vInfo.rtt) ? ` · ${vInfo.rtt} ms` : ''}`
    : 'Connecting the call…';
  return `<div class="lb-call">
    <span class="${vState === 'live' ? 'lt-on' : 'lt-wait'}">${esc(q)}</span>
    <button class="lb-cbtn${voice?.muted ? ' off' : ''}" data-act="mute">${voice?.muted ? 'Unmute' : 'Mute'}</button>
    <button class="lb-cbtn${vInfo.video ? ' on' : ''}" data-act="cam">${vInfo.video ? 'Camera off' : 'Camera on'}</button>
    <button class="lb-cbtn bad" data-act="hang">Hang up</button>
  </div>`;
}

function paint() {
  const el = $('listenBanner');
  if (!el) return;

  if (ses) {
    const ms = Math.round(Math.abs(lastDrift) * 1000);
    const sync = !ses.ready ? 'matching our clocks…'
      : !lastReady ? 'loading the song…'
      : `in sync within ${ms} ms`;
    el.hidden = false;
    el.className = 'panel listen-banner on';
    el.innerHTML = `<div class="lb-main">
        <b>Listening together with Jeffry</b>
        <span class="sub">Jeffry is leading play and pause. Your music is playing from your own copy, so it stays full quality — ${sync}</span>
        ${callRow()}
      </div>
      <button class="lb-leave" data-act="leave">Leave</button>`;
    return;
  }

  if (invite) {
    el.hidden = false;
    el.className = 'panel listen-banner';
    el.innerHTML = `<div class="lb-main">
        <b>Jeffry wants to listen with you</b>
        <span class="sub">You'll both hear the same song at the same moment, at full quality. Give him a call on WhatsApp to talk while you listen.</span>
      </div>
      <button class="lb-join" data-act="join"${joining ? ' disabled' : ''}>${joining ? 'Joining…' : 'Join'}</button>`;
    return;
  }

  if (ended) {
    el.hidden = false;
    el.className = 'panel listen-banner';
    el.innerHTML = `<div class="lb-main"><b>The listening session has ended</b>
      <span class="sub">You can keep playing your songs as usual.</span></div>
      <button class="lb-leave" data-act="dismiss">OK</button>`;
    return;
  }

  el.hidden = true;
  el.innerHTML = '';
}

// ---------------------------------------------------------------- pemasangan

export function mount(rep_, ctx_) {
  rep = rep_; ctx = ctx_;

  on($('listenBanner'), 'click', 'Listen together', (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'join') return join();
    if (b.dataset.act === 'leave') return leave();
    if (b.dataset.act === 'call') return voice?.call({ video: false });
    if (b.dataset.act === 'hang') return voice?.hangUp();
    if (b.dataset.act === 'mute') return voice?.setMuted(!voice.muted);
    if (b.dataset.act === 'cam') return voice?.setCamera(!vInfo.video).then(() => attachRemote(remoteStream));
    if (b.dataset.act === 'dismiss') { ended = false; paint(); }
  });

  check();
  poll = setInterval(check, POLL_MS);
  // Saat halaman kembali dibuka, tanya sekarang — jangan menunggu sampai 10 detik berikutnya.
  on(document, 'visibilitychange', 'Listen together', () => { if (!document.hidden) check(); });
  // Tutup halaman di tengah sesi → keluar dengan rapi, jangan menggantung.
  on(window, 'pagehide', 'Listen together', () => { if (ses) ses.leave().catch(() => {}); });

  window.FC_LISTEN = {
    get joined() { return !!ses; },
    get drift() { return lastDrift; },
    get invite() { return invite?.code || null; },
    get pos() { return player()?.info().pos ?? null; },
    get songId() { return player()?.info().songId ?? null; },
    get ready() { return lastReady; },
    get call() { return vState; },
    get callInfo() { return vInfo; },
    get callDebug() { return voice?.debug || null; },
  };
}
