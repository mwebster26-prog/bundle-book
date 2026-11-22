// Google sign-in (OAuth 2.0 token flow by full-page redirect, which also works inside an
// installed iPhone web app where pop-ups don't) and the few Drive API calls Bundle Book needs.
// Scope drive.file: the app can only see files and folders it created itself.
window.Drive = (() => {
  const SCOPE = 'https://www.googleapis.com/auth/drive.file';
  const API = 'https://www.googleapis.com/drive/v3';
  const UP = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER = 'application/vnd.google-apps.folder';
  const SHEET = 'application/vnd.google-apps.spreadsheet';
  const K = { tok: 'bb.google.token', state: 'bb.google.state', who: 'bb.google.email' };
  const ls = {
    get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
    del: k => { try { localStorage.removeItem(k); } catch {} },
  };
  const err = (code, message, extra) => Object.assign(new Error(message), { code }, extra);

  const clientId = () => (window.BB_CONFIG || {}).googleClientId || '';
  const configured = () => /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/.test(clientId());
  const redirectUri = () => location.origin + location.pathname.replace(/index\.html$/, '');
  const email = () => ls.get(K.who) || '';

  function token() {
    const t = ls.get(K.tok);
    return t && t.exp > Date.now() + 60e3 ? t.v : null;
  }

  function connect() {
    if (!configured()) throw err('config', 'Add your OAuth client ID to config.js first.');
    const state = crypto.randomUUID();
    ls.set(K.state, state);
    const p = new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri(), response_type: 'token',
      scope: SCOPE, include_granted_scopes: 'true', state,
    });
    if (email()) p.set('login_hint', email());
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + p);
  }

  // Call once at startup: picks up the token Google put in the URL fragment.
  function handleRedirect() {
    const h = location.hash.slice(1);
    if (!/(^|&)(access_token|error)=/.test(h)) return null;
    const p = new URLSearchParams(h);
    history.replaceState(null, '', location.pathname + location.search);
    const expected = ls.get(K.state);
    ls.del(K.state);
    if (p.get('error')) return { error: p.get('error') };
    if (!expected || p.get('state') !== expected) return { error: 'state_mismatch' };
    ls.set(K.tok, { v: p.get('access_token'), exp: Date.now() + (Number(p.get('expires_in')) || 3600) * 1000 });
    return { ok: true };
  }

  function disconnect() {
    const t = ls.get(K.tok);
    ls.del(K.tok); ls.del(K.who);
    if (t?.v) fetch('https://oauth2.googleapis.com/revoke?token=' + encodeURIComponent(t.v), { method: 'POST', mode: 'no-cors' }).catch(() => {});
  }

  async function g(url, o = {}) {
    const t = token();
    if (!t) throw err('auth', 'Google sign-in needed');
    let r;
    try { r = await fetch(url, { ...o, headers: { ...(o.headers || {}), Authorization: 'Bearer ' + t } }); }
    catch { throw err('offline', 'No connection to Google'); }
    if (r.status === 401) { ls.del(K.tok); throw err('auth', 'Google sign-in expired'); }
    if (!r.ok) {
      let m = '';
      try { m = (await r.json()).error?.message || ''; } catch {}
      throw err('http', m || 'Drive error ' + r.status, { status: r.status });
    }
    return r.status === 204 ? null : r.json();
  }

  async function whoami() {
    const r = await g(API + '/about?fields=user(emailAddress)');
    const e = r?.user?.emailAddress || '';
    if (e) ls.set(K.who, e);
    return e;
  }

  const qv = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  async function ensureFolder(name, parent = 'root') {
    const found = await findFile(name, parent, FOLDER);
    if (found) return found;
    const c = await g(API + '/files?fields=id', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }),
    });
    return c.id;
  }

  async function findFile(name, parent, mimeType) {
    const q = `name = '${qv(name)}' and mimeType = '${mimeType}' and '${qv(parent)}' in parents and trashed = false`;
    const r = await g(API + '/files?' + new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' }));
    return r.files?.[0]?.id || null;
  }

  // Finds a file the app tagged with appProperties {key: value} inside a folder.
  async function findByProp(key, value, parent) {
    const q = `appProperties has { key='${qv(key)}' and value='${qv(value)}' } and '${qv(parent)}' in parents and trashed = false`;
    const r = await g(API + '/files?' + new URLSearchParams({ q, fields: 'files(id)', pageSize: '1', spaces: 'drive' }));
    return r.files?.[0]?.id || null;
  }

  // True if the file/folder still exists and isn't in the bin.
  async function alive(id) {
    try { return !(await g(API + '/files/' + encodeURIComponent(id) + '?fields=id,trashed')).trashed; }
    catch (e) { if (e.code === 'http' && (e.status === 404 || e.status === 403)) return false; throw e; }
  }

  // Create (no fileId) or replace the content of (fileId) a file, metadata + body in one request.
  function upload(meta, blob, fileId) {
    const b = 'bb' + crypto.randomUUID().replace(/-/g, '');
    const body = new Blob([
      `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
      `--${b}\r\nContent-Type: ${blob.type || 'application/octet-stream'}\r\n\r\n`, blob, `\r\n--${b}--`,
    ]);
    const url = UP + '/files' + (fileId ? '/' + encodeURIComponent(fileId) : '') + '?uploadType=multipart&fields=id,webViewLink';
    return g(url, { method: fileId ? 'PATCH' : 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body });
  }

  // Drive "lock" (content restriction): the file opens view-only for everyone, owner included,
  // until it's unlocked. The app unlocks, writes, and locks again on every sync.
  const LOCK_REASON = 'Managed by Bundle Book. Make changes in the app; they sync here.';
  const setLock = (id, on) => g(API + '/files/' + encodeURIComponent(id) + '?fields=id', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentRestrictions: [on ? { readOnly: true, reason: LOCK_REASON } : { readOnly: false }] }),
  });
  // Create or replace a file's content, leaving it locked. Returns the upload result plus lockError
  // if only the final re-lock failed (the content is written either way; the next sync re-locks).
  async function writeLocked(meta, blob, fileId) {
    if (fileId) await setLock(fileId, false);
    const r = await upload(meta, blob, fileId);
    try { await setLock(r.id, true); }
    catch (e) { if (e.code === 'auth' || e.code === 'offline') throw e; r.lockError = e.message; }
    return r;
  }

  return { configured, writeLocked, token, connect, disconnect, handleRedirect, whoami, email, ensureFolder, findFile, findByProp, alive, upload, redirectUri, SHEET };
})();
