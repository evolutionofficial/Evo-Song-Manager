// PLAYER — kerangka halaman Media Player: memuat laporan vokalis, menentukan lagu yang dipilih,
// lalu menyerahkan ke modul Audio (mesin putar) dan Antrean. Modul tidak saling mengimpor.
import { sb } from '/js/core/supabase.js';
import { $ } from '/js/core/ui.js';
import { safe, loadModules, installGlobalHandlers, report } from '/js/core/guard.js';
import { esc, dateLabel } from '/js/core/format.js';

installGlobalHandlers();

const MODULES = [
  { key: 'audio', label: 'Audio player', path: '/js/apps/player/audio.js', el: 'audioBody' },
  { key: 'queue', label: 'Song list', path: '/js/apps/player/queue.js', el: 'queueBody' },
];

// URL: /v/<token>/play/<nomor>  (atau /player.html?t=<token>&s=<nomor>)
const qs = new URLSearchParams(location.search);
const seg = location.pathname.split('/').filter(Boolean);
const token = qs.get('t') || (seg[0] === 'v' ? seg[1] : '');
const num = Number(qs.get('s') || (seg[2] === 'play' ? seg[3] : 1)) || 1;

const listUrl = `/v/${encodeURIComponent(token)}`;
const songUrl = (n) => `/v/${encodeURIComponent(token)}/play/${n}`;

function fail(title, sub) {
  $('msgTitle').textContent = title;
  $('msgSub').textContent = sub;
  $('msg').classList.remove('hidden');
}

function initials(t) {
  const w = String(t).replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] || '♪').slice(0, 2)).toUpperCase();
}

async function start() {
  $('back').href = listUrl;
  const [mods, res] = await Promise.all([
    loadModules(MODULES),
    Promise.resolve().then(() => sb.rpc('get_vocalist_report', { p_token: token || '' })).catch((e) => ({ error: e })),
  ]);
  if (res.error || !res.data) {
    if (res.error) report('data:report', res.error);
    return res.error
      ? fail('Could not load', 'Connection problem. Please reload the page in a moment.')
      : fail('Link not found', 'This link is wrong or has been replaced. Ask the admin for the latest link.');
  }
  const rep = res.data;
  const songs = rep.songs.map((s, i) => ({ ...s, n: i + 1 }));
  const song = songs[num - 1];
  if (!song) return fail('Song not found', 'This song is no longer on the list. Go back to the Songlist.');

  document.title = `${song.title} · ${rep.name}`;
  $('cover').textContent = initials(song.title);
  $('title').textContent = song.title;
  $('meta').innerHTML = `${esc(rep.name)} · ${esc(dateLabel(song))}`;
  $('app').classList.remove('hidden');

  const player = {
    song, songs, vocalist: rep.name,
    prevUrl: song.n > 1 ? songUrl(song.n - 1) : null,
    nextUrl: song.n < songs.length ? songUrl(song.n + 1) : null,
    songUrl,
  };
  for (const m of MODULES) {
    const mod = mods[m.key];
    if (mod?.mount) safe(m.label, () => mod.mount(player), $(m.el));
  }
}

start();
