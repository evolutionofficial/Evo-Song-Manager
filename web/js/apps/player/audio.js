// PLAYER (halaman cadangan /v/<kode>/play/<n>) — mesin audio sederhana.
// Audio M4A dialirkan dari /audio/<token>/<idLagu>; lagu tanpa M4A → "No audio yet".
import { toast } from '/js/core/ui.js';

function setNav(a, url) {
  if (url) a.href = url;
  else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.style.opacity = '.35'; a.style.pointerEvents = 'none'; }
}
const fmt = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}` : '–:––');

export function mount(player) {
  setNav(document.getElementById('prev'), player.prevUrl);
  setNav(document.getElementById('next'), player.nextUrl);
  const btn = document.getElementById('playBtn');
  const soon = document.getElementById('soon');
  const fill = document.getElementById('pFill');
  const times = document.querySelectorAll('.p-times span');
  const s = player.song;
  if (!s.audio || !player.token) {
    btn.disabled = true;
    btn.title = 'No audio yet';
    soon.textContent = 'No audio yet for this song.';
    return;
  }
  soon.hidden = true;
  const audio = new Audio(`/audio/${encodeURIComponent(player.token)}/${encodeURIComponent(s.id)}?v=${encodeURIComponent(s.audio)}`);
  audio.preload = 'metadata';
  const paint = () => {
    const d = audio.duration, c = audio.currentTime || 0;
    fill.style.width = (Number.isFinite(d) && d ? (c / d) * 100 : 0) + '%';
    if (times.length > 1) { times[0].textContent = fmt(c); times[1].textContent = fmt(d); }
    btn.textContent = audio.paused ? '▶' : '❚❚';
    btn.setAttribute('aria-label', audio.paused ? 'Play' : 'Pause');
  };
  for (const ev of ['timeupdate', 'loadedmetadata', 'play', 'pause', 'ended']) audio.addEventListener(ev, paint);
  audio.addEventListener('ended', () => { if (player.nextUrl) location.href = player.nextUrl; });
  btn.addEventListener('click', async () => {
    if (!audio.paused) return audio.pause();
    try { await audio.play(); } catch (_) { toast("This song can't be played right now", 'bad'); }
  });
  const bar = fill.parentElement;
  bar.style.cursor = 'pointer';
  bar.addEventListener('click', (e) => {
    const r = bar.getBoundingClientRect();
    if (Number.isFinite(audio.duration)) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
}
