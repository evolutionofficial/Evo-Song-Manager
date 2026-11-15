// DEVELOPER — /test. Jeffry menelepon HP-nya sendiri dari PC untuk menguji fitur panggilan
// sebelum dipakai vokalis. Kedua perangkat masuk dengan akun admin yang SAMA, lalu
// test_call_room() di database memberi keduanya ruang uji yang sama (tanpa vokalis).
//   PC  : /test           -> peran host (penelepon)
//   HP  : /test?as=phone  -> peran guest (penerima)
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { createCallPanel } from '/js/core/callpanel.js';

const asPhone = new URLSearchParams(location.search).get('as') === 'phone';
let panel = null;

async function testRoom() {
  const { data, error } = await sb.rpc('test_call_room');
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

function showLogin(msg = '') {
  $('appView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginErr').textContent = msg;
}

function paintRole() {
  $('asPc').classList.toggle('primary', !asPhone);
  $('asPhone').classList.toggle('primary', asPhone);
  $('roleNote').textContent = asPhone
    ? 'Phone mode: wait for the call from your PC, then press Answer.'
    : 'PC mode: press Call. Your phone (open on /test?as=phone) will show Answer.';
  $('phoneLink').classList.toggle('hidden', asPhone);
  $('phoneUrl').textContent = location.origin + '/test?as=phone';
}

async function enter(session) {
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('whoami').textContent = session.user.email + (asPhone ? ' · phone' : ' · PC');
  paintRole();
  panel = createCallPanel({
    mount: $('testCallPanel'),
    role: asPhone ? 'guest' : 'host',
    testRoom,
    onError: (e) => toast('Call: ' + (e?.message || e), 'bad'),
  });
  await panel.show();
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: ok } = await sb.rpc('is_admin');
  if (!ok) {
    await sb.auth.signOut();
    return showLogin(session.user.email + ' is not an admin account.');
  }
  await enter(session);
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginErr').textContent = '';
  const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
  if (error) { $('loginErr').textContent = 'Wrong email or password.'; return; }
  await boot();
});
$('logoutBtn').addEventListener('click', async () => { panel?.stop(); await sb.auth.signOut(); location.reload(); });
$('asPc').addEventListener('click', () => { if (asPhone) location.href = '/test'; });
$('asPhone').addEventListener('click', () => { if (!asPhone) location.href = '/test?as=phone'; });
$('copyUrl').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('phoneUrl').textContent); toast('Copied'); }
  catch (_) { toast('Copy failed — select the address by hand', 'bad'); }
});

boot().catch((e) => showLogin('Could not start: ' + (e?.message || e)));
