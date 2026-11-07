import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4';

export const SUPABASE_URL = 'https://ulcqmkrasgzgvclmmrtb.supabase.co';
export const SUPABASE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVsY3Fta3Jhc2d6Z3ZjbG1tcnRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1NzA3OTIsImV4cCI6MjEwOTE0Njc5Mn0.9rJxHhiA9-ERGmbOEc5-UqxSr2b5MRkcrYQ2BIzwiN0';
export const PRICES = [50000, 70000, 100000];

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const rupiah = (n) => 'Rp ' + Number(n || 0).toLocaleString('id-ID');
export const ribu = (n) => Number(n).toLocaleString('id-ID');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(new Date(iso).toLocaleString('en-US', { timeZone: 'Asia/Jakarta' }));
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
export function dateLabel(song) {
  return song.session || song.session_label || fmtDate(song.mtime || song.sort_date || song.file_mtime);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

export function summarize(songs) {
  let total = 0, paid = 0, paidCount = 0, priced = 0;
  for (const s of songs) {
    const p = Number(s.price) || 0;
    total += p;
    if (p) priced++;
    if (s.paid) { paid += p; paidCount++; }
  }
  return { total, paid, rest: total - paid, paidCount, priced, count: songs.length };
}

let toastTimer;
export function toast(msg, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = 'show ' + kind;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = kind), 2600);
}
