// MANIFEST PWA PER TAUTAN — /app-manifest?for=/v/<kodeVokalis>  (juga /fc/<kode>)
//
// Manifest bersama (/manifest.webmanifest) memakai start_url "/", jadi vokalis yang memasang
// halamannya sebagai aplikasi (Android "Install app", iPhone "Add to Home Screen") malah membuka
// halaman utama/admin, bukan halamannya sendiri. Halaman vokalis dan operator FC memakai manifest
// ini: start_url dan scope = tautan orang itu sendiri, dan id-nya berbeda per tautan, sehingga
// aplikasi vokalis tidak tertukar dengan aplikasi admin yang terpasang di perangkat yang sama.
const PATH_RE = /^\/(v|fc)\/[A-Za-z0-9_-]{1,200}$/;

export function onRequest({ request }) {
  const want = new URL(request.url).searchParams.get('for') || '';
  const path = PATH_RE.test(want) ? want : '/';
  const fc = path.startsWith('/fc/');
  const body = {
    id: path,
    name: fc ? 'Evo Songs · FC' : 'Evo Songs',
    short_name: fc ? 'Evo FC' : 'Evo Songs',
    description: 'Backing-track mixdowns for First Club vocalists.',
    start_url: path,
    scope: path,   // awalan: mencakup /v/<kode> dan /v/<kode>/play/<n>
    display: 'standalone',
    orientation: 'any',
    background_color: '#07080b',
    theme_color: '#07080b',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/manifest+json; charset=utf-8', 'cache-control': 'public, max-age=300' },
  });
}
