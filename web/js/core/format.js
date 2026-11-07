// Segmen CORE — format angka, tanggal, teks. Fungsi murni, tanpa efek samping.
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
export function timeAgo(iso) {
  const min = Math.round((Date.now() - new Date(iso)) / 60000);
  if (min < 1) return 'baru saja';
  if (min < 60) return `${min} menit lalu`;
  if (min < 1440) return `${Math.round(min / 60)} jam lalu`;
  return fmtDate(iso);
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
