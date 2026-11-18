// Shared sign-in for every page: header button, email-link dialog, toasts.
// Pages use window.Account: { sb, user, onChange(fn), openAuth(message), toast(message), ready }.
(function () {
  const CFG = window.APP_CONFIG || {};
  const sb = (window.supabase && CFG.supabaseUrl) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  let user = null;
  const subs = [];

  const toastEl = $('toast'); let toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3200);
  }

  const dlg = $('authDlg'), acctBtn = $('acctBtn'), mineBtn = $('mineBtn');
  function openAuth(msg) {
    if (!sb || !dlg) return;
    $('authMsg').textContent = msg || 'Get a sign-in link by email. No password needed.';
    $('authSent').hidden = true; $('authForm').hidden = false;
    $('googleBtn').hidden = !CFG.googleSignIn;
    dlg.showModal();
    setTimeout(() => $('authEmail').focus(), 50);
  }
  function paint() {
    if (!acctBtn) return;
    acctBtn.textContent = user ? 'Sign out' : 'Sign in';
    acctBtn.classList.toggle('primary', !user);
    acctBtn.title = user ? 'Signed in as ' + (user.email || '') : 'Sign in to save places and write reviews';
    if (mineBtn) mineBtn.hidden = !user;
  }
  function set(u) {
    if ((u && u.id) === (user && user.id)) return;
    user = u; paint();
    if (u && dlg && dlg.open) dlg.close();
    subs.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
  }

  if (!sb) { if (acctBtn) acctBtn.hidden = true; }
  else {
    acctBtn.addEventListener('click', async () => {
      if (!user) return openAuth();
      await sb.auth.signOut(); toast('Signed out');
    });
    $('authClose').addEventListener('click', () => dlg.close());
    $('authForm').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const email = $('authEmail').value.trim();
      const btn = $('authSend'); btn.disabled = true; btn.textContent = 'Sending…';
      const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split('#')[0] } });
      btn.disabled = false; btn.textContent = 'Email me a sign-in link';
      if (error) { $('authMsg').textContent = 'That didn\'t work: ' + error.message; return; }
      $('authForm').hidden = true; $('authSent').hidden = false;
    });
    $('googleBtn').addEventListener('click', () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.href.split('#')[0] } }));
    sb.auth.onAuthStateChange((_ev, session) => set(session ? session.user : null));
  }
  paint();
  const ready = sb ? sb.auth.getSession().then(({ data }) => set(data.session ? data.session.user : null)).catch(() => {}) : Promise.resolve();

  window.Account = {
    sb, ready, toast, openAuth,
    get user() { return user; },
    onChange(fn) { subs.push(fn); }
  };
})();
