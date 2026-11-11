// Segmen CORE — Listen Together: menyelaraskan pemutaran antara dua browser.
//
// Musiknya TIDAK pernah dikirim lewat jaringan. Kedua sisi memutar filenya sendiri dari R2;
// yang dikirim hanya kalimat pendek "lagu ini, dari detik 42, pada pukul sekian menurut jamku".
// Karena itu kualitas suaranya sama persis dengan memutar sendirian.
//
// Dua jam yang berbeda tidak pernah sama. Jadi sebelum menyimak, sisi penumpang menukar cap
// waktu beberapa kali dengan sisi pemimpin untuk menghitung SELISIH jamnya — cara yang sama
// dipakai komputer menyetel jamnya ke internet. Setelah selisih diketahui, "pukul sekian
// menurut jammu" bisa diterjemahkan ke "pukul sekian menurut jamku".
//
// Bagian matematika di atas sengaja dipisah sebagai fungsi murni di bawah ini supaya bisa diuji
// tanpa browser dan tanpa jaringan.

// ============================ bagian murni (bisa diuji) ============================

/**
 * Selisih jam dari beberapa kali tukar cap waktu.
 *
 * Satu sampel: penumpang mengirim pada t0, pemimpin menjawab dengan jamnya (host),
 * penumpang menerima pada t2. Kalau perjalanan bolak-balik seimbang, jam pemimpin saat
 * tengah perjalanan adalah (t0+t2)/2 menurut jam penumpang, jadi selisihnya host - (t0+t2)/2.
 *
 * Sampel dengan perjalanan TERCEPAT yang dipakai, bukan rata-rata: perjalanan yang lambat
 * hampir selalu lambat karena tertahan di satu arah saja, dan itu justru menyesatkan.
 */
export function estimateOffset(samples) {
  const ok = samples.filter((s) => Number.isFinite(s.t0) && Number.isFinite(s.t2) && Number.isFinite(s.host) && s.t2 >= s.t0);
  if (!ok.length) return null;
  let best = ok[0], bestRtt = ok[0].t2 - ok[0].t0;
  for (const s of ok) {
    const rtt = s.t2 - s.t0;
    if (rtt < bestRtt) { best = s; bestRtt = rtt; }
  }
  return { offset: best.host - (best.t0 + best.t2) / 2, rtt: bestRtt, samples: ok.length };
}

/**
 * Di detik ke berapa lagu SEHARUSNYA berada sekarang, menurut keadaan yang dikirim pemimpin.
 * state: { pos, at, playing, duration? } — 'at' adalah jam pemimpin saat posisinya masih 'pos'.
 */
export function targetPosition(state, offset, localNow) {
  if (!state) return null;
  if (!state.playing) return state.pos;
  const hostNow = localNow + offset;          // jam pemimpin sekarang, menurut jam kita
  const t = state.pos + (hostNow - state.at) / 1000;
  if (t < 0) return 0;
  if (Number.isFinite(state.duration) && state.duration > 0) return Math.min(t, state.duration);
  return t;
}

// Ambang-ambang koreksi. 50 ms jauh di bawah yang bisa didengar sebagai "tidak serempak";
// 500 ms sudah terdengar jelas salah, jadi di atas itu lebih baik melompat sekalian.
export const TIGHT = 0.05;
export const JUMP = 0.5;
const MAX_RATE = 0.04;   // paling banyak 4% lebih cepat/lambat — tidak terdengar sebagai perubahan nada

/**
 * Apa yang harus dilakukan kalau kita meleset 'err' detik (positif = kita ketinggalan).
 * Melompat hanya kalau melesetnya besar; selisih kecil dikejar dengan mempercepat sedikit,
 * supaya tidak ada bunyi "klik" atau potongan di tengah lagu.
 */
export function correction(err) {
  if (!Number.isFinite(err)) return { seek: false, rate: 1 };
  if (Math.abs(err) > JUMP) return { seek: true, rate: 1 };
  if (Math.abs(err) <= TIGHT) return { seek: false, rate: 1 };
  const r = 1 + Math.max(-MAX_RATE, Math.min(MAX_RATE, err * 0.5));
  return { seek: false, rate: r };
}

// ============================ bagian jaringan ============================

const PINGS = 7;            // cukup untuk mendapat satu perjalanan yang cepat
const PING_GAP = 120;       // ms antar cap waktu
const BEAT_MS = 2000;       // pemimpin mengulang keadaannya tiap 2 detik
const RESYNC_MS = 30000;    // selisih jam dihitung ulang tiap 30 detik

const rid = () => Math.random().toString(36).slice(2, 10);

// Pesan panggilan suara yang boleh lewat saluran ini. Daftar tertutup supaya tidak ada
// jenis pesan tak terduga yang ikut terkirim.
const SIGNALS = ['rtc-desc', 'rtc-ice', 'rtc-call', 'rtc-ready', 'rtc-bye'];

/**
 * Saluran satu sesi menyimak bersama.
 *
 * Catatan keamanan yang jujur: nama salurannya adalah kode ruang, dan siapa pun yang tahu kode
 * itu bisa ikut mendengarkan. Itu setingkat dengan link vokalis yang sudah ada — siapa pun yang
 * punya linknya bisa membuka halamannya — dan kode ruang jauh lebih pendek umurnya.
 */
export function createSession({ code, role, onState, onPeers, onClock, onReport, onSignal, onError, clock }) {
  if (!code) throw new Error('code wajib');
  // Jam bisa disuntik supaya dua sisi dengan jam berbeda bisa diuji tanpa browser.
  const now = clock || (() => Date.now());
  const isHost = role === 'host';
  const me = rid();

  let ch = null;
  let hostId = isHost ? me : null;    // penumpang mengunci pada pemimpin pertama yang terdengar
  let offset = isHost ? 0 : null;
  let rtt = null;
  let state = null;                   // { songId, pos, at, playing, duration }
  let pending = new Map();            // id ping -> t0
  let samples = [];
  let beat = null, resync = null;
  let closed = false;

  const say = (event, payload) => {
    if (!ch || closed) return;
    try { ch.send({ type: 'broadcast', event, payload }); } catch (e) { onError?.(e); }
  };

  // ---- pemimpin: menjawab cap waktu, dan mengulang keadaannya ----
  function onPing(p) {
    if (!isHost) return;
    say('pong', { id: p.id, to: p.from, t0: p.t0, host: now(), hostId: me });
  }

  // ---- penumpang: mengukur selisih jam ----
  function onPong(p) {
    if (isHost || p.to !== me) return;
    const t0 = pending.get(p.id);
    if (t0 === undefined) return;
    pending.delete(p.id);
    samples.push({ t0, t2: now(), host: p.host });
    const est = estimateOffset(samples);
    if (est) { offset = est.offset; rtt = est.rtt; onClock?.({ offset, rtt, samples: est.samples }); }
  }

  async function measure() {
    if (isHost || closed) return;
    samples = [];
    for (let i = 0; i < PINGS && !closed; i++) {
      const id = rid();
      pending.set(id, now());
      say('ping', { id, from: me, t0: now() });
      await new Promise((r) => setTimeout(r, PING_GAP));
    }
    // ping yang tidak dijawab dibuang supaya tidak menumpuk
    setTimeout(() => { pending.clear(); }, 3000);
  }

  function onStateMsg(p) {
    if (isHost) return;                       // pemimpin tidak mendengarkan perintah siapa pun
    if (!hostId) hostId = p.hostId;            // pemimpin pertama yang terdengar
    if (p.hostId !== hostId) return;           // sisanya diabaikan, tidak ada tarik-menarik
    state = p;
    if (offset !== null) onState?.(p, offset);
  }

  return {
    get offset() { return offset; },
    get rtt() { return rtt; },
    get state() { return state; },
    get ready() { return isHost || offset !== null; },

    async join(meta = {}) {
      ch = await sbChannel(code, me);
      ch.on('broadcast', { event: 'ping' }, ({ payload }) => onPing(payload));
      ch.on('broadcast', { event: 'pong' }, ({ payload }) => onPong(payload));
      ch.on('broadcast', { event: 'state' }, ({ payload }) => onStateMsg(payload));
      ch.on('broadcast', { event: 'hello' }, () => { if (isHost && state) say('state', state); });
      ch.on('presence', { event: 'sync' }, () => {
        const all = Object.values(ch.presenceState()).flat();
        onPeers?.(all);
      });
      // Semua pendengar dipasang SEBELUM subscribe: menambahkannya sesudah itu tidak dijamin terpasang.
      if (onReport) ch.on('broadcast', { event: 'report' }, ({ payload }) => onReport(payload));
      // Pesan panggilan suara (WebRTC) menumpang saluran yang SAMA. Saluran kedua hanya
      // menambah titik gagal, dan urutan pesannya tidak lagi terjamin.
      if (onSignal) {
        for (const ev of SIGNALS) {
          ch.on('broadcast', { event: ev }, ({ payload }) => {
            if (!payload || payload.from === me) return;
            if (payload.to && payload.to !== me) return;
            onSignal(ev, payload);
          });
        }
      }

      await new Promise((resolve, reject) => {
        ch.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') resolve();
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(err || new Error(status));
        });
      });

      await ch.track({ id: me, role, ...meta });

      if (isHost) {
        beat = setInterval(() => { if (state) say('state', state); }, BEAT_MS);
      } else {
        say('hello', { from: me });            // minta keadaan terkini sekarang, tanpa menunggu
        await measure();
        resync = setInterval(measure, RESYNC_MS);
        if (state && offset !== null) onState?.(state, offset);
      }
    },

    /** Pemimpin: kabarkan keadaan baru. pos dalam detik. */
    setState({ songId, pos, playing, duration }) {
      if (!isHost) return;
      state = { hostId: me, songId, pos, playing: !!playing, duration, at: now() };
      say('state', state);
    },

    /** Penumpang: kabarkan apakah lagunya sudah termuat dan seberapa meleset. */
    report(info) { if (!isHost) say('report', { from: me, ...info }); },

    /** Siapa saya di saluran ini — dipakai pesan panggilan untuk saling menyebut. */
    get me() { return me; },

    /** Kode ruang: dipakai modul panggilan untuk meminta kredensial relay. */
    get code() { return code; },

    /** Kirim satu pesan panggilan suara. 'to' kosong berarti ke semua. */
    signal(event, payload) {
      if (!SIGNALS.includes(event)) throw new Error('pesan tidak dikenal: ' + event);
      say(event, { ...payload, from: me });
    },

    async leave() {
      closed = true;
      clearInterval(beat); clearInterval(resync);
      try { await ch?.untrack(); } catch {}
      try { await ch?.unsubscribe(); } catch {}
      ch = null;
    },
  };
}

// Dipisah, dan Supabase diimpor hanya saat benar-benar menyambung, supaya bagian murni di atas
// bisa diuji di node tanpa jaringan sama sekali.
let channelFactory = null;
export function setChannelFactory(fn) { channelFactory = fn; }
async function sbChannel(code, me) {
  if (channelFactory) return channelFactory(code, me);
  const { sb } = await import('/js/core/supabase.js');
  return sb.channel('listen:' + code, {
    config: { broadcast: { self: false }, presence: { key: me } },
  });
}
