// ADMIN — modul Tabel lagu & harga: ringkasan, link vokalis, harga, Paid, isi massal, Hapus.
// Tombol "Ganti" diteruskan ke modul revisi lewat ctx.openReplace().
import { sb } from '/js/core/supabase.js';
import { PRICES } from '/js/core/config.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';
import { rupiah, ribu, esc, norm, dateLabel, summarize, fmtDate } from '/js/core/format.js';
import { state, curVoc, vocSongs, shareUrl, updateSong } from './data.js';

let ctx;

export function render() {
  const v = curVoc(); if (!v) return;
  const songs = vocSongs();
  const sum = summarize(songs);
  $('vName').textContent = v.display_name;
  $('vSub').textContent = `${songs.length} lagu · ${sum.priced} sudah diberi harga` + (v.active ? '' : ' · folder tidak ditemukan di PC');
  $('sTotal').textContent = rupiah(sum.total);
  $('sPaid').textContent = rupiah(sum.paid);
  $('sRest').textContent = rupiah(sum.rest);
  $('sCount').textContent = `${sum.paidCount} / ${sum.count}`;
  $('vLink').value = shareUrl(v);
  $('openLink').href = shareUrl(v);
  $('bulkBtns').innerHTML = PRICES.map((p) => `<button data-bulk="${p}">${ribu(p)}</button>`).join(' ');
  renderTable();
}

function renderTable() {
  if (state.errors.songs) { $('table').innerHTML = `<div class="empty">Data lagu gagal dimuat. Tekan Muat ulang.</div>`; return; }
  const q = norm($('q').value.trim());
  const st = $('status').value;
  const all = vocSongs().map((s, i) => ({ ...s, n: i + 1 }));
  const rows = all.filter((s) => (!q || norm(s.title).includes(q)) &&
    (!st || (st === 'paid' ? s.paid : st === 'unpaid' ? !s.paid : !s.price)));
  if (!all.length) { $('table').innerHTML = `<div class="empty">Belum ada lagu untuk vokalis ini.</div>`; return; }
  if (!rows.length) { $('table').innerHTML = `<div class="empty">Tidak ada lagu yang cocok.</div>`; return; }
  const sum = summarize(rows);
  $('table').innerHTML =
    `<div class="row head cols-admin"><span>No</span><span>Tanggal</span><span>Judul</span><span>Harga</span><span>Status</span><span>Aksi</span></div>` +
    rows.map((s) => `<div class="row cols-admin ${s.paid ? 'paid' : ''}" data-id="${s.id}">
      <span class="no dim">${s.n}</span>
      <span class="date dim" title="${esc(s.rel_path)}">${esc(dateLabel(s))}</span>
      <span class="title dim" title="${esc(s.file_name)}">${esc(s.title)}${s.revision ? ` <span class="badge muted" title="Diganti ${esc(fmtDate(s.replaced_at))} · file: ${esc(s.file_name)}">revisi ${s.revision}</span>` : ''}${s.missing ? ' <span class="badge bad" title="File sudah tidak ada di PC; lagu tetap tersimpan sebagai riwayat">file tidak ada di PC</span>' : ''}</span>
      <span class="price dim"><select data-price="${s.id}" ${s.paid ? 'disabled' : ''} aria-label="Harga ${esc(s.title)}">
        <option value="">—</option>
        ${PRICES.concat(s.price && !PRICES.includes(s.price) ? [s.price] : []).map((p) => `<option value="${p}" ${s.price === p ? 'selected' : ''}>${ribu(p)}</option>`).join('')}
      </select></span>
      <span class="act"><button class="paidbtn ${s.paid ? 'on' : ''}" data-paid="${s.id}" aria-pressed="${s.paid}">${s.paid ? '✓ Lunas' : 'Paid'}</button></span>
      <span class="ops"><button class="mini" data-rep="${s.id}" title="Ganti dengan file revisi">Ganti</button><button class="mini danger" data-del="${s.id}" title="Hapus dari daftar">Hapus</button></span>
    </div>`).join('') +
    `<div class="row foot cols-admin"><span class="no"></span><span class="date"></span><span class="title" style="text-align:right">Total${q || st ? ' (tersaring)' : ''}</span><span class="price">${ribu(sum.total)}</span><span class="act"></span><span class="ops"></span></div>`;
}

export function resetFilters() {
  $('q').value = '';
  $('status').value = '';
}

export function init(c) {
  ctx = c;
  const L = 'Tabel lagu';

  on($('q'), 'input', L, renderTable);
  on($('status'), 'change', L, renderTable);

  on($('table'), 'change', L, async (e) => {
    const id = e.target.dataset.price; if (!id) return;
    const v = e.target.value ? Number(e.target.value) : null;
    if (await updateSong(id, { price: v }, ctx.renderAll)) toast('Harga disimpan');
  });

  on($('table'), 'click', L, async (e) => {
    const pid = e.target.closest('[data-paid]')?.dataset.paid;
    if (pid) {
      const s = state.songs.find((x) => x.id === pid);
      if (!s.paid && !s.price) { toast('Pilih harga dulu sebelum menandai lunas', 'bad'); return; }
      if (await updateSong(pid, { paid: !s.paid }, ctx.renderAll)) toast(s.paid ? 'Ditandai lunas' : 'Status lunas dibatalkan');
      return;
    }
    const did = e.target.dataset.del;
    if (did) {
      const s = state.songs.find((x) => x.id === did);
      const extra = s.paid ? `\n\nLagu ini sudah LUNAS (${ribu(s.price)}). Kalau dihapus, nilainya tidak dihitung lagi di invoice.` : '';
      if (!confirm(`Hapus "${s.title}" dari daftar?\n\nLagu ini hilang dari halaman vokalis dan tidak dimasukkan lagi oleh sync. Bisa dikembalikan dari bagian "Terhapus".${extra}`)) return;
      if (await updateSong(did, { deleted: true }, ctx.renderAll)) toast('Lagu dihapus dari daftar');
      return;
    }
    const rid = e.target.dataset.rep;
    if (rid) ctx.openReplace(rid);
  });

  on($('bulkBtns'), 'click', L, async (e) => {
    const p = Number(e.target.dataset.bulk); if (!p) return;
    const v = curVoc();
    const targets = vocSongs().filter((s) => !s.price && !s.paid);
    if (!targets.length) return toast('Semua lagu sudah punya harga');
    if (!confirm(`Isi harga ${ribu(p)} untuk ${targets.length} lagu ${v.display_name} yang masih kosong?`)) return;
    const { error } = await sb.from('songs').update({ price: p }).in('id', targets.map((s) => s.id));
    if (error) return toast('Gagal: ' + error.message, 'bad');
    targets.forEach((s) => (s.price = p));
    ctx.renderAll();
    toast(`${targets.length} lagu diisi ${ribu(p)}`);
  });

  on($('copyLink'), 'click', L, async () => {
    try { await navigator.clipboard.writeText($('vLink').value); toast('Link disalin'); }
    catch { $('vLink').select(); toast('Tekan Ctrl+C untuk menyalin'); }
  });
}
