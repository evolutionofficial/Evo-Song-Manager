// ADMIN — modul Terhapus: lagu yang disembunyikan, dikembalikan, atau dimusnahkan permanen.
//
// Penghapusan dibuat DUA TAHAP dengan sengaja, karena tahap keduanya tidak bisa dibatalkan:
//
//   1. "Remove from list" di tabel lagu — lagu hilang dari halaman vokalis, tapi semua filenya
//      masih utuh dan bisa dikembalikan kapan saja. Ini yang dipakai sehari-hari.
//   2. "Delete audio permanently" di sini — baru menghapus isinya dari R2 dan membuang file
//      WAV-nya ke Trash Google Drive. Tidak ada satu klik pun yang bisa melompati tahap 1.
//
// File WAV/M4A di komputer Jeffry TIDAK disentuh sama sekali. Itu sumber aslinya.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on, report } from '/js/core/guard.js';
import { ribu, esc, dateLabel } from '/js/core/format.js';
import { state, vocDeleted, updateSong } from './data.js';

let ctx;
let busy = false;

/**
 * Apakah jalur pemusnahan sudah ada di database?
 *
 * Halaman ini bisa tayang lebih dulu daripada migrasinya. Tanpa pemeriksaan ini, tombolnya
 * tampil, ditekan, lalu gagal dengan pesan yang tidak menjelaskan apa-apa. Lebih baik tombolnya
 * tidak ditawarkan sama sekali sampai fungsinya benar-benar ada.
 */
const purgeReady = () => !state.errors?.purge;

/** Apa yang sedang/sudah dikerjakan untuk lagu ini. */
function purgeState(s) {
  const p = (state.purge || {})[s.id];
  if (!s.purged_at && !p) return null;
  if (p?.stuck) return { cls: 'bad', text: `${p.stuck} couldn't be deleted` };
  if (p?.pending) return { cls: 'wait', text: `deleting ${p.pending}…` };
  return { cls: 'done', text: 'audio deleted' };
}

export function render() {
  const del = vocDeleted();
  $('delCount').textContent = del.length;
  $('delBox').classList.toggle('hidden', !del.length);

  const left = del.filter((s) => !s.purged_at).length;
  $('delList').innerHTML = del.map((s) => {
    const st = purgeState(s);
    return `<div class="delrow">
      <span><b>${esc(s.title)}</b> <span class="note">· ${esc(dateLabel(s))}${s.price ? ' · ' + ribu(s.price) : ''}${s.paid ? ' · paid' : ''}</span>
        ${st ? ` <span class="badge ${st.cls === 'bad' ? 'bad' : st.cls === 'wait' ? 'muted' : 'ok'}">${esc(st.text)}</span>` : ''}</span>
      <span class="delacts">
        <button data-restore="${s.id}"${s.purged_at ? ' title="The audio is gone; the song comes back without it"' : ''}>Restore</button>
        ${s.purged_at || !purgeReady() ? '' : `<button class="danger" data-purge="${s.id}">Delete audio permanently</button>`}
      </span>
    </div>`;
  }).join('') + (!purgeReady()
    ? `<div class="delall note">Permanent deletion isn't switched on yet — the database still needs its update. Songs here stay hidden and keep all their files.</div>`
    : left > 1
      ? `<div class="delall"><button class="danger" data-purgeall="1">Delete audio of all ${left} permanently</button></div>`
      : '');
}

/** Satu tempat untuk kalimat peringatannya, supaya versi satuan dan borongan tidak pernah beda. */
function warning(titles) {
  const what = titles.length === 1 ? `"${titles[0]}"` : `${titles.length} songs`;
  return `Permanently delete the audio of ${what}?\n\n`
    + `• The audio is removed from storage — the vocalist can never play it again.\n`
    + `• The WAV goes to the Google Drive Trash (recoverable there for 30 days).\n`
    + `• Your own WAV and M4A files on this computer are NOT touched.\n\n`
    + `This cannot be undone from the app.`
    + (titles.length > 1 ? `\n\n${titles.slice(0, 8).map((t) => '· ' + t).join('\n')}${titles.length > 8 ? `\n· …and ${titles.length - 8} more` : ''}` : '');
}

async function purge(ids, titles) {
  if (busy) return;
  if (!confirm(warning(titles))) return;
  busy = true;
  let done = 0, failed = 0;
  for (const id of ids) {
    try {
      const { error } = await sb.rpc('purge_song', { p_song: id });
      if (error) throw error;
      done++;
    } catch (e) { failed++; report('Deleted', e); }
  }
  busy = false;
  await ctx.reload();
  if (failed) toast(`${done} queued, ${failed} failed`, 'bad');
  else toast(done === 1 ? 'Deleting the audio…' : `Deleting the audio of ${done} songs…`);
}

export function init(c) {
  ctx = c;
  on($('delList'), 'click', 'Deleted', async (e) => {
    const b = e.target.closest('button'); if (!b) return;

    if (b.dataset.restore) {
      const s = vocDeleted().find((x) => x.id === b.dataset.restore);
      // Lagu yang audionya sudah dimusnahkan tetap boleh dikembalikan — sejarahnya berguna —
      // tapi jangan sampai dikira audionya ikut kembali.
      if (s?.purged_at && !confirm(`Restore "${s.title}"?\n\nThe audio was permanently deleted, so it comes back without any audio. The vocalist will see it with no play button.`)) return;
      if (await updateSong(b.dataset.restore, { deleted: false }, ctx.renderAll)) toast('Song restored');
      return;
    }

    if (b.dataset.purge) {
      const s = vocDeleted().find((x) => x.id === b.dataset.purge);
      if (s) await purge([s.id], [s.title]);
      return;
    }

    if (b.dataset.purgeall) {
      const list = vocDeleted().filter((x) => !x.purged_at);
      if (list.length) await purge(list.map((x) => x.id), list.map((x) => x.title));
    }
  });
}
