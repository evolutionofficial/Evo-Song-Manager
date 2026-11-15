// Segmen CORE — kotak kecil "Call alerts" di bawah tombol Call: menyalakan atau mematikan
// notifikasi panggilan di perangkat ini. Dimuat terpisah oleh callpanel.js (dynamic import),
// jadi kalau modul ini bermasalah, panggilannya sendiri tetap jalan.
import * as push from '/js/core/push.js';

const HELP = {
  host: 'Get a notification on this device when a vocalist calls you, even when this tab is closed.',
  guest: 'Get a notification on this device when the studio calls you, even when this page is closed.',
};

const IOS_STEPS = 'iPhone: tap the Share button, choose “Add to Home Screen”, then open the app from your Home Screen and turn on call alerts here. Apple only allows alerts for apps added to the Home Screen.';

export function mountAlerts({ el, role, token = '', onError }) {
  let cur = 'off';

  function paint(s, busy = false, note = '') {
    cur = s;
    const btn = (action, label) => `<button type="button" class="btn" data-al="${action}"${busy ? ' disabled' : ''}>${label}</button>`;
    const body =
      s === 'unsupported' ? '<span>This browser cannot receive call alerts.</span>' :
      s === 'install' ? `<span>${IOS_STEPS}</span>` :
      s === 'denied' ? '<span>Call alerts are blocked for this site. Allow notifications in your browser settings, then reload this page.</span>' :
      s === 'on' ? `<span>Call alerts are <b>on</b> for this device.</span>${btn('off', 'Turn off')}` :
      `<span>${HELP[role] || HELP.guest}</span>${btn('on', busy ? 'Turning on…' : 'Turn on call alerts')}`;
    el.innerHTML = `${body}${note ? `<span class="cl-alnote">${note}</span>` : ''}`;
  }

  async function refresh() {
    const s = await push.status();
    paint(s);
    if (s === 'on') push.resync({ token });
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-al]');
    if (!b) return;
    const turnOn = b.dataset.al === 'on';
    try {
      paint(cur, true);
      // enable() meminta izin sebagai langkah pertamanya, tanpa await di depannya: izin notifikasi
      // hanya boleh diminta langsung dari klik, dan await lain di depannya bisa membatalkannya.
      paint(turnOn ? await push.enable({ token }) : await push.disable({ token }));
    } catch (err) {
      onError?.(err);
      paint(await push.status(), false, turnOn ? 'Could not turn on call alerts. Please try again.' : 'Could not turn off call alerts.');
    }
  });

  return { refresh };
}
