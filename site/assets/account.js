// Shared accounts for every page: username/email + password sign-in, sign-up with a username, password reset.
// Pages use window.Account: { sb, user, username, onChange(fn), openAuth(message), toast(message), ready }.
(function () {
  const CFG = window.APP_CONFIG || {};
  const sb = (window.supabase && CFG.supabaseUrl) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const USER_RE = /^[a-z0-9_]{3,20}$/;
  let user = null, username = null;
  const subs = [];

  const toastEl = $('toast'); let toastT;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg; toastEl.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3600);
  }

  // ---------- Dialog ----------
  const dlg = $('authDlg'), acctBtn = $('acctBtn'), mineBtn = $('mineBtn');
  let note = '';
  const VIEWS = {
    signin: () => `
      <h2 id="authTitle">Sign in</h2>
      <p class="a-msg" id="aMsg">${esc(note || 'Sign in with your username or email and your password.')}</p>
      <form id="aForm" novalidate>
        <label for="aLogin">Username or email</label>
        <input id="aLogin" autocomplete="username" required autocapitalize="none" spellcheck="false">
        <label for="aPass">Password</label>
        <input id="aPass" type="password" autocomplete="current-password" required>
        <button type="submit" class="btn" id="aGo">Sign in</button>
      </form>
      <p class="a-links"><button type="button" class="link" data-view="forgot">Forgot password?</button><span>New here? <button type="button" class="link" data-view="signup">Create an account</button></span></p>`,
    signup: () => `
      <h2 id="authTitle">Create an account</h2>
      <p class="a-msg" id="aMsg">${esc(note || 'Save places, share lists and write reviews.')}</p>
      <form id="aForm" novalidate>
        <label for="aUser">Username</label>
        <input id="aUser" autocomplete="username" required autocapitalize="none" spellcheck="false" maxlength="20" aria-describedby="aUserHelp">
        <small id="aUserHelp">3–20 characters: lowercase letters, numbers and underscores. Shown on your reviews.</small>
        <label for="aEmail">Email</label>
        <input id="aEmail" type="email" autocomplete="email" required>
        <label for="aPass">Password</label>
        <input id="aPass" type="password" autocomplete="new-password" required minlength="8" aria-describedby="aPassHelp">
        <small id="aPassHelp">At least 8 characters.</small>
        <button type="submit" class="btn" id="aGo">Create account</button>
      </form>
      <p class="a-links"><span>Already have an account? <button type="button" class="link" data-view="signin">Sign in</button></span></p>`,
    forgot: () => `
      <h2 id="authTitle">Reset your password</h2>
      <p class="a-msg" id="aMsg">Enter your account's email and we'll send a link to set a new password.</p>
      <form id="aForm" novalidate>
        <label for="aEmail">Email</label>
        <input id="aEmail" type="email" autocomplete="email" required>
        <button type="submit" class="btn" id="aGo">Email me a reset link</button>
      </form>
      <p class="a-links"><button type="button" class="link" data-view="signin">Back to sign in</button></p>`,
    newpass: () => `
      <h2 id="authTitle">Set a new password</h2>
      <p class="a-msg" id="aMsg">Choose a new password for your account.</p>
      <form id="aForm" novalidate>
        <label for="aPass">New password</label>
        <input id="aPass" type="password" autocomplete="new-password" required minlength="8">
        <button type="submit" class="btn" id="aGo">Save password</button>
      </form>`,
    pickname: () => `
      <h2 id="authTitle">Choose a username</h2>
      <p class="a-msg" id="aMsg">Your account needs a username. It's shown on your reviews and you can sign in with it.</p>
      <form id="aForm" novalidate>
        <label for="aUser">Username</label>
        <input id="aUser" required autocapitalize="none" spellcheck="false" maxlength="20">
        <small>3–20 characters: lowercase letters, numbers and underscores.</small>
        <button type="submit" class="btn" id="aGo">Save username</button>
      </form>`
  };
  let view = 'signin';
  function show(v, msg) {
    view = v; note = msg || '';
    dlg.innerHTML = `<button type="button" class="x" id="aClose" aria-label="Close">×</button>` + VIEWS[v]();
    $('aClose').onclick = () => dlg.close();
    dlg.querySelectorAll('[data-view]').forEach(b => b.onclick = () => show(b.dataset.view));
    $('aForm').addEventListener('submit', submit);
    if (!dlg.open) dlg.showModal();
    const first = dlg.querySelector('input'); if (first) setTimeout(() => first.focus(), 30);
  }
  const say = (msg, bad) => { const m = $('aMsg'); m.textContent = msg; m.classList.toggle('bad', !!bad); };
  async function submit(ev) {
    ev.preventDefault();
    const go = $('aGo'), label = go.textContent; go.disabled = true; go.textContent = 'One moment…';
    try { await handlers[view](); }
    catch (e) { say(e.message || 'Something went wrong. Try again.', true); }
    finally { if ($('aGo')) { $('aGo').disabled = false; $('aGo').textContent = label; } }
  }
  const redirect = () => location.href.split('#')[0];
  const handlers = {
    async signin() {
      const login = $('aLogin').value.trim(), password = $('aPass').value;
      if (!login || !password) throw new Error('Enter your username or email, and your password.');
      if (login.includes('@')) {
        const { error } = await sb.auth.signInWithPassword({ email: login, password });
        if (error) throw new Error(/confirm/i.test(error.message) ? 'Confirm your email first: open the link we sent when you created your account.' : 'Wrong email or password.');
      } else {
        const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: login.toLowerCase(), password }) });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Wrong username or password.');
        const { error } = await sb.auth.setSession({ access_token: d.access_token, refresh_token: d.refresh_token });
        if (error) throw new Error('Signing in didn\'t finish. Try again.');
      }
      dlg.close(); toast('Signed in');
    },
    async signup() {
      const name = $('aUser').value.trim().toLowerCase(), email = $('aEmail').value.trim(), password = $('aPass').value;
      if (!USER_RE.test(name)) throw new Error('Usernames are 3–20 characters: lowercase letters, numbers and underscores.');
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
      if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
      const { data: free, error: e1 } = await sb.rpc('username_available', { name });
      if (e1) throw new Error('Couldn\'t check that username. Try again in a moment.');
      if (!free) throw new Error('That username is taken. Try another.');
      const { data, error } = await sb.auth.signUp({ email, password, options: { data: { username: name }, emailRedirectTo: redirect() } });
      if (error) throw new Error(/registered|exists/i.test(error.message) ? 'An account with that email already exists. Sign in instead.' : error.message);
      if (data.session) { dlg.close(); toast('Welcome, ' + name); return; }
      say('Almost done: check your email and open the confirmation link, then sign in here.');
      $('aForm').hidden = true;
    },
    async forgot() {
      const email = $('aEmail').value.trim();
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter the email for your account.');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect() });
      if (error) throw new Error(error.message);
      say('If that email has an account, a reset link is on its way. Open it on this device.');
      $('aForm').hidden = true;
    },
    async newpass() {
      const password = $('aPass').value;
      if (password.length < 8) throw new Error('Use a password of at least 8 characters.');
      const { error } = await sb.auth.updateUser({ password });
      if (error) throw new Error(error.message);
      dlg.close(); toast('Password updated');
    },
    async pickname() {
      const name = $('aUser').value.trim().toLowerCase();
      if (!USER_RE.test(name)) throw new Error('Usernames are 3–20 characters: lowercase letters, numbers and underscores.');
      const { error } = await sb.from('profiles').insert({ user_id: user.id, username: name });
      if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'That username is taken. Try another.' : error.message);
      username = name; paint(); dlg.close(); toast('Username saved');
      subs.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
    }
  };
  function openAuth(msg) { if (sb) show('signin', msg); }

  // ---------- Header ----------
  let who = $('whoami');
  if (!who && acctBtn) { who = document.createElement('span'); who.id = 'whoami'; who.className = 'whoami'; acctBtn.before(who); }
  function paint() {
    if (!acctBtn) return;
    acctBtn.textContent = user ? 'Sign out' : 'Sign in';
    acctBtn.classList.toggle('primary', !user);
    if (who) { who.textContent = user ? (username ? '@' + username : '') : ''; who.hidden = !user; }
    if (mineBtn) mineBtn.hidden = !user;
  }
  async function loadProfile() {
    username = null;
    if (!user) return;
    const { data } = await sb.from('profiles').select('username').eq('user_id', user.id).maybeSingle();
    username = data ? data.username : null;
    if (!username && dlg && !dlg.open) show('pickname');   // accounts made before usernames existed
  }
  async function set(u) {
    if ((u && u.id) === (user && user.id)) return;
    user = u; await loadProfile(); paint();
    subs.forEach(fn => { try { fn(user); } catch (e) { console.error(e); } });
  }

  if (!sb) { if (acctBtn) acctBtn.hidden = true; }
  else {
    acctBtn.addEventListener('click', async () => {
      if (!user) return openAuth();
      await sb.auth.signOut(); toast('Signed out');
    });
    sb.auth.onAuthStateChange((event, session) => {
      set(session ? session.user : null);
      if (event === 'PASSWORD_RECOVERY') show('newpass');
    });
  }
  paint();
  const ready = sb ? sb.auth.getSession().then(({ data }) => set(data.session ? data.session.user : null)).catch(() => {}) : Promise.resolve();

  window.Account = {
    sb, ready, toast, openAuth,
    get user() { return user; },
    get username() { return username; },
    onChange(fn) { subs.push(fn); }
  };
})();
