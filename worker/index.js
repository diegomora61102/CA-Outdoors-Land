// CA Outdoors Land: serves the static site, plus one server-side endpoint for signing in with a username.
// Supabase signs in with email + password, so a username has to be turned into its email first. Doing that
// here (with the secret key) keeps everyone's email private: the browser only ever gets back session tokens.
//
// Needs, in Cloudflare (Worker -> Settings -> Variables and Secrets):
//   SUPABASE_SECRET_KEY  (type Secret)  the Supabase secret key (sb_secret_...) or legacy service_role key
// SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are public and set in wrangler.jsonc.

const WRONG = 'Wrong username or password.';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/login') return login(request, env);
    return env.ASSETS.fetch(request);
  }
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

function keyHeaders(key) {
  // New-style keys go in the apikey header only; legacy JWT keys also as a Bearer token.
  return key.startsWith('eyJ') ? { apikey: key, Authorization: 'Bearer ' + key } : { apikey: key };
}

async function login(request, env) {
  if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!env.SUPABASE_SECRET_KEY) return json({ error: 'Signing in with a username isn\'t set up yet. Use your email instead.' }, 503);
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'Bad request.' }, 400); }
  const username = String(body.username || '').trim().toLowerCase();
  const password = String(body.password || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username) || !password || password.length > 200) return json({ error: WRONG }, 401);

  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const ip = request.headers.get('CF-Connecting-IP') || '';
  const look = await fetch(base + '/rest/v1/rpc/email_for_username', {
    method: 'POST',
    headers: { ...keyHeaders(env.SUPABASE_SECRET_KEY), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: username })
  });
  if (!look.ok) return json({ error: 'Sign-in isn\'t available right now. Try your email instead.' }, 502);
  const email = await look.json();
  if (!email || typeof email !== 'string') return json({ error: WRONG }, 401);

  const tok = await fetch(base + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { ...keyHeaders(env.SUPABASE_PUBLISHABLE_KEY), 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
    body: JSON.stringify({ email, password })
  });
  const d = await tok.json().catch(() => ({}));
  if (!tok.ok) {
    const msg = String(d.msg || d.error_description || d.message || '');
    if (/confirm/i.test(msg)) return json({ error: 'Confirm your email first: open the link we sent when you created your account.' }, 401);
    if (tok.status === 429) return json({ error: 'Too many tries. Wait a few minutes and try again.' }, 429);
    return json({ error: WRONG }, 401);
  }
  return json({ access_token: d.access_token, refresh_token: d.refresh_token });
}
