// Segmen CORE — meter level masukan.
//
// Gunanya satu: menjawab "mikrofonku ini nyala atau tidak". Tanpa ini, slot yang salah pilih
// perangkat terlihat persis sama dengan slot yang benar — diam-diam tidak mengirim apa pun.
//
// SATU HAL YANG TIDAK BOLEH DILANGGAR: analyser TIDAK PERNAH disambungkan ke destination.
// Menyambungkannya berarti suara kita diputar balik ke speaker sendiri — itu monitoring, dan
// itulah yang melolong. Meter ini hanya MEMBACA, tidak pernah membunyikan apa pun.

const MIN_DB = -60;          // di bawah ini dianggap sunyi; kisaran yang wajar untuk meter
const PEAK_HOLD_MS = 1200;   // berapa lama garis puncak bertahan sebelum turun

export function createMeter(canvas) {
  let ctx = null, src = null, analyser = null, buf = null;
  let raf = 0, stream = null;
  let peak = MIN_DB, peakAt = 0;
  let lastSignal = 0;

  const g = canvas.getContext('2d');

  /** Amplitudo → dBFS. 1.0 = 0 dBFS (batas atas digital). */
  const toDb = (a) => (a > 0 ? 20 * Math.log10(a) : -Infinity);
  const pos = (db) => Math.max(0, Math.min(1, (db - MIN_DB) / (0 - MIN_DB)));

  function draw(rms, pk) {
    const w = canvas.width, h = canvas.height;
    const css = getComputedStyle(canvas);
    g.clearRect(0, 0, w, h);

    // Alur
    g.fillStyle = css.getPropertyValue('--meter-bg').trim() || 'rgba(255,255,255,.07)';
    g.fillRect(0, 0, w, h);

    // Batang level. Warnanya mengikuti kenyataan audio, bukan selera: hijau aman,
    // kuning mulai panas (-12 dBFS), merah mendekati kliping (-3 dBFS).
    const x = pos(rms) * w;
    if (x > 0) {
      const grad = g.createLinearGradient(0, 0, w, 0);
      grad.addColorStop(0, '#3ddc97');
      grad.addColorStop(pos(-12), '#3ddc97');
      grad.addColorStop(pos(-6), '#ffc24d');
      grad.addColorStop(pos(-3), '#ff5a5a');
      grad.addColorStop(1, '#ff5a5a');
      g.fillStyle = grad;
      g.fillRect(0, 0, x, h);
    }

    // Garis puncak: yang memberi tahu transien yang terlalu cepat dilihat batangnya.
    if (pk > MIN_DB) {
      const px = Math.max(1, pos(pk) * w);
      g.fillStyle = pk >= -3 ? '#ff5a5a' : 'rgba(255,255,255,.85)';
      g.fillRect(px - 1.5, 0, 2, h);
    }

    // Tanda skala di -12 dan -6 dBFS, supaya angkanya punya patokan visual.
    g.fillStyle = 'rgba(255,255,255,.18)';
    for (const db of [-40, -20, -12, -6]) g.fillRect(pos(db) * w, h * 0.55, 1, h * 0.45);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    if (!analyser) return;
    analyser.getFloatTimeDomainData(buf);

    let sum = 0, max = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = buf[i];
      sum += v * v;
      const a = Math.abs(v);
      if (a > max) max = a;
    }
    const rmsDb = toDb(Math.sqrt(sum / buf.length));
    const pkDb = toDb(max);

    const now = performance.now();
    if (pkDb > peak || now - peakAt > PEAK_HOLD_MS) { peak = pkDb; peakAt = now; }
    if (pkDb > MIN_DB) lastSignal = now;

    const shown = Math.max(rmsDb, MIN_DB);
    draw(shown, Math.max(peak, MIN_DB));
    // Angka dan batang harus bicara hal yang sama. Batang berhenti di -60 dBFS, jadi angkanya
    // juga — -115 dB itu lantai derau, bukan informasi yang berguna, dan hanya membingungkan
    // kalau batangnya sudah mentok.
    canvas.dataset.db = !Number.isFinite(rmsDb) || rmsDb <= MIN_DB ? 'floor' : shown.toFixed(0);
    // "Tidak ada sinyal" baru dinyatakan setelah 1,5 detik benar-benar sunyi — kalau langsung,
    // jeda alami antar kalimat akan terbaca sebagai mikrofon mati.
    canvas.dataset.silent = now - lastSignal > 1500 ? '1' : '0';
  }

  return {
    /** Pasang ke sebuah stream. Aman dipanggil berulang; stream lama dilepas sendiri. */
    async attach(s) {
      if (s === stream) return;
      this.detach();
      const track = s?.getAudioTracks?.()[0];
      if (!track) return;
      stream = s;
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        // Browser sering memulai AudioContext dalam keadaan ditangguhkan sampai ada
        // tindakan orang. Tanpa resume, meter diam padahal mikrofonnya sebenarnya hidup.
        if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) {} }
        src = ctx.createMediaStreamSource(new MediaStream([track]));
        analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        analyser.smoothingTimeConstant = 0.6;
        buf = new Float32Array(analyser.fftSize);
        src.connect(analyser);        // BERHENTI DI SINI. Tidak pernah ke ctx.destination.
        peak = MIN_DB; lastSignal = 0;
        if (!raf) loop();
      } catch (_) { this.detach(); }
    },

    detach() {
      cancelAnimationFrame(raf); raf = 0;
      try { src?.disconnect(); } catch (_) {}
      src = null; analyser = null; buf = null; stream = null;
      peak = MIN_DB;
      try { g.clearRect(0, 0, canvas.width, canvas.height); } catch (_) {}
      delete canvas.dataset.db;
      delete canvas.dataset.silent;
    },

    /** Dipanggil saat panel ditutup sepenuhnya. */
    close() {
      this.detach();
      try { ctx?.close(); } catch (_) {}
      ctx = null;
    },
  };
}
