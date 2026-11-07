// VOKALIS — kerangka halaman: memuat laporan sekali, lalu menyerahkan ke modul Songlist & Invoice.
// Modul baru (Player, ACC, Studio) cukup ditambahkan ke daftar MODULES.
import { sb } from '/js/core/supabase.js';
import { $ } from '/js/core/ui.js';
import { safe, on, loadModules, installGlobalHandlers, report } from '/js/core/guard.js';

installGlobalHandlers();

const MODULES = [
  { key: 'songlist', label: 'Songlist', path: '/js/apps/vocalist/songlist.js', el: 'songsBody' },
  { key: 'invoice', label: 'Invoice', path: '/js/apps/vocalist/invoice.js', el: 'invBody' },
  { key: 'send', label: 'Send to FC', path: '/js/apps/vocalist/send.js', el: null },
  { key: 'player', label: 'Player', path: '/js/apps/vocalist/player.js', el: 'playerBody' },
];

const token = new URLSearchParams(location.search).get('t') || location.pathname.split('/').filter(Boolean).pop();

function showTab(t) {
  $('tabSongs').setAttribute('aria-selected', t === 'songs');
  $('tabInv').setAttribute('aria-selected', t === 'invoice');
  $('songsView').classList.toggle('hidden', t !== 'songs');
  $('invView').classList.toggle('hidden', t !== 'invoice');
  history.replaceState(null, '', t === 'invoice' ? '#invoice' : location.pathname + location.search);
}

async function start() {
  // Muat modul dan data bersamaan.
  const [mods, res] = await Promise.all([
    loadModules(MODULES),
    Promise.resolve().then(() => sb.rpc('get_vocalist_report', { p_token: token || '' })).catch((e) => ({ error: e })),
  ]);

  if (res.error || !res.data) {
    if (res.error) report('data:report', res.error);
    $('name').textContent = res.error ? 'Gagal memuat' : 'Link tidak ditemukan';
    $('sub').textContent = res.error
      ? 'Koneksi bermasalah. Coba muat ulang halaman sebentar lagi.'
      : 'Link ini salah atau sudah diganti. Minta link terbaru ke Jeffry.';
    return;
  }

  const rep = { ...res.data, token };
  document.title = `${rep.name} · First Club`;
  $('name').textContent = rep.name;
  $('sub').textContent = `${rep.songs.length} lagu bersama Jeffry`;
  $('app').classList.remove('hidden');

  on(document.querySelector('.tabs'), 'click', 'Menu tab', (e) => {
    const b = e.target.closest('.tab'); if (b) showTab(b.dataset.tab);
  });
  if (location.hash === '#invoice') showTab('invoice');

  for (const m of MODULES) {
    const mod = mods[m.key];
    if (mod?.mount) safe(m.label, () => mod.mount(rep), $(m.el));
  }
}

start();
