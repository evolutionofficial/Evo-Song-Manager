// ADMIN — halaman System: satu tempat untuk melihat apakah ada yang perlu diurus.
// Isinya diambil dari keadaan sekarang, bukan catatan yang menumpuk, jadi tidak ada daftar
// masalah lama yang harus dibersihkan sendiri: begitu sesuatu beres, ia hilang dari sini.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { esc, fmtDate, timeAgo } from '/js/core/format.js';
import { state } from './data.js';

let ctx, data = null;
const STALE_MS = 10 * 60 * 1000;
const PLATFORM = { win32: 'Windows PC', darwin: 'MacBook' };

function seen(label, at) {
  if (!at) return `<span class="dv-off">${label}: never</span>`;
  const late = Date.now() - new Date(at).getTime() > STALE_MS;
  return `<span class="${late ? 'dv-off' : 'dv-on'}" title="${esc(fmtDate(at))}">${label}: ${esc(timeAgo(at))}</span>`;
}

/** problem=false untuk daftar yang isinya normal (mis. daftar komputer): tanpa angka merah. */
function section(title, rows, empty, problem = true) {
  const badge = problem && rows.length ? ` <span class="badge bad">${rows.length}</span>` : '';
  return `<div class="panel"><h2>${esc(title)}${badge}</h2>
    ${rows.length ? rows.join('') : `<p class="note">${esc(empty)}</p>`}</div>`;
}

export async function render() {
  $('sysList').innerHTML = '<div class="empty">Loading…</div>';
  const { data: d, error } = await sb.rpc('system_report');
  if (error) { $('sysList').innerHTML = `<div class="empty">Could not load: ${esc(error.message)}</div>`; return; }
  data = d || {};
  const c = data.counts || {};

  const devices = (data.devices || []).map((x) => {
    // Terunggah tapi file lokalnya masih terkunci BUKAN kegagalan: lagunya sudah aman di R2,
    // hanya file di komputernya belum bisa dihapus (biasanya masih dibuka Studio One).
    const locked = x.locked || 0;
    const failed = x.failed || 0;
    return `<div class="dv">
      <div class="dv-name">${esc(x.name)}${x.platform ? ` <span class="badge muted">${esc(PLATFORM[x.platform] || x.platform)}</span>` : ''}
        ${x.version ? `<span class="badge muted">Agent ${esc(x.version)}</span>` : ''}
        ${failed ? `<span class="badge bad">${failed} failing</span>` : ''}
        ${locked ? `<span class="badge warn">${locked} to tidy up</span>` : ''}</div>
      <div class="dv-meta">${x.sources?.length ? `<span>Folders: ${x.sources.map(esc).join(', ')}</span>` : ''}
        ${seen('Sync', x.sync_seen)}${seen('Media', x.media_seen)}</div>
      ${locked ? `<div class="dv-meta">Songs are safe in storage; the files on that computer are
        still open in another program and will be removed once it lets go.</div>` : ''}
      ${failed && x.last_error ? `<div class="sys-err">${esc(x.last_error)}</div>` : ''}
    </div>`;
  });

  const jobs = (data.jobs || []).map((j) => `<div class="sys-row">
      <div><b>${esc(j.song || '(no song)')}</b> <span class="badge ${j.status === 'needs_admin' ? 'bad' : 'warn'}">${esc(j.kind)} · ${esc(j.status)}</span></div>
      <div class="dv-meta">${j.device ? esc(j.device) + ' · ' : ''}${esc(timeAgo(j.updated_at))}${j.attempts ? ` · try ${j.attempts}` : ''}</div>
      ${j.error ? `<div class="sys-err">${esc(j.error)}</div>` : ''}
      ${j.song_id ? `<div class="cf-acts"><button data-open="${esc(j.song_id)}">Open song</button>
        ${j.status === 'needs_admin' ? `<button data-retry="${esc(j.id)}">Try again</button>` : ''}
        ${['needs_admin', 'failed'].includes(j.status) ? `<button data-dismiss="${esc(j.id)}" title="Hilangkan baris ini dari halaman. Lagunya tidak disentuh.">Dismiss</button>` : ''}</div>` : ''}
    </div>`);

  const wav = (data.wav || []).map((w) => `<div class="sys-row">
      <div><b>${esc(w.song)}</b> <span class="badge bad">WAV ${esc(w.status)}</span> <span class="dim">${esc(w.vocalist)}</span></div>
      ${w.error ? `<div class="sys-err">${esc(w.error)}</div>` : ''}
      <div class="cf-acts"><button data-open="${esc(w.song_id)}">Open song</button></div>
    </div>`);

  const miss = (data.audio_missing || []).map((m) => `<div class="sys-row">
      <div><b>${esc(m.song)}</b> <span class="badge bad">audio gone from storage</span> <span class="dim">${esc(m.vocalist)}</span></div>
      <div class="dv-meta">noticed ${esc(timeAgo(m.since))} — render it again so the agent can upload it</div>
      <div class="cf-acts"><button data-open="${esc(m.song_id)}">Open song</button></div>
    </div>`);

  const arch = (data.archive_pending || []).map((a) => `<div class="sys-row">
      <div><b>${esc(a.song)}</b> <span class="badge warn">old WAV not archived yet</span></div>
      <div class="dv-meta">waiting since ${esc(timeAgo(a.since))} — the computer that holds it must be on</div>
    </div>`);

  $('sysList').innerHTML = `
    <div class="panel"><h2>At a glance</h2>
      <div class="sys-stats">
        <div><b>${c.songs ?? '—'}</b><span>songs</span></div>
        <div><b>${c.with_audio ?? '—'}</b><span>with audio</span></div>
        <div><b>${c.jobs_running ?? '—'}</b><span>jobs running</span></div>
        <div><b>${c.verified_12h ?? '—'}</b><span>checked in 12h</span></div>
        <div><b>${data.missing_files ?? '—'}</b><span>files missing on disk</span></div>
      </div>
    </div>
    ${section('Studio computers', devices, 'No computer has reported yet.', false)}
    ${section('Needs your attention', jobs, 'No stuck work.')}
    ${section('WAV uploads stopped', wav, 'All WAV uploads are fine.')}
    ${section('Audio missing from storage', miss, 'Every song that should have audio still has it.')}
    ${section('Archiving to Cancel Song', arch, 'Nothing waiting to be archived.')}`;
}

export function init(c) {
  ctx = c;
  on($('sysList'), 'click', 'System', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) {
      const s = state.songs.find((x) => x.id === open.dataset.open);
      if (s) ctx.openTab('v:' + s.vocalist_id);
      return;
    }
    const retry = e.target.closest('[data-retry]');
    if (retry) {
      const { error } = await sb.rpc('retry_job', { p_job: retry.dataset.retry });
      if (error) return toast('Failed: ' + error.message, 'bad');
      toast('Trying again');
      render();
      return;
    }
    // Dismiss hanya menyingkirkan BARIS-nya. Lagu, audio dan file tidak disentuh sama sekali.
    const dis = e.target.closest('[data-dismiss]');
    if (dis) {
      if (!confirm('Hilangkan baris ini dari halaman System?\n\nLagunya sendiri tidak disentuh — audio dan filenya tetap seperti sekarang.')) return;
      const { error } = await sb.rpc('dismiss_job', { p_job: dis.dataset.dismiss });
      if (error) return toast('Failed: ' + error.message, 'bad');
      toast('Baris disingkirkan');
      ctx.reload();
    }
  });
}
