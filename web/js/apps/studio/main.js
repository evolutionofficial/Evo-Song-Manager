// FC Private Studio — ruang rapat satu lawan satu untuk membahas editing di DAW.
//
// Tahap 1–3 dari docs/FC_PRIVATE_STUDIO_DESIGN.md: ruang + undangan, panggilan suara dan
// kamera, dan berbagi layar. Slot audio A/B (tahap 4) BELUM ada di sini.
//
// Tidak ada tabel database baru. Kode ruangnya dibuat halaman admin lewat listen_open() yang
// sudah ada, karena /turn memverifikasi kode ruang terhadap database sebelum memberi kredensial
// relay — ruang yang hanya ada di browser tidak akan dapat relay, dan panggilannya akan gagal
// di data seluler. Jadi ruang Listen Together dipakai ulang sebagai ruang rapat.
//
// Akibat yang perlu diketahui: selama ruang ini terbuka, halaman vokalis juga menampilkan
// undangan "Listen together", karena keduanya memakai tabel yang sama dan belum ada penanda
// jenis ruang. Memisahkannya butuh satu kolom baru di listen_rooms.
import { createRoom } from '/js/core/room.js';
import { createVoice } from '/js/core/voice.js';

const $ = (id) => document.getElementById(id);

const I = {
  mic: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/></svg>',
  micOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v5"/><path d="M15 9V5a3 3 0 0 0-3-3"/><path d="M19 10v2a7 7 0 0 1-11 5.7"/><path d="M5 10v2a7 7 0 0 0 2 4.9"/><path d="M12 19v3"/><path d="M3 3l18 18"/></svg>',
  cam: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2.5"/><path d="m16 11 6-3.5v9L16 13z"/></svg>',
  camOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.5A2.5 2.5 0 0 1 4.5 6H13"/><path d="M16 11l6-3.5v9L16 13"/><rect x="2" y="6" width="14" height="12" rx="2.5" opacity=".35"/><path d="M3 3l18 18"/></svg>',
  share: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6"/><path d="M12 17v4"/><path d="m12 8-3 3h6l-3-3z" fill="currentColor" stroke="none"/></svg>',
  shareOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M9 21h6"/><path d="M12 17v4"/><path d="M3 3l18 18"/></svg>',
  end: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

// Kode ruang dari alamat: /studio/lr_xxxx. Peran dari parameter ?r=host, yang hanya dipasang
// halaman admin. Peran cuma menentukan siapa yang "tidak sopan" dalam perundingan WebRTC,
// jadi tamu yang memalsukannya hanya merusak panggilannya sendiri.
const parts = location.pathname.split('/').filter(Boolean);
const code = parts[1] || new URLSearchParams(location.search).get('code') || '';
const isHost = new URLSearchParams(location.search).get('r') === 'host';

let room = null;
let voice = null;
let camOn = false;
let shareOn = false;

const say = (s) => { $('state').textContent = s; };

function paint() {
  $('micBtn').innerHTML = voice?.muted ? I.micOff : I.mic;
  $('micBtn').classList.toggle('off', !!voice?.muted);
  $('camBtn').innerHTML = camOn ? I.cam : I.camOff;
  $('camBtn').classList.toggle('on', camOn);
  $('shareBtn').innerHTML = shareOn ? I.shareOff : I.share;
  $('shareBtn').classList.toggle('on', shareOn);
  $('endBtn').innerHTML = I.end;
  // Pratinjau diri hanya berguna kalau ada yang dikirim.
  const self = camOn || shareOn;
  $('local').hidden = !self;
  if (self && voice?.localStream) $('local').srcObject = voice.localStream;
}

function showStage(on, title, sub) {
  $('remote').hidden = !on;
  $('placeholder').hidden = on;
  if (!on) { $('phTitle').textContent = title || ''; $('phSub').textContent = sub || ''; }
}

const STATE_TEXT = {
  idle: 'Not connected', calling: 'Waiting for the other side…', ringing: 'Incoming…',
  connecting: 'Connecting…', live: 'Connected', failed: 'Connection failed',
};

async function start() {
  if (!/^lr_[0-9a-f]{32}$/.test(code)) {
    $('gateTitle').textContent = 'This link is not valid';
    $('gateSub').textContent = 'Ask for a fresh invite link.';
    $('joinBtn').hidden = true;
    return;
  }

  $('gateSub').textContent = isHost
    ? 'You are the host. Share the invite link below, then join.'
    : 'You have been invited to a studio session.';

  if (isHost) {
    $('invite').hidden = false;
    $('inviteUrl').value = `${location.origin}/studio/${code}`;
    $('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText($('inviteUrl').value);
        $('copyBtn').textContent = 'Copied';
        setTimeout(() => { $('copyBtn').textContent = 'Copy'; }, 1500);
      } catch (_) {
        $('inviteUrl').select();   // salin otomatis ditolak → biarkan disalin tangan
      }
    });
  }

  room = createRoom({
    code,
    role: isHost ? 'host' : 'guest',
    onPeers: (list) => {
      const other = list.filter((p) => p.id !== room.me).length;
      if (!voice || voice.state === 'idle') {
        showStage(false, other ? 'The other side is here' : 'Waiting for the other side…',
          other ? 'Press Join to connect.' : 'Nothing happens until both sides join.');
      }
    },
    onSignal: (ev, payload) => voice?.handle(ev, payload),
    onError: (e) => say('Channel problem: ' + (e?.message || e)),
  });

  try {
    await room.join({ role: isHost ? 'host' : 'guest' });
  } catch (e) {
    $('gateTitle').textContent = 'Could not open the room';
    $('gateSub').textContent = e?.message || String(e);
    $('joinBtn').hidden = true;
    return;
  }

  voice = createVoice({
    session: room,                       // room.js memenuhi persis apa yang voice.js butuh
    role: isHost ? 'host' : 'guest',
    onState: (s, inf) => {
      say(STATE_TEXT[s] || s);
      shareOn = !!inf?.screen;
      if (s === 'live') showStage(true);
      if (s === 'idle') showStage(false, 'Call ended', '');
      if (s === 'failed') {
        showStage(false, 'Connection failed',
          inf?.relay === false ? 'No relay server, so strict mobile networks will not connect.' : '');
      }
      if (inf?.screenNote === 'unsupported') say('This browser cannot share a screen');
      paint();
    },
    // Halaman ini hanya punya SATU bingkai video, jadi layar diutamakan saat dibagikan —
    // itu yang sedang dibahas. Halaman Call punya tata letak dua gambar; halaman ini tidak.
    onRemote: (cam, screen) => { $('remote').srcObject = screen || cam || null; },
    onError: (e) => say('Problem: ' + (e?.message || e)),
  });

  showStage(false, 'Waiting for the other side…', 'Nothing happens until both sides join.');
  paint();
}

$('joinBtn').addEventListener('click', async () => {
  $('joinBtn').disabled = true;
  $('gate').hidden = true;
  $('bar').hidden = false;
  await voice.call({ video: false });
  paint();
});

$('micBtn').addEventListener('click', () => { voice.setMuted(!voice.muted); paint(); });

$('camBtn').addEventListener('click', async () => {
  camOn = !camOn;
  await voice.setCamera(camOn);
  paint();
});

$('shareBtn').addEventListener('click', async () => {
  // Berbagi layar mengganti track kamera, jadi tombol kamera ikut menyesuaikan tampilannya.
  const now = await voice.setScreen(!shareOn);
  shareOn = now;
  paint();
});

$('endBtn').addEventListener('click', () => {
  voice.hangUp();
  room.leave();
  $('bar').hidden = true;
  showStage(false, 'You left the room', 'Close this tab, or reload to join again.');
});

// Keluar rapi kalau tab ditutup: tanpa ini sisi lain menunggu sambungan yang sudah mati.
window.addEventListener('pagehide', () => { try { voice?.hangUp(); room?.leave(); } catch (_) {} });

start();
