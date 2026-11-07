// ADMIN — modul Login, daftar akun, lupa password.
import { sb } from '/js/core/supabase.js';
import { $, toast } from '/js/core/ui.js';
import { on } from '/js/core/guard.js';

let ctx;
let recovering = /type=recovery/.test(location.hash);

export function showLogin(msg = '') {
  $('appView').classList.add('hidden');
  $('resetView').classList.add('hidden');
  $('loginView').classList.remove('hidden');
  $('loginErr').textContent = msg;
}

function showReset() {
  recovering = true;
  $('loginView').classList.add('hidden');
  $('appView').classList.add('hidden');
  $('resetView').classList.remove('hidden');
}

export async function boot() {
  if (recovering) return showReset();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  const { data: ok } = await sb.rpc('is_admin');
  if (!ok) {
    showLogin(`${session.user.email} is not an admin account.`);
    await sb.auth.signOut();
    return;
  }
  $('loginView').classList.add('hidden');
  $('resetView').classList.add('hidden');
  await ctx.enterApp();
}

export async function logout() {
  await sb.auth.signOut();
  showLogin();
}

export function init(c) {
  ctx = c;

  on($('loginForm'), 'submit', 'Login', async (e) => {
    e.preventDefault();
    $('loginErr').textContent = '';
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('pw').value });
    if (error) {
      $('loginErr').textContent = /confirm/i.test(error.message)
        ? 'Email not confirmed yet. Open the confirmation email from Supabase first.'
        : 'Wrong email or password.';
      return;
    }
    await boot();
  });

  on($('signupBtn'), 'click', 'Login', async () => {
    const email = $('email').value.trim(), password = $('pw').value;
    if (!email || password.length < 6) { $('loginErr').textContent = 'Enter an email and password (at least 6 characters) first.'; return; }
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) { $('loginErr').textContent = error.message; return; }
    if (data.session) await boot();
    else $('loginErr').textContent = 'Account created. Check your email to confirm, then press Sign in.';
  });

  on($('forgotBtn'), 'click', 'Login', async () => {
    const email = $('email').value.trim();
    if (!email) { $('loginErr').textContent = 'Enter your email first, then press Forgot password.'; return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    $('loginErr').textContent = error
      ? 'Could not send email: ' + error.message
      : 'A password reset link has been sent to your email. Open it on this phone/PC.';
  });

  on($('resetForm'), 'submit', 'New password', async (e) => {
    e.preventDefault();
    const a = $('pw1').value, b = $('pw2').value;
    if (a.length < 6) { $('resetErr').textContent = 'Password must be at least 6 characters.'; return; }
    if (a !== b) { $('resetErr').textContent = 'The passwords do not match.'; return; }
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { $('resetErr').textContent = 'Failed: ' + error.message; return; }
    recovering = false;
    history.replaceState(null, '', location.pathname);
    $('resetView').classList.add('hidden');
    toast('New password saved');
    await boot();
  });

  sb.auth.onAuthStateChange((evt) => {
    if (evt === 'PASSWORD_RECOVERY') showReset();
    else if (evt === 'SIGNED_OUT' && !recovering) showLogin();
  });
}
