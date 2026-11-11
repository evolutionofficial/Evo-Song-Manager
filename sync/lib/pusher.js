'use strict';
// SYNC — Pusher: mengirim hasil scan ke database lewat RPC sync_files.
// Hanya tahu jaringan; tidak membaca disk.
const TIMEOUT_MS = 60000;

async function rpc(cfg, name, body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`server tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Mendaftarkan komputer ini (nama, jenis, sumber folder yang dipegangnya). */
async function hello(cfg) {
  return rpc(cfg, 'device_hello', {
    p_secret: cfg.syncSecret,
    p_device: cfg.device.id,
    p_name: cfg.device.name,
    p_platform: cfg.device.platform,
    p_sources: cfg.sources.map((s) => s.name),
    p_agent: 'sync',
    p_info: null,
  });
}

async function push(cfg, snap, source = { name: 'pc', archive: false }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/sync_files', {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        apikey: cfg.anonKey,
        Authorization: 'Bearer ' + cfg.anonKey,
      },
      body: JSON.stringify({ p_secret: cfg.syncSecret, p_folders: snap.folders, p_files: snap.files,
        p_source: source.name, p_archive: source.archive, p_device: cfg.device ? cfg.device.id : null }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    return JSON.parse(text);
  } catch (e) {
    if (e.name === 'AbortError') throw new Error(`server tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { push, hello };
