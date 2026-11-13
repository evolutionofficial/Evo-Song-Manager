// Segmen CORE — ruang sinyal untuk FC Private Studio.
//
// Ini sengaja TIPIS. Listen Together punya createSession() yang jauh lebih besar karena harus
// menyelaraskan jam dan posisi lagu antara dua browser. Rapat di studio tidak butuh itu sama
// sekali: tidak ada lagu yang diputar serempak, yang dikirim hanya kamera, layar, dan suara.
// Memakai createSession() di sini berarti menyalakan pengukur jam yang terus berdenyut tanpa
// ada yang memakai hasilnya.
//
// Yang dibutuhkan voice.js dari sebuah "sesi" ternyata hanya DUA hal: `code` dan `signal()`.
// Jadi modul ini memenuhi persis itu, dan voice.js dipakai ulang tanpa diubah satu baris pun.

const rid = () => Math.random().toString(36).slice(2, 10);

// Jenis pesan yang boleh lewat. Daftarnya tertutup supaya tidak ada pesan tak terduga yang
// ikut terkirim ke dalam ruang — alasan yang sama seperti di Listen Together.
const SIGNALS = ['rtc-desc', 'rtc-ice', 'rtc-call', 'rtc-ready', 'rtc-bye', 'studio-mode'];

// Dipisah supaya bagian ini bisa diuji di node tanpa jaringan.
let channelFactory = null;
export function setChannelFactory(fn) { channelFactory = fn; }

async function sbChannel(code, me) {
  if (channelFactory) return channelFactory(code, me);
  const { sb } = await import('/js/core/supabase.js');
  // Awalan 'studio:' BUKAN 'listen:'. Kode ruangnya memang dari listen_open, tapi kalau kedua
  // fitur memakai nama saluran yang sama, sesi menyimak dan sesi rapat bisa saling mendengar
  // pesan satu sama lain.
  return sb.channel('studio:' + code, {
    config: { broadcast: { self: false }, presence: { key: me } },
  });
}

/**
 * @param code     kode ruang (lr_… dari listen_open)
 * @param role     'host' | 'guest'
 * @param onPeers  (daftar presence) => void
 * @param onSignal (event, payload) => void — pesan WebRTC dari sisi lain
 * @param onError  (Error) => void
 */
export function createRoom({ code, role, onPeers, onSignal, onError }) {
  if (!code) throw new Error('code wajib');
  const me = rid();
  let ch = null;
  let closed = false;

  return {
    get code() { return code; },
    get role() { return role; },
    get me() { return me; },

    async join(meta = {}) {
      ch = await sbChannel(code, me);

      // Semua pendengar dipasang SEBELUM subscribe. Menambahkannya sesudah itu tidak dijamin
      // terpasang, dan gejalanya pesan pertama hilang tanpa jejak — mahal sekali dicari.
      ch.on('presence', { event: 'sync' }, () => {
        try { onPeers?.(Object.values(ch.presenceState()).flat()); } catch (e) { onError?.(e); }
      });
      if (onSignal) {
        for (const ev of SIGNALS) {
          ch.on('broadcast', { event: ev }, ({ payload }) => {
            if (closed) return;
            try { onSignal(ev, payload); } catch (e) { onError?.(e); }
          });
        }
      }

      await new Promise((resolve, reject) => {
        let settled = false;
        const done = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
        ch.subscribe((status, err) => {
          if (status === 'SUBSCRIBED') {
            ch.track({ id: me, role, ...meta }).then(() => done(resolve), (e) => done(reject, e));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            done(reject, err || new Error('tidak bisa masuk ruang: ' + status));
          }
        });
      });
      return me;
    },

    signal(event, payload) {
      if (!ch || closed) return;
      if (!SIGNALS.includes(event)) throw new Error('pesan tidak dikenal: ' + event);
      try { ch.send({ type: 'broadcast', event, payload: { ...payload, from: me } }); }
      catch (e) { onError?.(e); }
    },

    leave() {
      closed = true;
      if (!ch) return;
      try { ch.unsubscribe(); } catch (_) {}
      ch = null;
    },
  };
}
