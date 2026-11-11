'use strict';
// MEDIA — panggilan ke database (fungsi RPC yang memeriksa kunci agent sendiri).
const TIMEOUT_MS = 30000;

function createDb(cfg) {
  const device = cfg.device || {};
  async function rpc(name, args) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(cfg.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
        method: 'POST', signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey, Authorization: 'Bearer ' + cfg.anonKey },
        body: JSON.stringify({ p_secret: cfg.agentSecret, ...args }),
      });
      const text = await res.text();
      if (!res.ok) {
        let msg = text.slice(0, 200);
        try { msg = JSON.parse(text).message || msg; } catch (_) {}
        throw new Error(`database: ${msg}`);
      }
      return text ? JSON.parse(text) : null;
    } catch (e) {
      if (e.name === 'AbortError') throw new Error(`database tidak menjawab dalam ${TIMEOUT_MS / 1000} detik`);
      throw e;
    } finally { clearTimeout(timer); }
  }
  return {
    rpc,
    /** Pengaturan yang memengaruhi agent (sekarang: saklar Manual Finalization). */
    config: () => rpc('agent_config', {}),
    target: (relPath) => rpc('audio_target', { p_rel_path: relPath }),
    register: (a) => rpc('register_audio', { p_rel_path: a.relPath, p_key: a.key, p_file_name: a.fileName, p_size: a.size, p_md5: a.md5 }),
    heartbeat: async (info) => {
      await rpc('agent_heartbeat', { p_agent: 'media', p_info: info });
      if (device.id) {
        await rpc('device_hello', { p_device: device.id, p_name: device.name, p_platform: device.platform,
          p_sources: (cfg.sources || []).map((s) => s.name), p_agent: 'media', p_info: info });
      }
    },
    vocalists: () => rpc('agent_vocalists', {}),
    wavJobs: (sources) => rpc('wav_jobs', { p_sources: sources }),
    wavReport: (r) => rpc('wav_report', { p_id: r.id, p_status: r.status, p_drive_file_id: r.driveFileId || null,
      p_size: r.size ?? null, p_md5: r.md5 || null, p_error: r.error || null }),
  };
}

module.exports = { createDb };
