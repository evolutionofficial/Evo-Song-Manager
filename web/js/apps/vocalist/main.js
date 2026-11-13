// VOKALIS — kerangka halaman: memuat laporan sekali, lalu menyerahkan ke modul Songlist & Invoice.
// Modul baru (Player, ACC, Studio) cukup ditambahkan ke daftar MODULES.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { safe, on, loadModules, installGlobalHandlers, report } from '/js/core/guard.js';

installGlobalHandlers();

const MODULES = [
  { key: 'songlist', label: 'Songlist', path: '/js/apps/vocalist/songlist.js', el: 'songsBody' },
  { key: 'invoice', label: 'Invoice', path: '/js/apps/vocalist/invoice.js', el: 'invBody' },
  { key: 'allsongs', label: 'All Song List', path: '/js/apps/vocalist/allsongs.js', el: 'allBody' },
  { key: 'send', label: 'Send to FC', path: '/js/apps/vocalist/send.js', el: null },
  { key: 'player', label: 'Player', path: '/js/apps/vocalist/player.js', el: 'playerBody' },
  { key: 'listen', label: 'Listen together', path: '/js/apps/vocalist/listen.js', el: 'listenBanner' },
  { key: 'call', label: 'Call', path: '/js/apps/vocalist/call.js', el: 'vCallPanel' },
];

const token = new URLSearchParams(location.search).get('t') || location.pathname.split('/').filter(Boolean).pop();

// ---------- Tampilan: Songlist / Invoice (tab) dan All Song List (dari laci) ----------
const VIEWS = { songs: 'songsView', invoice: 'invView', all: 'allView', call: 'callView' };
const HASH = { songs: '', invoice: '#invoice', all: '#all', call: '#call' };

function showView(v) {
  if (!VIEWS[v]) v = 'songs';
  for (const [k, id] of Object.entries(VIEWS)) $(id).classList.toggle('hidden', k !== v);
  $('tabSongs').setAttribute('aria-selected', v === 'songs');
  $('tabInv').setAttribute('aria-selected', v === 'invoice');
  $('tabCall').setAttribute('aria-selected', v === 'call');
  document.querySelectorAll('#drawerNav [data-view]').forEach((b) => b.setAttribute('aria-current', b.dataset.view === v ? 'page' : 'false'));
  history.replaceState(history.state, '', location.pathname + location.search + HASH[v]);
  window.scrollTo(0, 0);
  // Modul yang perlu tahu tab mana yang terbuka mendengarkan ini. Dipakai tab Call, supaya
  // izin kamera dan mikrofon baru diminta saat tabnya benar-benar dibuka.
  window.dispatchEvent(new CustomEvent('fc:view', { detail: v }));
}

function setDrawer(open) {
  $('drawer').classList.toggle('open', open);
  $('drawer').setAttribute('aria-hidden', String(!open));
  $('drawerBackdrop').classList.toggle('show', open);
  $('drawerBtn').setAttribute('aria-expanded', String(open));
  if (open) $('drawerNav').querySelector('[aria-current=page]')?.focus({ preventScroll: true });
}

function initDrawer() {
  on($('drawerBtn'), 'click', 'Menu', () => setDrawer(true));
  on($('drawerClose'), 'click', 'Menu', () => setDrawer(false));
  on($('drawerBackdrop'), 'click', 'Menu', () => setDrawer(false));
  on(document, 'keydown', 'Menu', (e) => { if (e.key === 'Escape' && $('drawer').classList.contains('open')) setDrawer(false); });
  on($('drawerNav'), 'click', 'Menu', (e) => {
    const b = e.target.closest('.nav-item'); if (!b) return;
    if (b.dataset.soon) { toast(`${b.dataset.soon} is coming soon`); return; }
    showView(b.dataset.view);
    setDrawer(false);
  });
}

async function start() {
  // Muat modul dan data bersamaan.
  const [mods, res] = await Promise.all([
    loadModules(MODULES),
    Promise.resolve().then(() => sb.rpc('get_vocalist_report', { p_token: token || '' })).catch((e) => ({ error: e })),
  ]);

  if (res.error || !res.data) {
    if (res.error) report('data:report', res.error);
    $('name').textContent = res.error ? 'Could not load' : 'Link not found';
    $('sub').textContent = res.error
      ? 'Connection problem. Please reload the page in a moment.'
      : 'This link is wrong or has been replaced. Ask the admin for the latest link.';
    return;
  }

  const rep = { ...res.data, token };
  document.title = `${rep.name} · Evo Song Manager`;
  $('name').textContent = rep.name;
  $('app').classList.remove('hidden');

  safe('Menu', initDrawer);
  $('drawerBtn').classList.remove('hidden');
  $('drawerName').textContent = rep.name;
  $('dnMine').textContent = `${rep.songs.length} songs`;
  $('dnAll').textContent = `${rep.all_songs.length} songs · all vocalists`;
  on(document.querySelector('.tabs'), 'click', 'Menu tab', (e) => {
    const b = e.target.closest('.tab'); if (b) showView(b.dataset.view);
  });
  showView({ '#invoice': 'invoice', '#all': 'all', '#call': 'call' }[location.hash] || 'songs');

  // Modul tidak saling mengimpor; yang perlu bicara satu sama lain lewat ctx ini.
  const ctx = { player: () => mods.player?.remote || null };

  // Player dipasang lebih dulu: modul Listen together memerlukan kendalinya.
  const order = [...MODULES].sort((a, b) => (a.key === 'listen') - (b.key === 'listen'));
  for (const m of order) {
    const mod = mods[m.key];
    if (mod?.mount) safe(m.label, () => mod.mount(rep, ctx), $(m.el));
  }
}

start();
