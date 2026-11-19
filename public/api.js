/* Talks to the Supabase database functions defined in supabase/schema.sql.
 * The app calls PrayerAPI.call('/requests/5', { method: 'PUT', body }) and this
 * file turns that into the matching database function call. */
(() => {
  const cfg = window.PRAYER_WALL_CONFIG || {};
  const BASE = (cfg.supabaseUrl || '').replace(/\/+$/, '');
  const KEY = cfg.supabaseKey || '';
  const TOKEN_KEY = 'prayer_wall_token';

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
  };

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function rpc(fn, args = {}) {
    const headers = { 'Content-Type': 'application/json', apikey: KEY };
    if (KEY.startsWith('eyJ')) headers.Authorization = 'Bearer ' + KEY; // legacy anon key
    let res;
    try {
      res = await fetch(`${BASE}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(args) });
    } catch {
      throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const hint = data && data.hint;
      const status = hint === 'auth' ? 401 : hint === 'pwchange' || hint === 'forbidden' ? 403 : hint === 'notfound' ? 404 : res.status;
      if (status === 401) store.set(null);
      throw new ApiError((data && data.message) || 'Something went wrong', status);
    }
    if (data && data.error) throw new ApiError(data.error, 400);
    return data;
  }

  const tz = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };

  // [method, path regex, handler(match, body, token, query)]
  const routes = [
    ['POST', /^\/login$/, async (m, b) => {
      const d = await rpc('login', { p_username: b.username, p_password: b.password });
      store.set(d.token);
      return { user: d.user };
    }],
    ['POST', /^\/register$/, async (m, b) => {
      const d = await rpc('register', {
        p_display_name: b.display_name, p_username: b.username, p_password: b.password, p_invite_code: b.inviteCode || null,
      });
      store.set(d.token);
      return { user: d.user, isLeader: d.isLeader };
    }],
    ['GET', /^\/setup-status$/, () => rpc('setup_status')],
    ['POST', /^\/logout$/, async (m, b, t) => { try { await rpc('logout', { p_token: t }); } finally { store.set(null); } return { ok: true }; }],
    ['GET', /^\/me$/, (m, b, t) => rpc('me', { p_token: t })],
    ['POST', /^\/me\/password$/, (m, b, t) => rpc('change_password', { p_token: t, p_current: b.currentPassword, p_new: b.newPassword })],
    ['PATCH', /^\/me$/, (m, b, t) => rpc('update_profile', { p_token: t, p_display_name: b.display_name, p_avatar: b.avatar })],
    ['GET', /^\/stats$/, (m, b, t) => rpc('stats', { p_token: t, p_tz: tz() })],

    ['GET', /^\/members$/, (m, b, t) => rpc('list_members', { p_token: t })],
    ['POST', /^\/members$/, (m, b, t) => rpc('add_member', { p_token: t, p_username: b.username, p_display_name: b.display_name, p_is_admin: !!b.is_admin })],
    ['POST', /^\/members\/(\d+)\/reset-password$/, (m, b, t) => rpc('reset_password', { p_token: t, p_id: +m[1] })],
    ['POST', /^\/members\/(\d+)\/leader$/, (m, b, t) => rpc('set_admin', { p_token: t, p_id: +m[1], p_is_admin: !!b.is_admin })],
    ['DELETE', /^\/members\/(\d+)$/, (m, b, t) => rpc('remove_member', { p_token: t, p_id: +m[1] })],
    ['GET', /^\/invite$/, (m, b, t) => rpc('get_invite', { p_token: t })],
    ['POST', /^\/invite\/regenerate$/, (m, b, t) => rpc('regenerate_invite', { p_token: t })],

    ['GET', /^\/requests$/, (m, b, t, q) => rpc('list_requests', { p_token: t, p_filter: q.get('filter') || 'all' })],
    ['POST', /^\/requests$/, (m, b, t) => rpc('create_request', { p_token: t, p_title: b.title, p_body: b.body, p_category: b.category })],
    ['GET', /^\/requests\/(\d+)$/, (m, b, t) => rpc('get_request', { p_token: t, p_id: +m[1] })],
    ['PUT', /^\/requests\/(\d+)$/, (m, b, t) => rpc('update_request', { p_token: t, p_id: +m[1], p_title: b.title, p_body: b.body, p_category: b.category })],
    ['DELETE', /^\/requests\/(\d+)$/, (m, b, t) => rpc('delete_request', { p_token: t, p_id: +m[1] })],
    ['POST', /^\/requests\/(\d+)\/answer$/, (m, b, t) => rpc('set_answered', { p_token: t, p_id: +m[1], p_answered: b.answered !== false, p_note: b.note || null })],
    ['POST', /^\/requests\/(\d+)\/prayers$/, (m, b, t) => rpc('add_prayer', { p_token: t, p_request_id: +m[1], p_body: b.body })],
    ['DELETE', /^\/prayers\/(\d+)$/, (m, b, t) => rpc('delete_prayer', { p_token: t, p_id: +m[1] })],
  ];

  async function call(path, opts = {}) {
    const method = opts.method || 'GET';
    const [p, qs] = path.split('?');
    for (const [verb, re, handler] of routes) {
      const m = verb === method && p.match(re);
      if (m) return handler(m, opts.body || {}, store.get(), new URLSearchParams(qs || ''));
    }
    throw new ApiError('Not found', 404);
  }

  window.PrayerAPI = { call, configured: !!(BASE && KEY), hasToken: () => !!store.get() };
})();
