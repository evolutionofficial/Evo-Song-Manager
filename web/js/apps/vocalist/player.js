// VOKALIS — modul Player: bar pemutar di bawah (seperti Spotify) + tampilan player penuh.
//
// Alur: tombol ▶ di Songlist → event 'fc:play' → bar bawah muncul. Klik di mana saja pada bar
// (kecuali tombol & volume) → tampilan penuh terbuka dari bawah. Tombol ⌄ / Esc / tombol Back HP
// menutupnya kembali.
//
// Audio: file M4A di Cloudflare R2, dialirkan lewat /audio/<token>/<idLagu> (endpoint itu
// memeriksa bahwa lagu memang milik pemegang link). Lagu tanpa M4A → "No audio yet".
// Semua yang berhubungan dengan suara ada di bagian ENGINE di bawah.
import { toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';
import { esc, dateLabel } from '/js/core/format.js';
import { photoUrl } from '/js/core/config.js';

const I = {
  play: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>',
  prev: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="5" y="5" width="2.6" height="14" rx="1"/><path d="M19 6.2v11.6a1 1 0 0 1-1.55.83L9.2 13a1.2 1.2 0 0 1 0-2l8.25-5.63A1 1 0 0 1 19 6.2z"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><rect x="16.4" y="5" width="2.6" height="14" rx="1"/><path d="M5 6.2v11.6a1 1 0 0 0 1.55.83L14.8 13a1.2 1.2 0 0 0 0-2L6.55 5.37A1 1 0 0 0 5 6.2z"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h4v4"/><path d="M4 20 20 4"/><path d="M20 16v4h-4"/><path d="M15 15l5 5"/><path d="M4 4l5 5"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/></svg>',
  vol: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>',
  mute: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

let rep, songs, order, el;
const st = { n: 0, playing: false, shuffle: false, repeat: false, volume: 0.8, muted: false, open: false };

const store = {
  get(k, d) { try { const v = localStorage.getItem('fc.player.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('fc.player.' + k, JSON.stringify(v)); } catch {} },
};

const cur = () => songs[st.n - 1];
const initials = (t) => {
  const w = String(t).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '♪').slice(0, 2)).toUpperCase();
};
// Cover: foto vokalis kalau ada, kalau tidak inisial judul lagu.
const cover = (s) => { const u = photoUrl(rep.photo); return u ? `<img src="${esc(u)}" alt="" draggable="false">` : esc(initials(s.title)); };
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

// =================== ENGINE (satu-satunya bagian yang menyentuh suara) ===================
const audio = new Audio();
audio.preload = 'metadata';

// iPhone/iPad: Safari tidak mengizinkan web mengubah audio.volume (selalu 1). Di perangkat seperti
// itu slider volume disembunyikan — volume diatur dari tombol HP; tombol mute tetap ada.
// Deteksi: (1) jenis perangkat iPhone/iPad/iPod (termasuk iPad yang mengaku "Macintosh"),
// atau (2) browser yang menolak perubahan volume.
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const volumeLocked = isIOS || (() => { try { const a = new Audio(); a.volume = 0.5; return a.volume !== 0.5; } catch { return false; } })();

/** URL audio untuk sebuah lagu, atau null kalau lagu ini belum punya M4A.
 *  ?v= berubah setiap ada file audio baru (revisi), supaya browser tidak memakai cache lama. */
function audioUrl(song) {
  if (!song || !song.audio || !rep.token) return null;
  return `/audio/${encodeURIComponent(rep.token)}/${encodeURIComponent(song.id)}?v=${encodeURIComponent(song.audio)}`;
}
const hasAudio = (song) => !!audioUrl(song);

function engineLoad(song) {
  const url = audioUrl(song);
  if (url) { audio.src = url; return true; }
  audio.removeAttribute('src');
  return false;
}
async function enginePlay() {
  if (!audio.src) { toast('No audio yet for this song'); return false; }
  try { await audio.play(); return true; } catch (e) {
    if (e && e.name === 'AbortError') return false; // diganti lagu lain sebelum mulai — normal
    report('Player:play', e); toast("This song can't be played right now", 'bad'); return false;
  }
}
function engineSeek(frac) {
  const d = audio.duration;
  if (!Number.isFinite(d) || !d) return;
  audio.currentTime = Math.min(Math.max(0, frac), 1) * d;
}
function enginePause() { audio.pause(); }
function engineVolume() { if (!volumeLocked) audio.volume = st.volume; audio.muted = st.muted; }
// =========================================================================================

function select(n, autoplay) {
  if (!songs.length) return;
  st.n = Math.min(Math.max(1, n), songs.length);
  st.playing = false;
  const has = engineLoad(cur());
  render();
  window.dispatchEvent(new CustomEvent('fc:track', { detail: { n: st.n } }));
  if ('mediaSession' in navigator && cur()) {
    try { const art = photoUrl(rep.photo);
      navigator.mediaSession.metadata = new MediaMetadata({ title: cur().title, artist: rep.name, album: 'First Club',
        artwork: art ? [{ src: art, sizes: '640x640', type: 'image/jpeg' }] : [] }); } catch {}
  }
  if (autoplay) togglePlay(has);
}

async function togglePlay(has = !!audio.src) {
  if (st.playing) { enginePause(); st.playing = false; return render(); }
  if (!has) { toast('No audio yet for this song'); return; }
  st.playing = await enginePlay();
  render();
}

// Urutan antrean = urutan di Songlist (terbaru di atas). "Berikutnya" = lagu di bawahnya.
const pos = () => order.findIndex((x) => x.n === st.n);
const isFirst = () => pos() <= 0;
const isLast = () => pos() >= order.length - 1;

function step(dir) {
  if (st.shuffle && order.length > 1) {
    let r; do { r = order[Math.floor(Math.random() * order.length)].n; } while (r === st.n);
    return select(r, st.playing);
  }
  let i = pos() + dir;
  if (i < 0) i = st.repeat ? order.length - 1 : 0;
  if (i > order.length - 1) i = st.repeat ? 0 : order.length - 1;
  select(order[i].n, st.playing);
}

// Setelah lagu selesai: lanjut ke lagu berikutnya YANG PUNYA AUDIO (lewati yang belum ada).
function advance() {
  const cand = [];
  for (let k = 1; k < order.length; k++) {
    const i = pos() + k;
    if (i > order.length - 1 && !st.repeat) break;
    cand.push(order[i % order.length]);
  }
  const pool = st.shuffle ? order.filter((x) => x.n !== st.n && hasAudio(x)) : cand.filter(hasAudio);
  if (!pool.length) { st.playing = false; return render(); }
  const nxt = st.shuffle ? pool[Math.floor(Math.random() * pool.length)] : pool[0];
  select(nxt.n, true);
}

// ---------- Tampilan ----------
function controls(size) {
  const pp = st.playing ? I.pause : I.play;
  const noAudio = !audio.src;
  const label = st.playing ? 'Pause' : 'Play';
  return `
    ${size === 'full' ? `<button class="pc tog ${st.shuffle ? 'on' : ''}" data-act="shuffle" aria-pressed="${st.shuffle}" aria-label="Shuffle">${I.shuffle}</button>` : ''}
    <button class="pc" data-act="prev" aria-label="Previous" ${isFirst() && !st.repeat && !st.shuffle ? 'disabled' : ''}>${I.prev}</button>
    <button class="pc pp ${noAudio ? 'soon' : ''}" data-act="play" aria-label="${label}" title="${noAudio ? 'No audio yet' : label}">${pp}</button>
    <button class="pc" data-act="next" aria-label="Next" ${isLast() && !st.repeat && !st.shuffle ? 'disabled' : ''}>${I.next}</button>
    ${size === 'full' ? `<button class="pc tog ${st.repeat ? 'on' : ''}" data-act="repeat" aria-pressed="${st.repeat}" aria-label="Repeat">${I.repeat}</button>` : ''}`;
}
function volume() {
  const v = st.muted ? 0 : st.volume;
  const icon = st.muted || (!volumeLocked && !st.volume) ? I.mute : I.vol;
  return `<div class="pvol ${volumeLocked ? 'novol' : ''}"><button class="pc sm" data-act="mute" aria-label="${st.muted ? 'Unmute' : 'Mute'}">${icon}</button>
    ${volumeLocked ? '' : `<input type="range" min="0" max="100" value="${Math.round(v * 100)}" data-act="vol" aria-label="Volume" style="--v:${Math.round(v * 100)}%">`}</div>`;
}
function progress() {
  const d = audio.duration, c = audio.currentTime || 0;
  const pct = Number.isFinite(d) && d ? (c / d) * 100 : 0;
  return { pct, cur: fmt(c), dur: Number.isFinite(d) ? fmt(d) : '–:––' };
}

function render() {
  const s = cur(); if (!s) return;
  const p = progress();
  document.body.classList.add('has-player');
  document.body.classList.toggle('is-playing', st.playing);
  el.bar.hidden = false;
  el.bar.innerHTML = `
    <div class="mb-prog"><i style="width:${p.pct}%"></i></div>
    <div class="mb-art ${rep.photo ? 'photo' : ''}" aria-hidden="true">${cover(s)}</div>
    <div class="mb-info"><div class="mb-title">${esc(s.title)}</div><div class="mb-sub">${esc(rep.name)} · ${esc(dateLabel(s))}</div></div>
    <div class="mb-ctrls">${controls('mini')}</div>
    <div class="mb-vol">${volume()}</div>`;
  el.sheet.innerHTML = `
    <div class="fp-head">
      <button class="pc" data-act="close" aria-label="Close player">${I.down}</button>
      <div class="fp-from">Playing from<b>My songs · ${esc(rep.name)}</b></div>
      <span style="width:40px"></span>
    </div>
    <div class="fp-body">
      <div class="cover fp-cover ${rep.photo ? 'photo' : ''}" aria-hidden="true">${cover(s)}</div>
      <div class="fp-meta"><h2 class="p-title">${esc(s.title)}</h2><p class="p-sub">${esc(rep.name)} · ${esc(dateLabel(s))}</p></div>
      <div class="fp-prog"><div class="p-bar ${audio.src ? 'seek' : ''}" data-seek role="slider" tabindex="${audio.src ? 0 : -1}" aria-label="Position" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(p.pct)}"><div class="p-fill" style="width:${p.pct}%"></div><i class="p-knob" style="left:${p.pct}%"></i></div>
        <div class="p-times"><span>${p.cur}</span><span>${p.dur}</span></div></div>
      <div class="fp-ctrls">${controls('full')}</div>
      <div class="fp-vol">${volume()}</div>
      ${audio.src ? '' : '<p class="p-soon">No audio yet for this song.</p>'}
      <section class="p-queue"><h2>Queue · ${songs.length} songs</h2><div class="table">
        ${order.map((x) => `<button class="row qrow ${x.n === st.n ? 'cur' : ''}" data-q="${x.n}"><span class="no">${x.n === st.n ? '▶' : x.n}</span><span class="title">${esc(x.title)}</span>${hasAudio(x) ? '' : '<span class="noaudio">No audio yet</span>'}</button>`).join('')}
      </div></section>
    </div>`;
}

function setOpen(open, fromHistory) {
  if (open === st.open) return;
  st.open = open;
  el.sheet.classList.toggle('open', open);
  el.sheet.setAttribute('aria-hidden', String(!open));
  document.documentElement.classList.toggle('player-open', open);
  if (open) {
    if (!fromHistory) history.pushState({ fcPlayer: true }, '');
    el.sheet.scrollTop = 0;
    el.sheet.querySelector('[data-act=close]')?.focus({ preventScroll: true });
  } else if (!fromHistory && history.state?.fcPlayer) {
    history.back();
  }
}

function act(name, target) {
  switch (name) {
    case 'play': return togglePlay();
    case 'prev': return step(-1);
    case 'next': return step(1);
    case 'shuffle': st.shuffle = !st.shuffle; store.set('shuffle', st.shuffle); return render();
    case 'repeat': st.repeat = !st.repeat; store.set('repeat', st.repeat); return render();
    case 'mute': st.muted = !st.muted; engineVolume(); store.set('muted', st.muted); return render();
    case 'close': return setOpen(false);
    default: return undefined;
  }
}

function onVol(input) {
  st.volume = Number(input.value) / 100;
  st.muted = st.volume === 0;
  input.style.setProperty('--v', input.value + '%');
  engineVolume();
  store.set('volume', st.volume); store.set('muted', st.muted);
  // sinkronkan slider lain (bar ↔ penuh) tanpa render ulang supaya geseran tidak terputus
  document.querySelectorAll('input[data-act=vol]').forEach((x) => { if (x !== input) { x.value = input.value; x.style.setProperty('--v', input.value + '%'); } });
}

export function mount(report_) {
  rep = report_;
  songs = rep.songs.map((s, i) => ({ ...s, n: i + 1 }));
  order = songs.slice().reverse();
  st.shuffle = store.get('shuffle', false);
  st.repeat = store.get('repeat', false);
  st.volume = store.get('volume', 0.8);
  st.muted = store.get('muted', false);
  engineVolume();

  const root = document.getElementById('playerBody');
  root.innerHTML = `<div class="minibar" id="miniBar" hidden role="region" aria-label="Player"></div>
    <div class="fullplayer" id="fullPlayer" aria-hidden="true" role="dialog" aria-label="Player"></div>`;
  el = { bar: root.querySelector('#miniBar'), sheet: root.querySelector('#fullPlayer') };

  const L = 'Player';
  on(el.bar, 'click', L, (e) => {
    const b = e.target.closest('[data-act]');
    if (b) { if (b.dataset.act !== 'vol') act(b.dataset.act, b); return; }
    if (e.target.closest('.mb-ctrls, .mb-vol')) return; // area tombol & volume tidak membuka player
    setOpen(true); // klik di mana saja selain tombol → buka tampilan penuh
  });
  // Geser posisi lagu: klik / seret di progress bar tampilan penuh, atau tombol panah.
  let dragging = false;
  const seekAt = (bar, clientX) => {
    const r = bar.getBoundingClientRect();
    engineSeek((clientX - r.left) / r.width);
    paintProgress();
  };
  on(el.sheet, 'pointerdown', L, (e) => {
    const bar = e.target.closest('[data-seek]'); if (!bar || !audio.src) return;
    dragging = true; bar.setPointerCapture?.(e.pointerId); seekAt(bar, e.clientX);
  });
  on(el.sheet, 'pointermove', L, (e) => { if (dragging) { const bar = el.sheet.querySelector('[data-seek]'); if (bar) seekAt(bar, e.clientX); } });
  on(el.sheet, 'pointerup', L, () => { dragging = false; });
  on(el.sheet, 'pointercancel', L, () => { dragging = false; });
  on(el.sheet, 'keydown', L, (e) => {
    if (!e.target.matches('[data-seek]') || !Number.isFinite(audio.duration)) return;
    if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
  });
  on(el.sheet, 'click', L, (e) => {
    const q = e.target.closest('[data-q]'); if (q) return select(Number(q.dataset.q), st.playing);
    const b = e.target.closest('[data-act]'); if (b && b.dataset.act !== 'vol') act(b.dataset.act, b);
  });
  on(root, 'input', L, (e) => { if (e.target.dataset.act === 'vol') onVol(e.target); });
  on(window, 'fc:play', L, (e) => {
    const n = e.detail.n;
    if (n === st.n && cur()) return togglePlay();
    select(n, true);
  });
  on(window, 'popstate', L, () => { if (st.open) setOpen(false, true); });
  on(document, 'keydown', L, (e) => {
    if (e.key === 'Escape' && st.open) setOpen(false);
    if (e.code === 'Space' && cur() && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(e.target.tagName)) { e.preventDefault(); togglePlay(); }
  });

  function paintProgress() {
    const p = progress();
    el.bar.querySelector('.mb-prog i')?.style.setProperty('width', p.pct + '%');
    const f = el.sheet.querySelector('.p-fill'); if (f) f.style.width = p.pct + '%';
    const k = el.sheet.querySelector('.p-knob'); if (k) k.style.left = p.pct + '%';
    el.sheet.querySelector('[data-seek]')?.setAttribute('aria-valuenow', String(Math.round(p.pct)));
    const t = el.sheet.querySelectorAll('.p-times span'); if (t.length) { t[0].textContent = p.cur; t[1].textContent = p.dur; }
    if ('mediaSession' in navigator && navigator.mediaSession.setPositionState && Number.isFinite(audio.duration) && audio.duration) {
      try { navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch {}
    }
  }
  for (const ev of ['timeupdate', 'loadedmetadata', 'durationchange', 'seeked']) audio.addEventListener(ev, paintProgress);
  audio.addEventListener('ended', () => { st.playing = false; if (!isLast() || st.repeat || st.shuffle) advance(); else render(); });
  // Diputar/dijeda dari luar (tombol di lock screen, headset) → samakan tampilan.
  audio.addEventListener('play', () => { if (!st.playing) { st.playing = true; render(); } });
  audio.addEventListener('pause', () => { if (st.playing && !audio.ended) { st.playing = false; render(); } });
  audio.addEventListener('error', () => {
    if (!audio.getAttribute('src')) return;
    st.playing = false; render();
    toast("This song can't be played right now", 'bad');
  });

  if ('mediaSession' in navigator) {
    try {
      navigator.mediaSession.setActionHandler('previoustrack', () => step(-1));
      navigator.mediaSession.setActionHandler('nexttrack', () => step(1));
      navigator.mediaSession.setActionHandler('play', () => { if (!st.playing) togglePlay(); });
      navigator.mediaSession.setActionHandler('pause', () => { if (st.playing) togglePlay(); });
      navigator.mediaSession.setActionHandler('seekto', (d) => { if (Number.isFinite(d.seekTime)) audio.currentTime = d.seekTime; });
    } catch {}
  }

  window.FC_PLAYER = { ready: true, volumeSlider: !volumeLocked };
}
