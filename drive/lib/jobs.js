'use strict';
// MEDIA — pekerjaan dari database (finalisasi, arsip, hapus). Kunci pekerjaan berupa "sewa"
// (lease) di database: selama sewa milik komputer ini masih hidup, komputer lain tidak bisa
// mengambil pekerjaan yang sama. Sewa diperpanjang selama bekerja, dan habis sendiri kalau
// komputer ini mati — jadi tidak ada pekerjaan yang tertahan selamanya.
const LEASE_S = 300;

function createJobs(cfg, rpc) {
  const device = (cfg.device || {}).id || null;

  return {
    device,
    /** Ambil pekerjaan untuk komputer ini. */
    claim: (kinds, limit = 3) => rpc('claim_jobs', { p_device: device, p_kinds: kinds, p_limit: limit }),
    /** Simpan tahap + perpanjang sewa. Jawaban 'lost' = sewa diambil komputer lain → berhenti. */
    progress: (id, stage) => rpc('job_progress', { p_device: device, p_job: id, p_stage: stage, p_lease: LEASE_S }),
    finish: (id, status, result, error) =>
      rpc('job_finish', { p_device: device, p_job: id, p_status: status, p_result: result || null, p_error: error || null }),
    /** Jadikan versi ini yang aktif. Hanya dipanggil setelah file terbukti benar ada di R2. */
    activate: (id, key, md5, size) =>
      rpc('activate_version', { p_device: device, p_job: id, p_key: key, p_md5: md5, p_size: size }),
  };
}

module.exports = { createJobs, LEASE_S };
