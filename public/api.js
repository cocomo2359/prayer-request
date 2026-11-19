/* Calls the Prayer Wall API (Cloudflare Worker in worker/src/index.js).
 * The session token is kept in this browser and sent as a Bearer token. */
(() => {
  const BASE = ((window.PRAYER_WALL_CONFIG || {}).apiUrl || '').replace(/\/+$/, '');
  const TOKEN_KEY = 'prayer_wall_token';

  const store = {
    get() { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
    set(t) { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ } },
  };

  class ApiError extends Error {
    constructor(message, status) { super(message); this.status = status; }
  }

  async function call(path, opts = {}) {
    if (path === '/stats') {
      let tz = 'UTC';
      try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* old browser */ }
      path += '?tz=' + encodeURIComponent(tz);
    }
    const headers = {};
    if (opts.body) headers['Content-Type'] = 'application/json';
    const token = store.get();
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(BASE + '/api' + path, {
        method: opts.method || 'GET',
        headers,
        body: opts.body ? JSON.stringify(opts.body) : undefined,
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) store.set(null);
      throw new ApiError(data.error || 'Something went wrong', res.status);
    }
    if (data.token) store.set(data.token);                 // login / register
    if (path === '/logout') store.set(null);
    return data;
  }

  window.PrayerAPI = { call, configured: !!BASE, hasToken: () => !!store.get() };
})();
