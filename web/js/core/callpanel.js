// Segmen CORE — panel panggilan video, dipakai halaman admin DAN halaman vokalis.
//
// Satu modul untuk dua halaman, dengan `role` yang menentukan tombolnya:
//   host  (Jeffry)  : pilih vokalis, panggil, berbagi layar
//   guest (vokalis) : satu tombol panggil; saat tersambung hanya tutup, mikrofon, kamera
//
// Berbagi layar sengaja HANYA untuk host. Bukan karena tidak bisa dua arah, tapi karena
// tujuan rapat ini memang Jeffry yang memperlihatkan DAW-nya; tombol yang tidak dipakai
// hanya menambah hal yang bisa salah ditekan di tengah rapat.
//
// Kedua sisi sampai ke ruang yang sama lewat call_room() di database, jadi tidak ada link
// yang perlu dikirim: vokalis menyebut tokennya, admin menyebut vokalisnya.
import { createRoom } from '/js/core/room.js';
import { createVoice } from '/js/core/voice.js';

const I = {
  call: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 10.5 19 7V17l-3.5-3.5"/><rect x="3" y="6" width="12.5" height="12" rx="2.5"/></svg>',
  mic: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v5"/><path d="M15 9V5a3 3 0 0 0-3-3"/><path d="M19 10v2a7 7 0 0 1-11 5.7"/><path d="M5 10v2a7 7 0 0 0 2 4.9"/><path d="M12 19v3"/><path d="M3 3l18 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 11 6-3.5v9L16 13z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5A2.5 2.5 0 0 1 4.5 6H13"/><path d="M16 11l6-3.5v9L16 13"/><path d="M3 3l18 18"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6M12 17v4"/><path d="m12 8-3 3h6l-3-3z" fill="currentColor" stroke="none"/></svg>',
  shareOff: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6M12 17v4"/><path d="M3 3l18 18"/></svg>',
  pip: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4.5" width="19" height="15" rx="2.5"/><rect x="12" y="11" width="8" height="6.5" rx="1.5" fill="currentColor" stroke="none"/></svg>',
  end: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// Pesan kamera dibuat berisi LANGKAH, bukan sekadar "gagal". Yang paling sering terjadi
// adalah izinnya pernah ditolak, dan browser tidak akan bertanya lagi — jadi orangnya harus
// diberi tahu di mana mengubahnya, kalau tidak dia akan menekan tombol kamera berulang-ulang.
const CAM_MSG = {
  blocked: navigator.userAgent.includes('iPhone') || navigator.userAgent.includes('iPad')
    ? 'Camera is blocked. Tap the “aA” icon in Safari’s address bar → Website Settings → Camera → Allow, then press the camera button again. If it is not there, open Settings → Safari → Camera.'
    : 'Camera is blocked. Tap the padlock in the address bar → Permissions → allow Camera, then press the camera button again.',
  nocam: 'No camera found on this device. The call still works with sound.',
  busy: 'Another app is using the camera. Close it, then press the camera button again.',
  failed: 'The camera could not start. The call still works with sound.',
};

const TEXT = {
  idle: 'Not in a call', asking: 'Asking for your microphone and camera…',
  calling: 'Ringing…', ringing: 'Incoming call', connecting: 'Connecting…',
  live: 'In a call', failed: 'Could not connect',
};

export function createCallPanel({ mount, role, token = '', vocalists = null, onError }) {
  const isHost = role === 'host';
  let room = null;
  let voice = null;
  let joinedCode = null;
  let camOn = true;         // kamera menyala begitu panggilan dimulai, sesuai permintaan
  let shareOn = false;
  let state = 'idle';
  let camProblem = null;
  let lastError = null;
  let stuckNote = false;
  let peerCam = null;      // stream kamera lawan bicara
  let peerScreen = null;   // stream layar lawan bicara (null kalau tidak berbagi)
  let preview = null;      // kamera + mikrofon kita, hidup SEBELUM panggilan dimulai
  // Slot A dan B: masing-masing satu perangkat masukan. Hanya SATU yang hidup pada satu waktu.
  const slots = { A: { dev: '', music: false }, B: { dev: '', music: true } };
  let activeSlot = 'A';

  mount.innerHTML = `
    <div class="cl-wrap">
      ${isHost ? `
      <div class="cl-pick">
        <label for="clVoc">Call</label>
        <select id="clVoc" style="width:auto"></select>
        <span class="cl-state" data-state></span>
      </div>` : `
      <div class="cl-pick"><span class="cl-state" data-state></span></div>`}

      <div class="cl-stage" data-stage>
        <video class="cl-main" data-main autoplay playsinline></video>
        <!-- Hanya admin: wajah vokalis BESAR di sebelah kanan layar yang dibagikan. -->
        <video class="cl-side" data-side autoplay playsinline hidden></video>
        <div class="cl-ph" data-ph><p data-ph-t></p><p class="note" data-ph-s></p></div>
        <span class="cl-badge" data-badge hidden>Preview</span>
        <!-- Urutan DOM = urutan di layar. Wajah lawan bicara di KIRI, wajah sendiri di kanan,
             sesuai permintaan: "di thumbnail bawah ada Facecam dia, di sebelah kirinya Facecamku". -->
        <div class="cl-thumbs" data-thumbs>
          <video class="cl-thumb" data-peerthumb autoplay playsinline hidden></video>
          <video class="cl-thumb" data-selfthumb autoplay playsinline muted hidden></video>
        </div>
      </div>

      ${isHost ? `
      <!-- Slot A/B: dua sumber suara yang disiapkan di depan, lalu DIPINDAH, bukan dicampur.
           Pencampuran dikerjakan Jeffry di Studio One (mic dinamis masuk ke track, keluar lewat
           loopback), jadi aplikasi ini tidak perlu punya pencampur sendiri. -->
      <div class="cl-ab" data-ab>
        <div class="cl-abrow">
          <button class="cl-abtab on" data-abtab="A">A</button>
          <select data-abdev="A"></select>
          <label class="cl-abmus"><input type="checkbox" data-abmusic="A"> music</label>
        </div>
        <div class="cl-abrow">
          <button class="cl-abtab" data-abtab="B">B</button>
          <select data-abdev="B"></select>
          <label class="cl-abmus"><input type="checkbox" data-abmusic="B" checked> music</label>
        </div>
        <p class="note" data-abnote></p>
      </div>` : ''}

      <p class="cl-err" data-err hidden></p>
      <p class="cl-camwarn" data-camwarn hidden></p>

      <div class="cl-bar">
        <button class="cl-go" data-go></button>
        <span class="grow"></span>
        <button class="st-btn" data-mic hidden aria-label="Mute microphone"></button>
        <button class="st-btn" data-cam hidden aria-label="Turn camera off"></button>
        ${isHost ? '<button class="st-btn" data-share hidden aria-label="Share screen"></button>' : ''}
        ${isHost ? '<button class="st-btn" data-pip hidden aria-label="Picture in picture"></button>' : ''}
        <button class="st-btn st-end" data-end hidden aria-label="Hang up"></button>
      </div>
      ${isHost ? '<p class="note" data-hint></p>' : ''}
    </div>`;

  const q = (sel) => mount.querySelector(sel);
  const inCall = () => ['asking', 'calling', 'ringing', 'connecting', 'live'].includes(state);

  function paint() {
    q('[data-state]').textContent = TEXT[state] || state;

    // Saat tersambung, videonya memenuhi layar dan tombolnya melayang di atasnya —
    // seperti FaceTime. Di luar panggilan panel kembali menjadi kotak biasa di halaman.
    const full = state === 'live';
    q('.cl-wrap').classList.toggle('live', full);
    document.body.classList.toggle('cl-live', full);

    const err = q('[data-err]');
    err.hidden = !lastError;
    if (lastError) err.textContent = lastError;

    const warn = q('[data-camwarn]');
    warn.hidden = !camProblem;
    if (!warn.hidden) warn.textContent = CAM_MSG[camProblem] || CAM_MSG.failed;

    const go = q('[data-go]');
    if (state === 'ringing') { go.innerHTML = I.call + '<span>Answer</span>'; go.className = 'cl-go ring'; go.hidden = false; }
    else if (!inCall()) { go.innerHTML = I.call + '<span>Call</span>'; go.className = 'cl-go'; go.hidden = false; }
    else { go.hidden = true; }

    for (const [sel, show] of [['[data-mic]', inCall()], ['[data-cam]', inCall()], ['[data-end]', inCall()]]) {
      const el = q(sel); if (el) el.hidden = !show;
    }
    const sh = q('[data-share]');
    if (sh) sh.hidden = !inCall();
    const pip = q('[data-pip]');
    if (pip) { pip.hidden = state !== 'live' || !document.pictureInPictureEnabled; pip.innerHTML = I.pip; }

    q('[data-mic]').innerHTML = voice?.muted ? I.micOff : I.mic;
    q('[data-mic]').classList.toggle('off', !!voice?.muted);
    q('[data-cam]').innerHTML = camOn ? I.cam : I.camOff;
    q('[data-cam]').classList.toggle('off', !camOn);
    if (sh) { sh.innerHTML = shareOn ? I.shareOff : I.share; sh.classList.toggle('on', shareOn); }
    q('[data-end]').innerHTML = I.end;

    const live = state === 'live';
    // Kalau pratinjau sudah tampil, tulisan di tengah hanya mengganggu.
    q('[data-ph]').hidden = live || !!(preview && preview.getVideoTracks().length && !inCall());
    if (!live) {
      q('[data-ph-t]').textContent =
        state === 'ringing' ? 'Someone is calling' :
        state === 'calling' ? 'Ringing the other side…' :
        state === 'asking' ? 'Allow the microphone and camera' :
        state === 'connecting' ? 'Connecting…' :
        state === 'failed' ? 'Could not connect' : 'Not in a call';
      q('[data-ph-s]').textContent =
        state === 'failed' ? (stuckNote
          ? 'The other side never answered. If you are testing both ends on one phone, it cannot work: a background Safari tab is frozen by iOS and cannot answer. Use two devices.'
          : 'Check the connection and try again.')
        : state === 'connecting' || state === 'asking' || state === 'calling' ? ''
        : isHost ? 'Pick a vocalist, then press Call.' : 'Press Call to reach the studio.';
    }
    layout();
    const badge = q('[data-badge]');
    if (badge) badge.hidden = !(state !== 'live' && preview && preview.getVideoTracks().length);
  }

  const put = (sel, stream) => {
    const el = q(sel);
    if (!el) return;
    if (el.srcObject !== (stream || null)) el.srcObject = stream || null;
    el.hidden = !stream;
  };

  /** Siapa tampil di mana. Dua peran, dua susunan yang memang berbeda:
   *
   *  ADMIN  — yang ingin dilihat Jeffry adalah WAJAH vokalis, besar. Saat dia membagikan DAW,
   *           layarnya mengambil alih bagian utama dan wajah vokalis pindah ke kanan, tetap
   *           besar, bukan mengecil jadi thumbnail.
   *  VOKALIS— yang penting baginya adalah LAYAR DAW, jadi itu yang memenuhi bagian utama.
   *           Dua wajah turun ke bawah: wajah Jeffry di kiri, wajahnya sendiri di kanan.
   */
  function layout() {
    const live = state === 'live';
    const mine = voice?.localStream || null;        // kamera + mikrofon kita
    const myScreen = voice?.screenStream || null;

    if (!live) {
      // Sebelum tersambung, yang ditampilkan BESAR adalah kamera kita sendiri — gunanya
      // memang untuk memastikan kameranya jalan sebelum menelepon.
      const own = (inCall() ? mine : preview) || null;
      const ownCam = own && own.getVideoTracks().length ? own : null;
      put('[data-main]', ownCam);
      put('[data-side]', null);
      put('[data-peerthumb]', null);
      put('[data-selfthumb]', null);
      q('[data-main]').classList.toggle('mirror', !!ownCam);
      q('[data-stage]').classList.remove('with-side', 'two-thumbs');
      return;
    }
    q('[data-main]').classList.remove('mirror');

    if (isHost) {
      const sharing = !!myScreen;
      put('[data-main]', sharing ? myScreen : peerCam);
      put('[data-side]', sharing ? peerCam : null);
      put('[data-peerthumb]', null);
      put('[data-selfthumb]', camOn ? mine : null);
      q('[data-stage]').classList.toggle('with-side', sharing && !!peerCam);
      q('[data-stage]').classList.remove('two-thumbs');
    } else {
      const theirScreen = peerScreen;
      put('[data-main]', theirScreen || peerCam);
      put('[data-side]', null);
      // Wajah Jeffry turun jadi thumbnail HANYA kalau layarnya sedang mengambil bagian utama.
      put('[data-peerthumb]', theirScreen ? peerCam : null);
      put('[data-selfthumb]', camOn ? mine : null);
      q('[data-stage]').classList.remove('with-side');
      q('[data-stage]').classList.toggle('two-thumbs', !!(theirScreen && peerCam));
    }
  }

  /** Daftar perangkat masukan baru punya NAMA setelah izin mikrofon diberikan — sebelum itu
   *  browser sengaja menyembunyikannya. Jadi daftar ini diisi ulang setelah pratinjau hidup. */
  async function fillDevices() {
    if (!isHost || !navigator.mediaDevices?.enumerateDevices) return;
    let list = [];
    try { list = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); }
    catch (_) { return; }
    for (const k of ['A', 'B']) {
      const sel = q(`[data-abdev="${k}"]`);
      if (!sel) continue;
      const keep = slots[k].dev || sel.value;
      sel.innerHTML = '<option value="">Default input</option>' + list.map((d, i) =>
        `<option value="${d.deviceId}">${(d.label || 'Input ' + (i + 1)).replace(/[<>]/g, '')}</option>`).join('');
      if (keep && [...sel.options].some((o) => o.value === keep)) sel.value = keep;
      slots[k].dev = sel.value;
    }
    paintAb();
  }

  function paintAb() {
    if (!isHost) return;
    for (const k of ['A', 'B']) {
      q(`[data-abtab="${k}"]`)?.classList.toggle('on', activeSlot === k);
      const cb = q(`[data-abmusic="${k}"]`);
      if (cb) cb.checked = slots[k].music;
    }
    const n = q('[data-abnote]');
    if (n) n.textContent = slots[activeSlot].music
      ? 'Slot ' + activeSlot + ' is in music mode: echo cancellation, noise suppression and auto-gain are off, and the call asks for stereo. Headphones required.'
      : 'Slot ' + activeSlot + ' is in voice mode: echo cancellation on. Good for talking, wrong for music.';
  }

  /** Kamera dinyalakan begitu halaman Call dibuka, bukan menunggu tombol Call ditekan —
   *  supaya bisa dicek dulu apakah kameranya memang jalan. Stream ini nanti DIPAKAI ULANG
   *  oleh panggilan; meminta izin dua kali membuat browser mematikan pratinjau yang sedang
   *  tampil, dan di iOS bisa gagal sama sekali. */
  async function startPreview() {
    if (preview || inCall()) return;
    try {
      preview = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'user' } },
      });
      camProblem = null;
    } catch (e) {
      // Tanpa kamera pun halaman tetap berguna: panggilan masih bisa dimulai dengan suara.
      const n = e?.name || '';
      camProblem = n === 'NotAllowedError' ? 'blocked'
        : n === 'NotFoundError' ? 'nocam'
        : n === 'NotReadableError' ? 'busy' : 'failed';
      try {
        preview = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      } catch (_) { preview = null; }
    }
    paint();
    fillDevices();
  }

  function stopPreview() {
    // Hanya dihentikan kalau BUKAN stream yang sedang dipakai panggilan.
    if (preview && preview !== voice?.localStream) {
      try { for (const t of preview.getTracks()) t.stop(); } catch (_) {}
    }
    preview = null;
  }

  /** Masuk ke ruang vokalis ini. Dipanggil saat panel dibuka, jauh SEBELUM tombol Call
   *  ditekan — kalau tidak, panggilan masuk tidak akan pernah terdengar. */
  async function enter(code) {
    if (joinedCode === code) return;
    leave();
    joinedCode = code;

    room = createRoom({
      code,
      role,
      onSignal: (ev, p) => voice?.handle(ev, p),
      onError: (e) => onError?.(e),
    });
    await room.join();

    voice = createVoice({
      session: room,
      role,
      onState: (s, inf) => {
        state = s;
        if (typeof inf?.screen === 'boolean') shareOn = inf.screen;
        if (s === 'live' || s === 'connecting') camOn = !!inf?.video;
        if (inf && 'cam' in inf) {
          // Jangan hapus temuan pratinjau hanya karena panggilan memakai ulang stream yang
          // sama: kalau memang tidak ada track video, masalahnya masih ada.
          const gotVideo = voice?.localStream?.getVideoTracks?.().length > 0;
          camProblem = inf.cam || (gotVideo ? null : camProblem);
        }
        if (s === 'live' && isHost && (slots[activeSlot].dev || slots[activeSlot].music)) {
          // Sumber yang dipilih dipasang setelah tersambung, bukan sebelum: sebelum ada
          // sambungan tidak ada pengirim yang bisa ditukar isinya.
          voice.setAudioSource(slots[activeSlot].dev, slots[activeSlot].music);
        }
        if (s === 'idle' || s === 'failed') { preview = null; startPreview(); }
        if (s === 'failed') stuckNote = inf?.note === 'stuck';
        if (s !== 'failed' && s !== 'idle') stuckNote = false;
        paint();
      },
      onRemote: (cam, screen) => { peerCam = cam || null; peerScreen = screen || null; paint(); },
      onError: (e) => onError?.(e),
    });
    paint();
  }

  function leave() {
    try { voice?.hangUp(); } catch (_) {}
    try { voice?.stop(); } catch (_) {}
    try { room?.leave(); } catch (_) {}
    voice = null; room = null; joinedCode = null; state = 'idle'; shareOn = false;
  }

  /** Pastikan kita sudah di dalam ruang. Dipanggil saat memilih vokalis DAN saat Call ditekan,
   *  supaya satu kegagalan membuka ruang tidak membuat tombol Call diam selamanya. */
  async function ensureRoom() {
    if (room) return true;
    try {
      const id = isHost ? (q('#clVoc')?.value || '') : '';
      if (isHost && !id) { lastError = 'Choose a vocalist first.'; paint(); return false; }
      const r = await roomFor(id || null);
      await enter(r.code);
      lastError = null;
      if (isHost) q('[data-hint]').textContent =
        `Room open for ${r.vocalist}. They see a Call button on their own page.`;
      paint();
      return true;
    } catch (e) {
      lastError = 'Could not open the room: ' + (e?.message || e) + ' — press Call to try again.';
      paint();
      onError?.(e);
      return false;
    }
  }

  async function roomFor(vocalistId) {
    const { sb } = await import('/js/core/supabase.js');
    const { data, error } = await sb.rpc('call_room', { p_token: token, p_vocalist: vocalistId || null });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    if (!r?.code) throw new Error('no room');
    return r;
  }

  // ------------------------------------------------------------------ tombol

  mount.addEventListener('click', async (e) => {
    try {
      if (e.target.closest('[data-go]')) {
        if (state === 'ringing') { await voice.answer({ video: true, stream: preview }); return; }
        // Dulu di sini ada `if (!room) return` tanpa kabar apa pun: kalau ruangnya gagal
        // dibuka, tombol Call jadi mati total tanpa satu pun pesan. Sekarang dicoba lagi.
        if (!room && !(await ensureRoom())) return;
        lastError = null;
        camOn = true;
        // Pratinjau yang sudah hidup dipakai langsung: tidak ada permintaan izin kedua.
        await voice.call({ video: true, stream: preview });
        return;
      }
      if (e.target.closest('[data-mic]')) { voice?.setMuted(!voice.muted); paint(); return; }
      if (e.target.closest('[data-cam]')) {
        // Nilai baliknya yang dipercaya, bukan niat kita: kalau izinnya ditolak, setCamera
        // mengembalikan false dan tombolnya tidak boleh terlihat menyala.
        const want = !camOn;
        const got = await voice?.setCamera(want);
        camOn = !!got;
        if (got) camProblem = null;
        paint();
        return;
      }
      if (e.target.closest('[data-share]')) { shareOn = await voice.setScreen(!shareOn); paint(); return; }
      // Tombol PIP hanya ada di sisi admin: Jeffry yang berpindah ke DAW sambil tetap ingin
      // melihat wajah vokalis. Vokalis sengaja tetap tiga tombol saja, sesuai permintaannya.
      const tab = e.target.closest('[data-abtab]');
      if (tab) {
        activeSlot = tab.dataset.abtab;
        paintAb();
        // Kalau sedang bicara, sumbernya ditukar saat itu juga tanpa memutus panggilan.
        if (voice && inCall()) await voice.setAudioSource(slots[activeSlot].dev, slots[activeSlot].music);
        return;
      }
      if (e.target.closest('[data-pip]')) { await enterPip(); return; }
      if (e.target.closest('[data-end]')) { voice?.hangUp(); shareOn = false; paint(); return; }
    } catch (err) { onError?.(err); }
  });

  if (isHost) {
    mount.addEventListener('change', async (e) => {
      const dev = e.target.closest('[data-abdev]');
      if (dev) {
        slots[dev.dataset.abdev].dev = dev.value;
        if (dev.dataset.abdev === activeSlot && voice && inCall())
          await voice.setAudioSource(slots[activeSlot].dev, slots[activeSlot].music);
        return;
      }
      const mus = e.target.closest('[data-abmusic]');
      if (mus) {
        slots[mus.dataset.abmusic].music = mus.checked;
        paintAb();
        if (mus.dataset.abmusic === activeSlot && voice && inCall())
          await voice.setAudioSource(slots[activeSlot].dev, slots[activeSlot].music);
      }
    });

    q('#clVoc').addEventListener('change', async () => {
      leave();                 // ganti vokalis = ganti ruang
      lastError = null;
      paint();
      if (q('#clVoc').value) await ensureRoom();
    });
  }

  /** Picture-in-picture, supaya wajah mereka tetap terlihat saat Jeffry pindah ke DAW.
   *  Browser umumnya hanya mengizinkan ini dari tindakan orang, jadi ada tombolnya; percobaan
   *  otomatis saat pindah jendela tetap dilakukan, dan kalau ditolak ya diam saja. */
  async function enterPip() {
    const v = q('[data-main]');
    if (!v?.srcObject || !document.pictureInPictureEnabled) return false;
    try {
      if (document.pictureInPictureElement) { await document.exitPictureInPicture(); return false; }
      await v.requestPictureInPicture();
      return true;
    } catch (_) { return false; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'live' && !document.pictureInPictureElement) enterPip();
  });

  window.addEventListener('pagehide', leave);

  return {
    /** Panel ditampilkan. Vokalis langsung masuk ruangnya; admin menunggu pilihan. */
    async show() {
      startPreview();
      if (isHost) {
        const list = vocalists?.() || [];
        const sel = q('#clVoc');
        const keep = sel.value;
        sel.innerHTML = '<option value="">Choose a vocalist…</option>'
          + list.map((v) => `<option value="${v.id}">${v.display_name}</option>`).join('');
        if (keep) sel.value = keep;
      } else if (!room) {
        await ensureRoom();
      }
      paint();
      startPreview();        // sengaja tidak di-await: panel tampil dulu, kamera menyusul
    },
    /** Panel disembunyikan. Panggilan yang sedang hidup TIDAK diputus hanya karena
     *  pindah tab — itu akan mengagetkan di tengah rapat. */
    hide() { if (!inCall()) stopPreview(); paint(); },
    get busy() { return inCall(); },
    stop: leave,
  };
}
