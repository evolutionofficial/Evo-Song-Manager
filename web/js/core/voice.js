// Segmen CORE — panggilan suara (dan kamera, kalau dinyalakan) di dalam ruang menyimak.
//
// MUSIKNYA TIDAK PERNAH LEWAT SINI. Panggilan ini hanya membawa suara orang. Musik tetap
// diputar masing-masing dari R2 dan diselaraskan oleh listen.js. Itu sengaja: codec panggilan
// dibuat untuk suara bicara (mono, sempit, ada peredam bising), dan kalau musik ikut dikirim
// lewat jalur ini hasilnya akan lebih buruk daripada memutar sendiri.
//
// Pesan perundingannya menumpang saluran realtime yang sama dengan perintah musik, jadi tidak
// ada sambungan kedua yang bisa gagal sendiri.
//
// Dua sisi bisa menekan "panggil" hampir bersamaan, dan itu akan merusak perundingan kalau
// tidak diatur. Jadi dipakai pola yang sudah baku: satu sisi "tidak sopan" (admin — tawarannya
// selalu menang) dan satu sisi "sopan" (vokalis — mengalah dan mengulang). Tanpa ini, tabrakan
// bikin panggilan gagal dengan cara yang sangat sulit ditelusuri.
//
// Kalau panggilan gagal, MUSIKNYA HARUS TETAP JALAN. Itu syarat utama di sini: semua kesalahan
// ditangkap di dalam modul ini dan tidak pernah dibiarkan menjatuhkan sesi menyimak.

const MIC = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

// Yang dikirim lewat saluran harus DATA BIASA, bukan objek browser yang hidup.
// RTCSessionDescription dan RTCIceCandidate tidak bisa disalin antar-konteks, dan kalaupun
// sebuah transport berhasil mengubahnya sendiri, mengandalkan itu rapuh — jadi diubah di sini.
const plainDesc = (d) => (d ? { type: d.type, sdp: d.sdp } : null);
const plainCand = (c) => (c
  ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment }
  : null);
const CAM = { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 } };

// Layar DAW penuh tulisan kecil, jadi yang diutamakan KETAJAMAN, bukan kehalusan gerak:
// resolusi tinggi dengan frame rate rendah. Kebalikan dari setelan kamera. Kalau nanti terasa
// patah-patah saat menggeser timeline, frameRate yang dinaikkan, bukan resolusinya diturunkan.
const SCREEN = {
  width: { ideal: 1920, max: 2560 },
  height: { ideal: 1080, max: 1440 },
  frameRate: { ideal: 8, max: 15 },
};

/**
 * @param session  sesi dari listen.js (createSession) — dipakai untuk mengirim pesan
 * @param role     'host' | 'guest'
 * @param onState  (state, info) => void. state: idle|asking|ringing|connecting|live|failed
 * @param onRemote (MediaStream|null) => void
 */
export function createVoice({ session, role, onState, onRemote, onError }) {
  const impolite = role === 'host';

  let pc = null;
  let local = null;            // MediaStream dari mikrofon/kamera kita
  let remote = null;
  let state = 'idle';
  let info = {};               // { relay, reason, rtt, video }
  let muted = false;
  let wantVideo = false;
  let camSender = null;
  // Berbagi layar MENGGANTI track kamera di pengirim yang sama, bukan menambah track kedua.
  // Alasannya dua: satu m-line berarti tidak perlu perundingan ulang sama sekali (replaceTrack
  // langsung tukar isi), dan sisi penerima tidak perlu menebak mana kamera mana layar.
  // Kamera yang tergusur disimpan di sini supaya bisa dipulihkan saat berbagi layar dihentikan.
  let screenTrack = null;
  let camBefore = null;
  let screenAdded = false;    // true kalau pengirimnya kita yang buat (kamera sedang mati)

  // Keadaan pola "sopan/tidak sopan".
  let makingOffer = false;
  let ignoreOffer = false;
  let ending = false;

  // Pesan bisa datang sebelum sambungan kita siap, karena kedua sisi bergerak sendiri-sendiri.
  // Dulu pesan seperti itu dibuang, dan akibatnya perundingan bisa mati tanpa jejak: tawaran
  // hilang, tidak ada yang menawarkan lagi, panggilan menggantung selamanya. Jadi disangga.
  let pendingDesc = null;
  let pendingIce = [];
  let peerReady = false;   // sisi lain sudah punya mikrofon

  const set = (s, extra) => {
    state = s;
    if (extra) info = { ...info, ...extra };
    try { onState?.(s, info); } catch (_) { /* tampilan tidak boleh menjatuhkan panggilan */ }
  };
  const oops = (e) => { try { onError?.(e); } catch (_) {} };

  // ------------------------------------------------------------------ ICE

  async function iceServers() {
    // Kalau /turn tidak bisa dihubungi, panggilan tetap dicoba dengan STUN bawaan: di banyak
    // jaringan rumah itu cukup. Lebih baik mencoba daripada menolak memanggil.
    try {
      const res = await fetch(`/turn?room=${encodeURIComponent(session.code)}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('turn ' + res.status);
      const d = await res.json();
      info = { ...info, relay: !!d.relay, reason: d.reason || null };
      return Array.isArray(d.iceServers) && d.iceServers.length
        ? d.iceServers : [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    } catch (e) {
      info = { ...info, relay: false, reason: 'turn_unreachable' };
      return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
    }
  }

  // ------------------------------------------------------------------ sambungan

  async function build() {
    pc = new RTCPeerConnection({ iceServers: await iceServers(), bundlePolicy: 'max-bundle' });

    pc.onnegotiationneeded = async () => {
      try {
        makingOffer = true;
        await pc.setLocalDescription();
        session.signal('rtc-desc', { sdp: plainDesc(pc.localDescription) });
      } catch (e) { oops(e); } finally { makingOffer = false; }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) { try { session.signal('rtc-ice', { candidate: plainCand(candidate) }); } catch (e) { oops(e); } }
    };

    pc.ontrack = (e) => {
      remote = e.streams[0] || new MediaStream([e.track]);
      try { onRemote?.(remote); } catch (_) {}
      // Beberapa browser baru memberi 'connected' setelah track pertama tiba.
      if (pc.connectionState === 'connected') set('live');
    };

    pc.onconnectionstatechange = () => {
      if (!pc || ending) return;
      const s = pc.connectionState;
      if (s === 'connected') set('live');
      else if (s === 'connecting') set('connecting');
      else if (s === 'disconnected') set('connecting', { note: 'reconnecting' });
      else if (s === 'failed') {
        // Satu kali coba sambung ulang sebelum menyerah: jaringan seluler sering pindah jalur.
        try { pc.restartIce(); } catch (_) {}
        set('failed', { note: info.relay ? 'network' : 'no_relay' });
      }
    };
    return pc;
  }

  /** Buat sambungan dan masukkan track kita. Dipanggil hanya kalau KEDUA sisi sudah siap. */
  async function connect() {
    if (pc || !local) return;
    await build();
    for (const t of local.getTracks()) {
      const sender = pc.addTrack(t, local);
      if (t.kind === 'video') camSender = sender;
    }
    set('connecting', { video: local.getVideoTracks().length > 0 });

    // Apa pun yang sudah datang lebih dulu, dipakai sekarang.
    if (pendingDesc) { const d = pendingDesc; pendingDesc = null; await onDesc(d); }
    await drainIce();
  }

  async function drainIce() {
    if (!pc || !pc.remoteDescription) return;
    const list = pendingIce; pendingIce = [];
    for (const c of list) {
      try { await pc.addIceCandidate(c); } catch (e) { if (!ignoreOffer) oops(e); }
    }
  }

  /** Minta mikrofon (dan kamera kalau diminta). Harus dari tindakan orang, bukan otomatis. */
  async function getMedia(video) {
    if (!navigator.mediaDevices?.getUserMedia) {
      // Penyebab paling sering BUKAN browsernya, melainkan halaman yang dibuka lewat sambungan
      // tidak aman: mikrofon hanya boleh dipakai di https (atau localhost).
      const insecure = !window.isSecureContext;
      const e = new Error(insecure
        ? 'Mikrofon hanya bisa dipakai kalau halaman dibuka lewat https'
        : 'Browser ini tidak bisa memakai mikrofon');
      e.__kind = insecure ? 'insecure' : 'unsupported'; throw e;
    }
    set('asking');
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: MIC, video: video ? CAM : false });
    } catch (e) {
      // Kamera ditolak/tidak ada tapi mikrofon mungkin masih bisa: coba suara saja.
      if (video) {
        try { wantVideo = false; return await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false }); }
        catch (e2) { e2.__kind = 'denied'; throw e2; }
      }
      e.__kind = 'denied'; throw e;
    }
  }

  /** Ambil mikrofon saja. Sambungan dibuat terpisah, setelah sisi lain juga siap. */
  async function grab(video) {
    local = await getMedia(video);
    for (const t of local.getAudioTracks()) t.enabled = !muted;
  }

  // ------------------------------------------------------------------ pesan masuk

  async function onDesc({ sdp }) {
    if (!sdp) return;
    try {
      if (!pc) {
        // Datang sebelum sambungan kita ada. Disimpan, bukan dibuang — nanti dipakai begitu
        // sambungannya dibuat. Mikrofon TIDAK dinyalakan diam-diam: tunggu orangnya menjawab.
        pendingDesc = { sdp };
        if (state === 'idle') set('ringing');
        return;
      }
      const collision = sdp.type === 'offer' && (makingOffer || pc.signalingState !== 'stable');
      ignoreOffer = impolite && collision;
      if (ignoreOffer) return;                       // sisi tidak sopan menang

      if (collision) {
        // Sisi sopan mengalah: batalkan tawaran kita, lalu terima tawaran mereka.
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }).catch(() => {}),
          pc.setRemoteDescription(sdp),
        ]);
      } else {
        await pc.setRemoteDescription(sdp);
      }
      if (sdp.type === 'offer') {
        await pc.setLocalDescription();
        session.signal('rtc-desc', { sdp: plainDesc(pc.localDescription) });
      }
      await drainIce();
    } catch (e) { oops(e); }
  }

  async function onIce({ candidate }) {
    if (!candidate) return;
    // addIceCandidate hanya sah setelah remote description dipasang; sebelum itu disangga.
    if (!pc || !pc.remoteDescription) {
      pendingIce.push(candidate);
      if (pendingIce.length > 120) pendingIce.shift();
      return;
    }
    try { await pc.addIceCandidate(candidate); }
    catch (e) { if (!ignoreOffer) oops(e); }
  }

  function teardown() {
    ending = true;
    try { for (const t of local?.getTracks() || []) t.stop(); } catch (_) {}
    try { screenTrack?.stop(); } catch (_) {}
    try { camBefore?.stop(); } catch (_) {}
    try { pc?.close(); } catch (_) {}
    pc = null; local = null; remote = null; camSender = null;
    screenTrack = null; camBefore = null; screenAdded = false;
    makingOffer = false; ignoreOffer = false;
    pendingDesc = null; pendingIce = []; peerReady = false;
    try { onRemote?.(null); } catch (_) {}
    ending = false;
  }

  // ------------------------------------------------------------------ yang dipakai di luar

  // Diberi nama supaya setScreen bisa memanggil dirinya sendiri saat browser menghentikan
  // berbagi layar dari tombolnya sendiri.
  const api = {
    get state() { return state; },
    get info() { return info; },
    get muted() { return muted; },
    get hasVideo() { return !!local?.getVideoTracks().length; },
    get localStream() { return local; },

    /**
     * Mulai memanggil, atau menjawab panggilan yang berdering — keduanya sama saja:
     * ambil mikrofon, bilang "saya siap", dan sambungan dibuat begitu sisi lain juga siap.
     * Harus dari klik, karena izin mikrofon hanya boleh diminta oleh tindakan orang.
     */
    async call({ video = false } = {}) {
      if (pc || local) return;
      wantVideo = video;
      try {
        await grab(video);
        set(peerReady || pendingDesc ? 'connecting' : 'calling');
        session.signal('rtc-ready', {});
        session.signal('rtc-call', {});
        // Sisi lain sudah siap lebih dulu (atau tawarannya sudah menunggu) → sambung sekarang.
        if (peerReady || pendingDesc) await connect();
      } catch (e) {
        teardown();
        set('failed', { note: e.__kind || 'unsupported' });
        oops(e);
      }
    },

    answer(opts) { return this.call(opts); },

    hangUp() {
      if (state === 'idle') return;
      try { session.signal('rtc-bye', {}); } catch (_) {}
      teardown();
      set('idle', { note: null });
    },

    setMuted(on) {
      muted = !!on;
      for (const t of local?.getAudioTracks() || []) t.enabled = !muted;
      set(state);
    },

    /** Kamera dinyalakan/dimatikan di tengah panggilan: track-nya ditambah/dicabut sungguhan,
     *  bukan hanya dibisukan, supaya lampu kamera benar-benar mati saat dimatikan. */
    async setCamera(on) {
      if (!pc) { wantVideo = !!on; return; }
      try {
        if (on && !camSender) {
          const cam = await navigator.mediaDevices.getUserMedia({ video: CAM });
          const t = cam.getVideoTracks()[0];
          if (!t) return;
          local.addTrack(t);
          camSender = pc.addTrack(t, local);
          set(state, { video: true });
        } else if (!on && camSender) {
          const t = camSender.track;
          pc.removeTrack(camSender);
          camSender = null;
          if (t) { t.stop(); try { local.removeTrack(t); } catch (_) {} }
          set(state, { video: false });
        }
      } catch (e) { oops(e); }
    },

    get sharing() { return !!screenTrack; },

    /**
     * Berbagi layar. Track layar MENGGANTI track kamera di pengirim yang sama — lihat catatan
     * di deklarasi screenTrack. Harus dipicu klik: izin berbagi layar hanya boleh diminta oleh
     * tindakan orang, dan browser memang akan menolak kalau tidak.
     */
    async setScreen(on) {
      if (!pc) return false;
      try {
        if (on && !screenTrack) {
          if (!navigator.mediaDevices?.getDisplayMedia) {
            set(state, { screen: false, screenNote: 'unsupported' });
            return false;
          }
          // audio:false — suara DAW TIDAK diambil dari sini. Jalur itu beda-beda per sistem
          // operasi dan tidak memberi kita kendali setelan; suara DAW masuk lewat loopback
          // sebagai perangkat mikrofon (tahap 4).
          const disp = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN, audio: false });
          const t = disp.getVideoTracks()[0];
          if (!t) return false;
          screenTrack = t;

          // Browser punya tombol "Stop sharing" sendiri di luar halaman kita. Kalau itu yang
          // ditekan, kita harus tahu — tanpa ini, tampilan tetap mengaku sedang berbagi.
          t.addEventListener('ended', () => { api.setScreen(false); });

          if (camSender) {
            camBefore = camSender.track;        // kamera disimpan, tidak dimatikan
            await camSender.replaceTrack(t);    // satu m-line: tidak perlu perundingan ulang
            screenAdded = false;
          } else {
            local.addTrack(t);
            camSender = pc.addTrack(t, local);  // ini memicu perundingan ulang, memang perlu
            screenAdded = true;
          }
          set(state, { screen: true, screenNote: null });
          return true;
        }

        if (!on && screenTrack) {
          const t = screenTrack;
          screenTrack = null;
          if (screenAdded) {
            // Pengirimnya kita yang buat, jadi dicabut lagi sepenuhnya.
            try { pc.removeTrack(camSender); } catch (_) {}
            camSender = null;
            screenAdded = false;
            try { local.removeTrack(t); } catch (_) {}
          } else if (camSender) {
            // Kamera dipulihkan. Kalau track kameranya sudah mati (misalnya izinnya dicabut),
            // pengirimnya dikosongkan daripada menyiarkan gambar beku.
            const back = camBefore && camBefore.readyState === 'live' ? camBefore : null;
            try { await camSender.replaceTrack(back); } catch (e) { oops(e); }
          }
          camBefore = null;
          try { t.stop(); } catch (_) {}
          set(state, { screen: false });
          return false;
        }
        return !!screenTrack;
      } catch (e) {
        // Paling sering: orangnya menekan Cancel di dialog pemilih layar. Itu bukan kesalahan,
        // jadi tidak dilaporkan sebagai error — hanya dikembalikan ke keadaan tidak berbagi.
        screenTrack = null;
        set(state, { screen: false, screenNote: e?.name === 'NotAllowedError' ? 'cancelled' : 'failed' });
        if (e?.name !== 'NotAllowedError') oops(e);
        return false;
      }
    },

    /** Pesan dari saluran. Dipanggil listen.js, bukan dari luar. */
    handle(event, payload) {
      if (event === 'rtc-desc') return onDesc(payload);
      if (event === 'rtc-ice') return onIce(payload);
      if (event === 'rtc-bye') {
        if (state !== 'idle') { teardown(); set('idle', { note: 'ended_by_peer' }); }
        return;
      }
      if (event === 'rtc-call') {
        // Sisi lain menekan panggil. Kalau kita belum punya mikrofon, biarkan berdering.
        if (!local && state === 'idle') set('ringing');
        return;
      }
      if (event === 'rtc-ready') {
        peerReady = true;
        // Kedua sisi sudah punya mikrofon → inilah saatnya menyambung. Sengaja tidak lebih
        // cepat: sambungan yang dibuat saat sisi lain belum siap membuat tawaran terbuang.
        if (local && !pc) { set('connecting'); return connect(); }
        if (!local && state === 'idle') set('ringing');
        return;
      }
    },

    /** Keadaan mentah sambungan — untuk menelusuri masalah, bukan untuk ditampilkan. */
    get debug() {
      return pc ? {
        signaling: pc.signalingState, ice: pc.iceConnectionState,
        gathering: pc.iceGatheringState, conn: pc.connectionState,
        senders: pc.getSenders().length, receivers: pc.getReceivers().length,
        pendingIce: pendingIce.length, pendingDesc: !!pendingDesc, peerReady,
      } : { pc: null, peerReady, pendingDesc: !!pendingDesc, pendingIce: pendingIce.length };
    },

    /** Mutu sambungan, untuk ditampilkan apa adanya. */
    async quality() {
      if (!pc) return null;
      try {
        const stats = await pc.getStats();
        let rtt = null, relay = false;
        stats.forEach((r) => {
          if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.currentRoundTripTime != null) {
            rtt = Math.round(r.currentRoundTripTime * 1000);
          }
          if (r.type === 'local-candidate' && r.candidateType === 'relay') relay = true;
        });
        return { rtt, relay };
      } catch (e) { return null; }
    },

    stop() { teardown(); set('idle'); },
  };
  return api;
}
