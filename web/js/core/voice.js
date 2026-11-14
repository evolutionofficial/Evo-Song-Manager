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

/* Dua jenis sumber suara, dengan kebutuhan yang BERLAWANAN.
 *
 *   bicara : peredam gema, peredam bising, dan auto-gain menyala. Bagus untuk suara orang.
 *   musik  : ketiganya DIMATIKAN. Inilah seluruh alasan membangun panggilan ini sendiri
 *            dan tidak memakai Zoom: peredam bising menganggap bagian sunyi sebagai derau
 *            lalu memotongnya, auto-gain menaik-turunkan volume persis saat dinamika sedang
 *            dinilai, dan peredam gema meruntuhkan stereo jadi mono.
 *
 * Harga yang dibayar: tanpa peredam gema, speaker akan melolong. Rapat ini wajib headphone.
 */
const audioFor = (deviceId, music) => ({
  ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  echoCancellation: !music,
  noiseSuppression: !music,
  autoGainControl: !music,
  ...(music ? { channelCount: { ideal: 2 }, sampleRate: { ideal: 48000 } } : {}),
});

/* Opus default-nya mono dan hemat, karena dirancang untuk suara bicara. Untuk musik, stereo
 * dan bitrate tinggi harus diminta lewat SDP — tidak ada API JavaScript untuk ini, jadi baris
 * fmtp-nya memang disunting langsung. Dilakukan di KEDUA sisi tawaran supaya berlaku dua arah. */
function opusForMusic(sdp) {
  const pt = (sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i) || [])[1];
  if (!pt) return sdp;
  const want = 'stereo=1;sprop-stereo=1;maxaveragebitrate=256000;maxplaybackrate=48000;useinbandfec=1';
  const re = new RegExp('a=fmtp:' + pt + ' ([^\\r\\n]*)');
  if (re.test(sdp)) {
    return sdp.replace(re, (m, body) => {
      const keep = body.split(';').filter((x) => !/^(stereo|sprop-stereo|maxaveragebitrate|maxplaybackrate|useinbandfec)=/.test(x.trim()));
      return 'a=fmtp:' + pt + ' ' + [...keep, want].filter(Boolean).join(';');
    });
  }
  return sdp.replace(new RegExp('(a=rtpmap:' + pt + ' opus/48000/2[^\\r\\n]*)'), '$1\r\na=fmtp:' + pt + ' ' + want);
}

// Yang dikirim lewat saluran harus DATA BIASA, bukan objek browser yang hidup.
// RTCSessionDescription dan RTCIceCandidate tidak bisa disalin antar-konteks, dan kalaupun
// sebuah transport berhasil mengubahnya sendiri, mengandalkan itu rapuh — jadi diubah di sini.
const plainDesc = (d) => (d ? { type: d.type, sdp: d.sdp } : null);
const plainCand = (c) => (c
  ? { candidate: c.candidate, sdpMid: c.sdpMid, sdpMLineIndex: c.sdpMLineIndex, usernameFragment: c.usernameFragment }
  : null);
// facingMode 'user' disebut eksplisit: di HP, tanpa ini browser boleh memilih kamera belakang,
// dan yang dibutuhkan rapat adalah wajah orangnya. 'ideal' bukan 'exact' supaya laptop yang
// hanya punya satu kamera tidak gagal sama sekali.
const CAM = {
  width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 24 },
  facingMode: { ideal: 'user' },
};

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
  let micSender = null;        // supaya sumber suara bisa ditukar tanpa memutus panggilan
  let musicMode = false;       // true = jalur mutu musik (pemroses suara bicara dimatikan)
  let negotiatedMusic = false; // mode musik yang SUDAH tersampaikan lewat SDP
  let stuckTimer = null;       // penjaga waktu untuk 'connecting' yang tidak kunjung selesai
  let camFail = null;          // kenapa kamera tidak jadi menyala, untuk ditampilkan

  // Layar dikirim sebagai track KEDUA, berdampingan dengan kamera — bukan menggantikannya.
  // Jeffry ingin wajahnya tetap terlihat sementara DAW-nya dibagikan, jadi keduanya harus
  // hidup bersamaan. Konsekuensinya sisi penerima harus bisa membedakan mana kamera mana
  // layar; itu diselesaikan dengan MediaStream terpisah yang id-nya dikabarkan lewat pesan
  // 'studio-mode'. Menebak dari ukuran atau urutan track tidak bisa diandalkan.
  let screenTrack = null;
  let screenStream = null;
  let screenSender = null;
  // Dari sisi lain: id stream mana yang berisi layar, dan semua stream yang sudah tiba.
  let peerScreenId = null;
  const peerStreams = new Map();

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
        // Permintaan stereo + bitrate tinggi disisipkan ke SDP yang DIKIRIM. Tidak ada API
        // JavaScript untuk ini; baris fmtp Opus memang harus disunting sendiri.
        session.signal('rtc-desc', { sdp: musicSdp(plainDesc(pc.localDescription)) });
      } catch (e) { oops(e); } finally { makingOffer = false; }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) { try { session.signal('rtc-ice', { candidate: plainCand(candidate) }); } catch (e) { oops(e); } }
    };

    pc.ontrack = (e) => {
      const st = e.streams[0] || new MediaStream([e.track]);
      peerStreams.set(st.id, st);
      // Track yang berhenti (sisi lain menutup berbagi layar) harus ikut hilang dari layar,
      // kalau tidak yang tertinggal adalah gambar beku.
      e.track.addEventListener('ended', () => { peerStreams.delete(st.id); emitRemote(); });
      emitRemote();
      // Beberapa browser baru memberi 'connected' setelah track pertama tiba.
      if (pc.connectionState === 'connected') set('live');
    };

    pc.onconnectionstatechange = () => {
      if (!pc || ending) return;
      const s = pc.connectionState;
      if (s === 'connected') { clearTimeout(stuckTimer); stuckTimer = null; set('live'); }
      else if (s === 'connecting') set('connecting');
      else if (s === 'disconnected') set('connecting', { note: 'reconnecting' });
      else if (s === 'failed') {
        // Satu kali coba sambung ulang sebelum menyerah: jaringan seluler sering pindah jalur.
        try { pc.restartIce(); } catch (_) {}
        clearTimeout(stuckTimer); stuckTimer = null;
        set('failed', { note: info.relay ? 'network' : 'no_relay' });
      }
    };
    return pc;
  }

  /** Kirim ke halaman: mana stream kamera, mana stream layar. Pemisahannya berdasarkan id
   *  yang dikabarkan sisi lain lewat 'studio-mode' — bukan tebakan. */
  function emitRemote() {
    const screen = peerScreenId ? peerStreams.get(peerScreenId) || null : null;
    let cam = null;
    for (const st of peerStreams.values()) if (st !== screen) { cam = st; break; }
    remote = cam || screen || null;
    try { onRemote?.(cam, screen); } catch (_) {}
  }

  /** 'connecting' yang menggantung tidak pernah berubah jadi 'failed' dengan sendirinya:
   *  WebRTC hanya melapor gagal kalau ia SEMPAT mencoba dan kalah. Kalau sisi lain membeku —
   *  tab Safari yang dilatarbelakangkan di iOS berhenti menjalankan JavaScript sama sekali —
   *  tidak ada yang menjawab dan tidak ada pula yang gagal. Penjaga ini yang memutus diamnya. */
  function watchStuck() {
    clearTimeout(stuckTimer);
    stuckTimer = setTimeout(() => {
      if (!pc || ending) return;
      if (state === 'connecting' || state === 'calling') {
        set('failed', { note: 'stuck' });
      }
    }, 25000);
  }

  /** Buat sambungan dan masukkan track kita. Dipanggil hanya kalau KEDUA sisi sudah siap. */
  async function connect() {
    if (pc || !local) return;
    await build();
    for (const t of local.getTracks()) {
      const sender = pc.addTrack(t, local);
      if (t.kind === 'video') camSender = sender;
      if (t.kind === 'audio') micSender = sender;
    }
    set('connecting', { video: local.getVideoTracks().length > 0, cam: camFail });

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
      const st = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: video ? CAM : false });
      camFail = null;
      return st;
    } catch (e) {
      // Kamera ditolak/tidak ada tapi mikrofon mungkin masih bisa: panggilan diteruskan dengan
      // suara saja. Tapi SEBABNYA harus sampai ke layar — sebelumnya ini dilakukan diam-diam,
      // dan gejalanya "kamera saya tidak menyala" tanpa petunjuk apa pun.
      if (video) {
        try {
          const st = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
          wantVideo = false;
          camFail = camReason(e);
          return st;
        } catch (e2) { e2.__kind = 'denied'; throw e2; }
      }
      e.__kind = 'denied'; throw e;
    }
  }

  /** Ambil mikrofon saja. Sambungan dibuat terpisah, setelah sisi lain juga siap. */
  // Nama kesalahan dari browser diterjemahkan ke sebab yang bisa ditindak orangnya.
  // 'blocked' artinya prompt tidak akan muncul lagi: izinnya harus diubah di setelan browser.
  function camReason(e) {
    const n = e?.name || '';
    if (n === 'NotAllowedError') return 'blocked';
    if (n === 'NotFoundError' || n === 'OverconstrainedError') return 'nocam';
    if (n === 'NotReadableError' || n === 'AbortError') return 'busy';
    return 'failed';
  }

  /** SDP yang dikirim diberi permintaan mutu musik kalau slot musik sedang aktif. */
  function musicSdp(d) {
    negotiatedMusic = musicMode;
    if (!d || !musicMode || !d.sdp) return d;
    try { return { type: d.type, sdp: opusForMusic(d.sdp) }; } catch (_) { return d; }
  }

  /** Tawaran baru dibuat sendiri. Dipakai saat mode musik berubah di tengah panggilan. */
  async function renegotiate() {
    if (!pc || makingOffer) return;
    try {
      makingOffer = true;
      await pc.setLocalDescription();
      session.signal('rtc-desc', { sdp: musicSdp(plainDesc(pc.localDescription)) });
    } catch (e) { oops(e); } finally { makingOffer = false; }
  }

  async function grab(video, ready) {
    // `ready` adalah stream pratinjau yang sudah hidup di halaman. Memakainya ulang bukan
    // sekadar hemat: meminta getUserMedia untuk kedua kalinya membuat browser mematikan
    // pratinjau yang sedang tampil, dan di iOS bisa gagal sama sekali.
    local = ready && ready.getAudioTracks().length ? ready : await getMedia(video);
    if (local === ready) { wantVideo = local.getVideoTracks().length > 0; camFail = null; }
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
        // Permintaan stereo + bitrate tinggi disisipkan ke SDP yang DIKIRIM. Tidak ada API
        // JavaScript untuk ini; baris fmtp Opus memang harus disunting sendiri.
        session.signal('rtc-desc', { sdp: musicSdp(plainDesc(pc.localDescription)) });
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
    clearTimeout(stuckTimer); stuckTimer = null;
    try { for (const t of local?.getTracks() || []) t.stop(); } catch (_) {}
    try { screenTrack?.stop(); } catch (_) {}
    try { pc?.close(); } catch (_) {}
    pc = null; local = null; remote = null; camSender = null; micSender = null;
    negotiatedMusic = false;
    screenTrack = null; screenStream = null; screenSender = null;
    peerScreenId = null; peerStreams.clear();
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
    async call({ video = false, stream = null } = {}) {
      // Dulu di sini ada `if (pc || local) return` yang keluar diam-diam. Sisa panggilan lama
      // yang masih menempel membuat tombol Call mati total tanpa satu pun pesan.
      if (pc && ['connecting', 'live', 'calling'].includes(state)) return;
      if (pc || local) teardown();
      wantVideo = video;
      try {
        await grab(video, stream);
        set(peerReady || pendingDesc ? 'connecting' : 'calling',
            { video: local.getVideoTracks().length > 0 });
        watchStuck();
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
          let cam;
          try {
            cam = await navigator.mediaDevices.getUserMedia({ video: CAM });
          } catch (e) {
            // Dilaporkan, bukan ditelan: tanpa ini tombol kamera terlihat ditekan tapi
            // tidak terjadi apa-apa, dan orangnya tidak tahu harus berbuat apa.
            camFail = camReason(e);
            set(state, { video: false, cam: camFail });
            return false;
          }
          const t = cam.getVideoTracks()[0];
          if (!t) { camFail = 'nocam'; set(state, { video: false, cam: camFail }); return false; }
          camFail = null;
          local.addTrack(t);
          camSender = pc.addTrack(t, local);
          set(state, { video: true, cam: null });
          return true;
        } else if (!on && camSender) {
          const t = camSender.track;
          pc.removeTrack(camSender);
          camSender = null;
          if (t) { t.stop(); try { local.removeTrack(t); } catch (_) {} }
          set(state, { video: false, cam: null });
          return false;
        }
        return !!camSender;
      } catch (e) { oops(e); return !!camSender; }
    },

    get camProblem() { return camFail; },

    get sharing() { return !!screenTrack; },
    get musicMode() { return musicMode; },

    /** Ganti sumber suara (slot A/B) tanpa memutus panggilan. `music` mematikan pemroses
     *  suara bicara dan meminta stereo — dipakai untuk loopback dari DAW. */
    async setAudioSource(deviceId, music = false) {
      musicMode = !!music;
      try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: audioFor(deviceId, music), video: false });
        const t = st.getAudioTracks()[0];
        if (!t) return false;
        t.enabled = !muted;
        if (local) {
          for (const old of local.getAudioTracks()) { local.removeTrack(old); try { old.stop(); } catch (_) {} }
          local.addTrack(t);
        }
        // replaceTrack: isinya ditukar tanpa perundingan ulang, jadi tidak ada jeda bicara.
        if (micSender) await micSender.replaceTrack(t);
        // replaceTrack sengaja TIDAK memicu perundingan ulang — itu gunanya, supaya tidak ada
        // jeda bicara. Tapi permintaan stereo hanya bisa disampaikan lewat SDP baru, jadi
        // kalau mode musiknya berubah, perundingan dipanggil sendiri.
        if (pc && musicMode !== negotiatedMusic) await renegotiate();
        set(state, { audio: deviceId || 'default', music: musicMode });
        return true;
      } catch (e) { oops(e); return false; }
    },
    /** Stream layar kita sendiri, supaya halaman bisa menampilkannya berdampingan
     *  dengan kamera — bukan menggantikannya. */
    get screenStream() { return screenStream; },

    /**
     * Berbagi layar. Track layar ditambahkan SEBAGAI PENGIRIM SENDIRI, berdampingan dengan
     * kamera, supaya wajah tetap terkirim selama DAW dibagikan. Harus dipicu klik: izin
     * berbagi layar hanya boleh diminta oleh tindakan orang.
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
          // operasi dan tidak memberi kita kendali setelan; suara DAW masuk lewat loopback.
          const disp = await navigator.mediaDevices.getDisplayMedia({ video: SCREEN, audio: false });
          const t = disp.getVideoTracks()[0];
          if (!t) return false;
          screenTrack = t;
          // Stream TERPISAH: id-nya yang nanti dipakai sisi lain untuk mengenali layar.
          screenStream = new MediaStream([t]);
          // Browser punya tombol "Stop sharing" sendiri di luar halaman kita.
          t.addEventListener('ended', () => { api.setScreen(false); });
          screenSender = pc.addTrack(t, screenStream);
          try { session.signal('studio-mode', { screen: screenStream.id }); } catch (_) {}
          set(state, { screen: true, screenNote: null });
          return true;
        }

        if (!on && screenTrack) {
          const t = screenTrack;
          screenTrack = null;
          try { if (screenSender) pc.removeTrack(screenSender); } catch (_) {}
          screenSender = null; screenStream = null;
          try { t.stop(); } catch (_) {}
          try { session.signal('studio-mode', { screen: null }); } catch (_) {}
          set(state, { screen: false });
          return false;
        }
        return !!screenTrack;
      } catch (e) {
        // Paling sering: orangnya menekan Cancel di dialog pemilih layar. Itu bukan kesalahan.
        screenTrack = null; screenStream = null; screenSender = null;
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
      if (event === 'studio-mode') {
        // Sisi lain memberi tahu stream mana yang berisi layarnya (atau berhenti berbagi).
        peerScreenId = payload?.screen || null;
        emitRemote();
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
