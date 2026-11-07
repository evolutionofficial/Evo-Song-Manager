// PLAYER — modul mesin audio. Saat ini belum ada sumber file (penyimpanan audio dibahas terpisah),
// jadi tombol putar dinonaktifkan. Nanti cukup modul ini yang diganti: ambil URL audio lagu,
// pasang <audio>, sambungkan progress bar & waktu. Kerangka dan antrean tidak perlu diubah.

function setNav(a, url) {
  if (url) a.href = url;
  else { a.removeAttribute('href'); a.setAttribute('aria-disabled', 'true'); a.style.opacity = '.35'; a.style.pointerEvents = 'none'; }
}

export function mount(player) {
  setNav(document.getElementById('prev'), player.prevUrl);
  setNav(document.getElementById('next'), player.nextUrl);
  const btn = document.getElementById('playBtn');
  btn.disabled = true;
  btn.title = 'Audio segera hadir';
  document.getElementById('soon').textContent = 'Audio segera hadir. Untuk sekarang halaman ini menampilkan info lagu dan daftar lagu kamu.';
}
