'use strict';
// SYNC — Pusher: mengirim hasil scan ke database lewat RPC sync_files.
// Hanya tahu jaringan; tidak membaca disk.
const TIMEOUT_MS = 60000;

async function push(cfg, snap) {
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
      body: JSON.stringify({ p_secret: cfg.syncSecret, p_folders: snap.folders, p_files: snap.files }),
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

module.exports = { push };
