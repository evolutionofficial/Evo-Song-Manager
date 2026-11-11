// ADMIN — modul Finalisasi: memilih file WAV mana yang jadi versi final, lalu mengunggah M4A-nya.
// Mendeteksi file tidak memicu apa pun; hanya tombol di sini yang memulai unggahan.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, fmtDate, timeAgo } from '/js/core/format.js';
import { state, curVoc, vocSongs, versionOf, finalizingOf, jobOf } from './data.js';

let ctx, dlg, song, picked, cands = [];

const mb = (b) => (b ? `${(b / 1048576).toFixed(1)} MB` : '');

function build() {
  dlg = document.createElement('dialog');
  dlg.className = 'confirm fin';
  dlg.innerHTML = `<form method="dialog">
      <h3>Finalize <span id="finSong"></span></h3>
      <p class="note" id="finHint">Pick the WAV that becomes the final version. Its M4A is uploaded so the vocalist can listen.</p>
      <div id="finList" class="finlist"></div>
      <p class="err" id="finErr"></p>
      <menu>
        <button value="cancel" class="ghost">Close</button>
        <button id="finGo" class="primary" value="go">Finalize &amp; Upload</button>
      </menu>
    </form>`;
  document.body.appendChild(dlg);
  on(dlg, 'click', 'Finalize', (e) => {
    const row = e.target.closest('[data-cand]');
    if (row && !row.classList.contains('off')) { picked = row.dataset.cand; paint(); }
  });
  on(el('finGo'), 'click', 'Finalize', submit);
}

// $ dari core/ui mencari di document; di dalam dialog kita cari sendiri.
function el(id) { return dlg.querySelector('#' + id); }

function paint() {
  el('finList').querySelectorAll('[data-cand]').forEach((r) => {
    r.setAttribute('aria-checked', String(r.dataset.cand === picked));
  });
  const c = cands.find((x) => x.id === picked);
  el('finGo').disabled = !c || c.active || !c.present || !c.m4a_name;
}

function row(c) {
  const why = !c.present ? 'This file is no longer on the computer'
    : !c.m4a_name ? 'No M4A next to this WAV — render both from the DAW'
    : c.active ? 'This is the version that is already live' : '';
  return `<div class="finrow ${why ? 'off' : ''}" data-cand="${esc(c.id)}" role="radio" aria-checked="false" tabindex="0">
    <div class="fin-main">
      <div class="fin-name">${esc(c.file_name)}
        ${c.active ? '<span class="badge ok">live now</span>' : ''}
        ${c.finalizing ? '<span class="badge warn">finalizing</span>' : ''}
        ${!c.present ? '<span class="badge muted">gone</span>' : ''}</div>
      <div class="fin-meta">${esc(fmtDate(c.mtime))} · ${esc(mb(c.size))} · ${esc(c.device || c.source)}
        · <span class="dim">${esc(String(c.sha256).slice(0, 8))}</span></div>
      <div class="fin-meta">${c.m4a_name
        ? (c.m4a_stale
          ? `<span class="fin-warn">M4A is older than the WAV (${esc(timeAgo(c.m4a_mtime))}) — only the WAV may have been re-rendered</span>`
          : `<span class="fin-ok">M4A ready · ${esc(mb(c.m4a_size))}</span>`)
        : '<span class="fin-bad">No M4A — render WAV + M4A together</span>'}</div>
    </div>
    ${why ? `<div class="fin-why">${esc(why)}</div>` : ''}
  </div>`;
}

export async function open(id) {
  if (!dlg) build();
  song = state.songs.find((s) => s.id === id);
  if (!song) return;
  picked = null;
  el('finSong').textContent = song.title;
  el('finErr').textContent = '';
  el('finList').innerHTML = '<div class="empty">Loading…</div>';
  dlg.showModal();

  const { data, error } = await sb.rpc('list_candidates', { p_song: id });
  if (error) { el('finList').innerHTML = `<div class="empty">Could not load the files: ${esc(error.message)}</div>`; return; }
  cands = data || [];
  if (!cands.length) {
    el('finList').innerHTML = `<div class="empty">No file has been fingerprinted for this song yet.<br>
      <span class="op-hint">The studio computer that holds it must be on.</span></div>`;
    el('finGo').disabled = true;
    return;
  }
  el('finList').innerHTML = cands.map(row).join('');
  // Pilih kandidat terbaru yang siap difinalisasi.
  picked = (cands.find((c) => c.present && c.m4a_name && !c.active) || {}).id || null;
  paint();
}

async function submit(e) {
  e.preventDefault();
  if (!picked) { el('finErr').textContent = 'Pick a file first.'; return; }
  el('finGo').disabled = true;
  try {
    const { data, error } = await sb.rpc('finalize_song', { p_song: song.id, p_candidate: picked });
    if (error) { el('finErr').textContent = error.message; return; }
    dlg.close();
    toast(data?.state === 'already_active' ? 'That file is already the live version'
      : data?.state === 'already_running' ? 'Already being finalized'
      : `Finalizing "${song.title}" — the studio computer is uploading it`);
    await ctx.reload();
  } finally {
    el('finGo').disabled = false;
  }
}

/** Versi aktif yang benar-benar punya audio (lagu warisan tanpa M4A tidak dihitung). */
const versionHasAudio = (s) => !!versionOf(s)?.m4a_key;

/** Dipakai modul Song table untuk menampilkan status di baris lagu. */
export function badge(s) {
  const j = jobOf(s);
  if (j && (j.status === 'needs_admin' || j.status === 'failed')) {
    return ` <span class="badge bad" title="${esc(j.last_error || '')}">Finalize ${j.status === 'needs_admin' ? 'needs you' : 'failed'}</span>`;
  }
  if (finalizingOf(s)) return ' <span class="badge warn">Finalizing…</span>';
  if (!versionHasAudio(s)) return ' <span class="badge muted" title="No audio yet — render WAV + M4A, then Finalize">No audio</span>';
  return '';
}

export async function cancel(id) {
  const s = state.songs.find((x) => x.id === id);
  if (!confirm(`Cancel finalizing "${s.title}"?\n\nThe upload stops. The version that is live now does not change.`)) return;
  const { error } = await sb.rpc('cancel_finalize', { p_song: id });
  if (error) return toast('Failed: ' + error.message, 'bad');
  toast('Finalizing cancelled');
  await ctx.reload();
}

export async function retry(id) {
  const j = jobOf(state.songs.find((x) => x.id === id));
  if (!j) return;
  const { error } = await sb.rpc('retry_job', { p_job: j.id });
  if (error) return toast('Failed: ' + error.message, 'bad');
  toast('Trying again');
  await ctx.reload();
}

/** Berapa lagu vokalis ini yang jelas bisa langsung difinalisasi (perkiraan untuk tombol). */
export function readyCount() {
  return vocSongs().filter((s) => !s.accepted_at && !finalizingOf(s) && !versionHasAudio(s)).length;
}

export async function all() {
  const v = curVoc(); if (!v) return;
  if (!confirm(`Finalize every ready song for ${v.display_name}?\n\nOnly songs with exactly one file and a matching M4A are done. Anything unclear is skipped and listed afterwards.`)) return;
  const { data, error } = await sb.rpc('finalize_ready', { p_vocalist: v.id });
  if (error) return toast('Failed: ' + error.message, 'bad');
  const skipped = data?.skipped || [];
  toast(data?.queued ? `Finalizing ${data.queued} song${data.queued > 1 ? 's' : ''}` : 'Nothing was ready to finalize');
  if (skipped.length) {
    alert(`Skipped ${skipped.length}:\n\n` + skipped.map((x) => `• ${x.title} — ${x.why}`).join('\n'));
  }
  await ctx.reload();
}

export function init(c) { ctx = c; }
