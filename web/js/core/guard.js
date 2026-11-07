// Segmen CORE — pengaman error antar-modul.
//
// Aturan: setiap modul dijalankan lewat safe()/on()/loadModules(). Kalau satu modul gagal
// (file gagal dimuat, error saat render, error saat tombol ditekan), yang berhenti hanya
// bagian itu. Bagian lain tetap jalan, dan pengguna melihat pesan di tempat bagian yang gagal.
import { toast } from './ui.js';

const LOG_MAX = 50;
window.FC_ERRORS = window.FC_ERRORS || [];

export function report(segment, err) {
  const msg = (err && (err.message || err.reason?.message)) || String(err);
  window.FC_ERRORS.push({ at: new Date().toISOString(), segment, msg });
  if (window.FC_ERRORS.length > LOG_MAX) window.FC_ERRORS.shift();
  console.error(`[FC:${segment}]`, err);
}

function banner(el) {
  const prev = el.previousElementSibling;
  return prev && prev.classList.contains('seg-err') && prev.dataset.for === el.id ? prev : null;
}
function clearErr(el) {
  if (!el) return;
  el.classList.remove('seg-failed');
  banner(el)?.remove();
}
function showErr(el, label) {
  el.classList.add('seg-failed');
  if (banner(el)) return;
  const b = document.createElement('div');
  b.className = 'seg-err';
  b.dataset.for = el.id;
  b.setAttribute('role', 'alert');
  b.innerHTML = `<span>Bagian <b></b> sedang bermasalah. Bagian lain tetap bisa dipakai.</span><button type="button">Muat ulang</button>`;
  b.querySelector('b').textContent = label;
  b.querySelector('button').addEventListener('click', () => location.reload());
  el.before(b);
}
function fail(label, err, el) {
  report(label, err);
  if (el) showErr(el, label);
  else toast(`${label} sedang bermasalah. Coba lagi sebentar.`, 'bad');
}

/** Jalankan fn dengan aman. el (opsional) = elemen milik segmen ini, untuk pesan error di tempat. */
export function safe(label, fn, el = null) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then((v) => { clearErr(el); return v; }, (e) => { fail(label, e, el); });
    }
    clearErr(el);
    return r;
  } catch (e) {
    fail(label, e, el);
  }
}

/** addEventListener yang dibungkus safe(). */
export function on(target, type, label, handler) {
  if (!target) { report(label, new Error(`elemen untuk event ${type} tidak ditemukan`)); return; }
  target.addEventListener(type, (e) => safe(label, () => handler(e)));
}

/**
 * Muat beberapa modul secara terpisah. Modul yang gagal dimuat tidak menggagalkan modul lain.
 * specs: [{ key, label, path, el }]  -> { key: module }
 */
export async function loadModules(specs) {
  const out = {};
  await Promise.all(specs.map(async (s) => {
    try { out[s.key] = await import(s.path); }
    catch (e) { fail(s.label, e, s.el ? document.getElementById(s.el) : null); }
  }));
  return out;
}

let installed = false;
export function installGlobalHandlers() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => report('global', e.error || e.message));
  window.addEventListener('unhandledrejection', (e) => report('global', e.reason));
}
