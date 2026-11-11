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
import { createSession, targetPosition, correction } from '/js/core/listen.js';

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

const player = () => ctx?.player?.() || null;

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
      onError: (e) => report('Listen together', e),
    });
    ses.code = code;
    await ses.join({ name: rep.name });

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
  clearInterval(follow); clearInterval(tell); follow = tell = null;
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
  };
}
