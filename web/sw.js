// SERVICE WORKER — hanya untuk notifikasi panggilan meeting. Tidak menyimpan cache dan tidak
// mencegat permintaan apa pun, jadi tidak bisa membuat halaman tampil usang.
//
// Alurnya: Edge Function `ring` mengirim push → 'push' di sini menampilkan notifikasi →
// orang mengetuknya → 'notificationclick' membuka (atau memunculkan) halaman di tab Meeting.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) { /* isi bukan JSON: pakai teks bawaan */ }
  const title = d.title || 'Incoming call';
  const url = typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/';

  event.waitUntil((async () => {
    // Push WAJIB menampilkan notifikasi (aturan peramban, terutama Safari/iPhone), jadi ini
    // dijalankan lebih dulu dan tidak bergantung pada halaman yang sedang terbuka atau tidak.
    await self.registration.showNotification(title, {
      body: d.body || 'Tap to open the meeting and answer.',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: d.tag || 'evo-call',
      renotify: true,
      requireInteraction: true,
      vibrate: [300, 150, 300, 150, 300],
      data: { url, ts: d.ts || Date.now() },
    });
    // Halaman yang sedang terbuka diberi tahu supaya langsung pindah ke tab Meeting.
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of open) c.postMessage({ type: 'incoming-call', url });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const target = new URL(url, self.location.origin);
    const open = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Aplikasi yang sama sudah terbuka (mis. vokalis di /v/<kode>, admin di /admin)? Pakai itu.
    for (const c of open) {
      const u = new URL(c.url);
      if (u.origin === target.origin && u.pathname === target.pathname) {
        await c.focus();
        c.postMessage({ type: 'open-call', url });
        return;
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
