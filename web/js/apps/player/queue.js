// PLAYER — modul daftar lagu (antrean): semua lagu milik vokalis, lagu yang sedang dibuka ditandai.
import { esc } from '/js/core/format.js';

export function mount(player) {
  const el = document.getElementById('queue');
  el.innerHTML = player.songs.map((s) =>
    `<a class="row ${s.n === player.song.n ? 'cur' : ''}" href="${player.songUrl(s.n)}" ${s.n === player.song.n ? 'aria-current="true"' : ''}>
      <span class="no">${s.n === player.song.n ? '▶' : s.n}</span><span class="title">${esc(s.title)}</span></a>`).join('');
}
