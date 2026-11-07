// ADMIN — kerangka aplikasi: memuat modul secara terpisah, mengatur tab, dan menyambungkan modul.
// Modul fitur tidak saling mengimpor; mereka berkomunikasi lewat ctx.
import { $, toast } from '/js/core/ui.js';
import { safe, on, loadModules, installGlobalHandlers } from '/js/core/guard.js';
import { esc, timeAgo } from '/js/core/format.js';
import { state, loadAll } from './data.js';

installGlobalHandlers();

const MODULES = [
  { key: 'auth', label: 'Login', path: '/js/apps/admin/auth.js', el: 'loginView' },
  { key: 'songs', label: 'Tabel lagu', path: '/js/apps/admin/songs.js', el: 'vocMain' },
  { key: 'trash', label: 'Terhapus', path: '/js/apps/admin/trash.js', el: 'delBox' },
  { key: 'revisions', label: 'Ganti revisi', path: '/js/apps/admin/revisions.js', el: null },
  { key: 'unmatched', label: 'Perlu dicek', path: '/js/apps/admin/unmatched.js', el: 'unList' },
  { key: 'settings', label: 'Pengaturan', path: '/js/apps/admin/settings.js', el: 'setBody' },
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
  openReplace(id) {
    if (!mods.revisions) return toast('Fitur Ganti revisi sedang bermasalah. Fitur lain tetap bisa dipakai.', 'bad');
    runMod('revisions', 'open', id);
  },
};

async function enterApp() {
  $('appView').classList.remove('hidden');
  await reload();
}

async function reload() {
  await safe('Data', loadAll);
  renderAll();
}

function renderAll() {
  safe('Status sync', renderSyncInfo);
  safe('Menu tab', renderTabs);
  safe('Tampilan', renderView);
}

function renderSyncInfo() {
  const t = state.settings?.last_sync;
  if (!t) { $('syncInfo').textContent = 'Belum pernah sync'; return; }
  const min = Math.round((Date.now() - new Date(t)) / 60000);
  $('syncInfo').textContent = `Sync terakhir dari PC: ${timeAgo(t)}` + (min > 30 ? ' · program sync mungkin tidak jalan' : '');
}

function renderTabs() {
  const tabs = state.vocalists.map((v) => {
    const n = state.songs.filter((s) => s.vocalist_id === v.id && !s.deleted).length;
    return `<button class="chip" aria-pressed="${state.tab === 'v:' + v.id}" data-tab="v:${v.id}">${esc(v.display_name)} <span class="n">${n}</span></button>`;
  });
  const un = state.unmatched.length;
  tabs.push(`<button class="chip ${un ? 'alert' : ''}" aria-pressed="${state.tab === 'un'}" data-tab="un">Perlu dicek <span class="n">${un}</span></button>`);
  tabs.push(`<button class="chip" aria-pressed="${state.tab === 'set'}" data-tab="set">Pengaturan</button>`);
  $('tabs').innerHTML = tabs.join('');
}

function renderView() {
  const t = state.tab;
  $('vocView').classList.toggle('hidden', !t.startsWith('v:'));
  $('unView').classList.toggle('hidden', t !== 'un');
  $('setView').classList.toggle('hidden', t !== 'set');
  if (t.startsWith('v:')) {
    runMod('songs', 'render');
    runMod('trash', 'render');
  } else if (t === 'un') runMod('unmatched', 'render');
  else runMod('settings', 'render');
}

async function start() {
  mods = await loadModules(MODULES);
  for (const m of MODULES) runMod(m.key, 'init', ctx);

  on($('tabs'), 'click', 'Menu tab', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    state.tab = b.dataset.tab;
    runMod('songs', 'resetFilters');
    renderAll();
  });
  on($('reloadBtn'), 'click', 'Muat ulang', reload);
  on($('logoutBtn'), 'click', 'Keluar', () => (mods.auth ? mods.auth.logout() : location.reload()));
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !$('appView').classList.contains('hidden')) safe('Muat ulang', reload);
  });

  if (mods.auth) await runMod('auth', 'boot');
  else $('loginView').classList.remove('hidden');
}

start();
