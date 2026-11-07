// ADMIN — lapisan data. Satu-satunya modul admin yang membaca/menulis tabel secara umum.
// Setiap sumber data dimuat terpisah: kalau satu gagal, yang lain tetap tampil.
import { sb } from '/js/core/supabase.js';
import { report } from '/js/core/guard.js';
import { toast } from '/js/core/ui.js';

export const state = {
  vocalists: [], songs: [], unmatched: [], settings: null,
  tab: null,
  errors: {}, // { sumber: pesan } untuk sumber data yang gagal dimuat
};

const SONG_COLS = 'id,vocalist_id,title,file_name,session_label,file_mtime,sort_date,price,paid,paid_at,missing,rel_path,deleted,deleted_at,revision,replaced_at,accepted_at';

const SOURCES = {
  vocalists: () => sb.from('vocalists').select('*').order('display_name'),
  songs: () => sb.from('songs').select(SONG_COLS).order('sort_date', { ascending: true, nullsFirst: false }),
  unmatched: () => sb.from('unmatched_files').select('*').order('file_mtime'),
  settings: () => sb.from('app_settings').select('*').eq('id', 1).single(),
};

export async function loadAll() {
  const keys = Object.keys(SOURCES);
  const res = await Promise.allSettled(keys.map((k) => SOURCES[k]()));
  res.forEach((r, i) => {
    const k = keys[i];
    const v = r.status === 'fulfilled' ? r.value : { error: r.reason };
    if (v?.error) {
      state.errors[k] = v.error.message || String(v.error);
      report('data:' + k, v.error);
    } else {
      state[k] = v.data;
      delete state.errors[k];
    }
  });
  const failed = Object.keys(state.errors);
  if (failed.length) toast('Some data failed to load: ' + failed.join(', '), 'bad');
  if (!state.tab || (state.tab.startsWith('v:') && !state.vocalists.some((x) => 'v:' + x.id === state.tab))) {
    state.tab = state.vocalists[0] ? 'v:' + state.vocalists[0].id : 'set';
  }
}

export const curVoc = () => state.vocalists.find((v) => 'v:' + v.id === state.tab);
export const vocSongs = () => state.songs.filter((s) => s.vocalist_id === curVoc()?.id && !s.deleted);
export const vocDeleted = () => state.songs.filter((s) => s.vocalist_id === curVoc()?.id && s.deleted);
export const shareUrl = (v) => `${location.origin}/v/${v.share_token}`;

/** Ubah satu lagu secara optimis; onChange dipanggil sebelum dan (kalau gagal) sesudah menyimpan. */
export async function updateSong(id, patch, onChange) {
  const s = state.songs.find((x) => x.id === id);
  if (!s) return false;
  const before = { ...s };
  Object.assign(s, patch);
  onChange?.();
  const { data, error } = await sb.from('songs').update(patch).eq('id', id)
    .select('id,price,paid,paid_at,deleted,deleted_at,accepted_at').single();
  if (error) {
    Object.assign(s, before);
    onChange?.();
    toast('Save failed: ' + error.message, 'bad');
    return false;
  }
  Object.assign(s, data);
  return true;
}
