// ADMIN — kerangka aplikasi: memuat modul secara terpisah, mengatur tab, dan menyambungkan modul.
// Modul fitur tidak saling mengimpor; mereka berkomunikasi lewat ctx.
import { $, toast } from '/js/core/ui.js';
import { safe, on, loadModules, installGlobalHandlers } from '/js/core/guard.js';
import { esc, timeAgo } from '/js/core/format.js';
import { state, loadAll, curVoc } from './data.js';

installGlobalHandlers();

const MODULES = [
  { key: 'auth', label: 'Login', path: '/js/apps/admin/auth.js', el: 'loginView' },
  { key: 'songs', label: 'Song table', path: '/js/apps/admin/songs.js', el: 'vocMain' },
  { key: 'trash', label: 'Deleted', path: '/js/apps/admin/trash.js', el: 'delBox' },
  { key: 'revisions', label: 'Replace revision', path: '/js/apps/admin/revisions.js', el: null },
  { key: 'requests', label: 'Revisions', path: '/js/apps/admin/requests.js', el: 'rrList' },
  { key: 'unmatched', label: 'Needs review', path: '/js/apps/admin/unmatched.js', el: 'unList' },
  { key: 'conflicts', label: 'Conflicts', path: '/js/apps/admin/conflicts.js', el: 'cfList' },
  { key: 'system', label: 'System', path: '/js/apps/admin/system.js', el: 'sysList' },
  { key: 'listen', label: 'Listen together', path: '/js/apps/admin/listen.js', el: 'listenDock' },
  { key: 'playback', label: 'Player', path: '/js/apps/admin/playback.js', el: 'playerBody' },
  { key: 'settings', label: 'Settings', path: '/js/apps/admin/settings.js', el: 'setBody' },
];
const spec = (k) => MODULES.find((m) => m.key === k);

let mods = {};

// Jalankan fungsi modul dengan aman. Kalau modul tidak termuat, tampilkan pesan di tempatnya.
function runMod(key, fnName, ...args) {
  const m = mods[key], s = spec(key);
  const el = s.el ? $(s.el) : null;
  if (!m) return;
  if (typeof m[fnName] !== 'function') return;
  return safe(s.label, () => m[fnName](...args), el);
}

const ctx = {
  renderAll,
  reload,
  enterApp,
  openTab(tab) {
    state.tab = tab;
    runMod('songs', 'resetFilters');
    renderAll();
    window.scrollTo(0, 0);
  },
  openReplace(id) {
    if (!mods.revisions) return toast('Replace revision is having problems. Everything else still works.', 'bad');
    runMod('revisions', 'open', id);
  },
  vocalists() { return state.vocalists; },
  /** Putar sebuah lagu di pemutar admin. */
  play(id) { return runMod('playback', 'play', id); },
  canPlay(s) { return !!mods.playback?.canPlay?.(s); },
  /** Lencana status finalisasi untuk baris lagu (kosong kalau modulnya tidak jalan). */
};

async function enterApp() {
  $('appView').classList.remove('hidden');
  await reload();
  // Sesi menyimak yang masih terbuka disambung lagi, supaya halaman yang dimuat ulang
  // tidak meninggalkan ruang menggantung tanpa pemimpin.
  runMod('listen', 'resume');
}

async function reload() {
  await safe('Data', loadAll);
  renderAll();
}

function renderAll() {
  safe('Sync status', renderSyncInfo);
  safe('Sidebar', renderTabs);
  safe('View', renderView);
  runMod('listen', 'render');
}

function renderSyncInfo() {
  const t = state.settings?.last_sync;
  if (!t) { $('syncInfo').textContent = 'Never synced'; return; }
  const min = Math.round((Date.now() - new Date(t)) / 60000);
  $('syncInfo').textContent = `Last sync from PC: ${timeAgo(t)}` + (min > 30 ? ' · sync program may not be running' : '');
}

function renderTabs() {
  const items = state.vocalists.map((v) => {
    const list = state.songs.filter((s) => s.vocalist_id === v.id && !s.deleted);
    const sel = state.tab === 'v:' + v.id;
    return `<button class="nav-item" style="--i:${state.vocalists.indexOf(v)}" aria-current="${sel ? 'page' : 'false'}" data-tab="v:${v.id}">
      <span class="nav-name">${esc(v.display_name)}</span>
      <span class="nav-meta">${list.length} songs</span>
    </button>`;
  });
  const un = state.unmatched.length;
  const rr = state.songs.filter((s) => !s.deleted && !s.accepted_at && s.revision_requested_at).length;
  items.push(`<div class="side-sep"></div>`);
  const k = state.vocalists.length;
  items.push(`<button class="nav-item ${rr ? 'alert' : ''}" style="--i:${k}" aria-current="${state.tab === 'rr' ? 'page' : 'false'}" data-tab="rr">
    <span class="nav-name">Revisions${rr ? ` <span class="badge rev count" aria-label="${rr} new">${rr}</span>` : ''}</span></button>`);
  items.push(`<button class="nav-item ${un ? 'alert' : ''}" style="--i:${k + 1}" aria-current="${state.tab === 'un' ? 'page' : 'false'}" data-tab="un">
    <span class="nav-name">Needs review${un ? ` <span class="badge warn">${un}</span>` : ''}</span></button>`);
  const cf = (state.conflicts || []).length;
  items.push(`<button class="nav-item ${cf ? 'alert' : ''}" style="--i:${k + 2}" aria-current="${state.tab === 'cf' ? 'page' : 'false'}" data-tab="cf">
    <span class="nav-name">Conflicts${cf ? ` <span class="badge warn">${cf}</span>` : ''}</span></button>`);
  items.push(`<button class="nav-item" style="--i:${k + 3}" aria-current="${state.tab === 'sys' ? 'page' : 'false'}" data-tab="sys">
    <span class="nav-name">System</span></button>`);
  items.push(`<button class="nav-item" style="--i:${k + 4}" aria-current="${state.tab === 'set' ? 'page' : 'false'}" data-tab="set">
    <span class="nav-name">Settings</span></button>`);
  $('tabs').innerHTML = items.join('');
  // Titik notifikasi di tombol menu (saat sidebar tertutup / di HP).
  const total = rr + un + cf;
  $('menuBtn').dataset.count = total ? String(total) : '';
  $('menuBtn').classList.toggle('has-count', !!total);
}

// Sidebar: di layar lebar bisa disembunyikan ke kiri (diingat di browser ini);
// di HP jadi panel geser yang menutup sendiri setelah memilih.
const mobileMq = matchMedia('(max-width: 860px)');
const isMobile = () => mobileMq.matches;

function setSide(open) {
  $('side').classList.toggle('open', open);
  $('sideBackdrop').classList.toggle('show', open);
}

function setCollapsed(c) {
  $('appView').classList.toggle('collapsed', c);
  try { localStorage.setItem('fc.sideCollapsed', c ? '1' : '0'); } catch {}
}

function initSide() {
  let c = false;
  try { c = localStorage.getItem('fc.sideCollapsed') === '1'; } catch {}
  $('appView').classList.toggle('collapsed', c);
  on($('menuBtn'), 'click', 'Menu', () => (isMobile() ? setSide(true) : setCollapsed(false)));
  on($('sideClose'), 'click', 'Menu', () => (isMobile() ? setSide(false) : setCollapsed(true)));
  on($('sideBackdrop'), 'click', 'Menu', () => setSide(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('side').classList.contains('open')) setSide(false); });
  mobileMq.addEventListener?.('change', () => setSide(false));
}

function renderView() {
  const t = state.tab;
  $('vocView').classList.toggle('hidden', !t.startsWith('v:'));
  $('unView').classList.toggle('hidden', t !== 'un');
  $('rrView').classList.toggle('hidden', t !== 'rr');
  $('cfView').classList.toggle('hidden', t !== 'cf');
  $('sysView').classList.toggle('hidden', t !== 'sys');
  $('setView').classList.toggle('hidden', t !== 'set');
  if (t.startsWith('v:')) {
    runMod('songs', 'render');
    runMod('trash', 'render');
  } else if (t === 'un') runMod('unmatched', 'render');
  else if (t === 'rr') runMod('requests', 'render');
  else if (t === 'cf') runMod('conflicts', 'render');
  else if (t === 'sys') runMod('system', 'render');
  else runMod('settings', 'render');
}

async function start() {
  mods = await loadModules(MODULES);
  for (const m of MODULES) runMod(m.key, 'init', ctx);

  on($('tabs'), 'click', 'Sidebar', (e) => {
    const b = e.target.closest('.nav-item'); if (!b) return;
    state.tab = b.dataset.tab;
    runMod('songs', 'resetFilters');
    if (isMobile()) setSide(false);
    renderAll();
    window.scrollTo(0, 0);
  });
  safe('Sidebar', initSide);
  on($('reloadBtn'), 'click', 'Reload', reload);
  on($('listenBtn'), 'click', 'Listen together', () => {
    const v = curVoc();
    if (!v) return toast('Open a vocalist first');
    if (!mods.listen) return toast('Listen together is having problems. Everything else still works.', 'bad');
    runMod('listen', 'open', v.id);
  });
  on($('logoutBtn'), 'click', 'Log out', () => (mods.auth ? mods.auth.logout() : location.reload()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('appView').classList.contains('hidden')) safe('Reload', reload);
  });

  if (mods.auth) await runMod('auth', 'boot');
  else $('loginView').classList.remove('hidden');
}

start();
