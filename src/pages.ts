// Minimal server-rendered pages for the OAuth login and consent redirects.
// Better Auth redirects here with a signed query string; the page hands that
// query back as `oauth_query` so the plugin can resume the authorization.

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: Canvas; color: CanvasText; }
  main { width: min(360px, calc(100vw - 32px)); padding: 24px; border: 1px solid color-mix(in srgb, CanvasText 15%, transparent); border-radius: 12px; }
  h1 { font-size: 1.25rem; margin: 0 0 16px; }
  label { display: block; font-size: 0.875rem; margin: 12px 0 4px; }
  input { width: 100%; box-sizing: border-box; padding: 10px; font: inherit; border: 1px solid color-mix(in srgb, CanvasText 30%, transparent); border-radius: 8px; background: Field; color: FieldText; }
  button { font: inherit; padding: 10px 16px; border-radius: 8px; border: 1px solid transparent; cursor: pointer; }
  .primary { background: AccentColor; color: AccentColorText; }
  .secondary { background: transparent; border-color: color-mix(in srgb, CanvasText 30%, transparent); color: inherit; }
  .row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }
  .error { color: #b00020; font-size: 0.875rem; min-height: 1.25em; margin-top: 12px; }
  code { font-size: 0.8125rem; word-break: break-all; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`;

export const signInPage = () =>
  shell(
    'Sign in — Family Skylight',
    `<h1>Sign in</h1>
<form id="f" autocomplete="on">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" autocomplete="username" required>
  <label for="password">Password</label>
  <input id="password" name="password" type="password" autocomplete="current-password" required>
  <div class="row"><button class="primary" type="submit">Continue</button></div>
  <p class="error" id="err" role="alert"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = document.getElementById('err');
  err.textContent = '';
  const body = {
    email: document.getElementById('email').value,
    password: document.getElementById('password').value,
  };
  const q = location.search.slice(1);
  if (q) body.oauth_query = q;
  const r = await fetch('/api/auth/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = d.message || d.error_description || 'Sign-in failed.'; return; }
  if (d.url) { location.href = d.url; return; }
  err.textContent = 'Signed in. You can close this window.';
});
</script>`
  );

export const consentPage = () =>
  shell(
    'Authorize — Family Skylight',
    `<h1>Allow access?</h1>
<p><code id="client"></code> is asking to use the family Skylight calendar, lists and chores on your behalf.</p>
<p>Scopes: <code id="scope"></code></p>
<div class="row">
  <button class="secondary" id="deny" type="button">Deny</button>
  <button class="primary" id="allow" type="button">Allow</button>
</div>
<p class="error" id="err" role="alert"></p>
<script>
const p = new URLSearchParams(location.search);
document.getElementById('client').textContent = p.get('client_id') || '(unknown client)';
document.getElementById('scope').textContent = p.get('scope') || '';
async function decide(accept) {
  const err = document.getElementById('err');
  err.textContent = '';
  const r = await fetch('/api/auth/oauth2/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { err.textContent = d.message || d.error_description || 'Request failed.'; return; }
  if (d.url) location.href = d.url;
}
document.getElementById('allow').addEventListener('click', () => decide(true));
document.getElementById('deny').addEventListener('click', () => decide(false));
</script>`
  );
