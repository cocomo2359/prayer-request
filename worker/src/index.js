// Prayer Wall API – Cloudflare Worker + D1 (SQLite).
// The app on GitHub Pages calls this with `Authorization: Bearer <session token>`.

const DEFAULT_PASSWORD = 'p@ssw0rd';
const SESSION_DAYS = 30;
const MAX_MEMBERS = 30;
// PBKDF2 rounds. Kept modest so a login fits in the Workers free plan CPU budget;
// the round count is stored with each hash, so it can be raised later.
const PBKDF2_ROUNDS = 20000;

const AVATARS = ['🙂', '😊', '🕊️', '🌻', '🌿', '⭐', '🔥', '🦁', '🐑', '🌈', '☀️', '💧', '🍇', '🌾', '⛰️', '🎵'];
const CATEGORIES = ['General', 'Health', 'Family', 'Work', 'Studies', 'Finances', 'Spiritual', 'Thanksgiving'];
const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const USERNAME_MSG = 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore';
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new HttpError(status, message); };

// ---------- small helpers ----------
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const randomHex = (n) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomAvatar = () => AVATARS[crypto.getRandomValues(new Uint8Array(1))[0] % AVATARS.length];
const newInviteCode = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => CODE_CHARS[b % 32]).join('');

async function hashPassword(password, saltB64, rounds = PBKDF2_ROUNDS) {
  const salt = saltB64 ? unb64(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
  return `pbkdf2$${rounds}$${b64(salt)}$${b64(new Uint8Array(bits))}`;
}

async function verifyPassword(password, stored) {
  const [kind, rounds, salt] = String(stored).split('$');
  if (kind !== 'pbkdf2') return false;
  const candidate = await hashPassword(typeof password === 'string' ? password : '', salt, Number(rounds));
  if (candidate.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < stored.length; i++) diff |= candidate.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

function publicUser(u) {
  return {
    id: u.id, username: u.username, display_name: u.display_name, avatar: u.avatar,
    is_admin: !!u.is_admin, must_change_password: !!u.must_change_password,
  };
}

// ---------- context per request ----------
function makeCtx(env, req, url) {
  const db = env.DB;
  const one = (sql, ...a) => db.prepare(sql).bind(...a).first();
  const all = async (sql, ...a) => (await db.prepare(sql).bind(...a).all()).results;
  const run = (sql, ...a) => db.prepare(sql).bind(...a).run();
  return { env, req, url, db, one, all, run };
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'DELETE') return {};
  try { return (await req.json()) || {}; } catch { return {}; }
}

// ---------- auth ----------
async function currentUser(c) {
  const h = c.req.headers.get('Authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!token) fail(401, 'Please log in');
  const u = await c.one(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
    token, Date.now()
  );
  if (!u) fail(401, 'Session expired, please log in again');
  c.token = token;
  return u;
}

async function member(c) {
  const u = await currentUser(c);
  if (u.must_change_password) fail(403, 'Please change your password first');
  return u;
}

async function admin(c) {
  const u = await member(c);
  if (!u.is_admin) fail(403, 'Only the System Admin can do this');
  return u;
}

async function startSession(c, userId) {
  const token = randomHex(32);
  await c.db.batch([
    c.db.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(Date.now()),
    c.db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind(token, userId, Date.now() + SESSION_DAYS * 86400000),
  ]);
  return token;
}

// Throttle (stored in D1 so it works across Worker instances).
const WINDOW = 15 * 60 * 1000;
async function blocked(c, key, limit) {
  const a = await c.one('SELECT n, first_at FROM attempts WHERE key = ?', key);
  return !!a && a.n >= limit && Date.now() - a.first_at < WINDOW;
}
async function recordFail(c, key) {
  const now = Date.now();
  await c.run(
    `INSERT INTO attempts (key, n, first_at) VALUES (?, 1, ?)
     ON CONFLICT(key) DO UPDATE SET
       n = CASE WHEN ? - first_at > ? THEN 1 ELSE n + 1 END,
       first_at = CASE WHEN ? - first_at > ? THEN ? ELSE first_at END`,
    key, now, now, WINDOW, now, WINDOW, now
  );
}

async function inviteCode(c) {
  const row = await c.one(`SELECT value FROM settings WHERE key = 'invite_code'`);
  if (row) return row.value;
  await c.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('invite_code', ?)`, newInviteCode());
  return (await c.one(`SELECT value FROM settings WHERE key = 'invite_code'`)).value;
}

const userCount = async (c) => (await c.one('SELECT COUNT(*) AS n FROM users')).n;

// ---------- prayer requests ----------
const REQUEST_SELECT = `
  SELECT r.*, u.display_name AS author_name, u.avatar AS author_avatar,
    (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id) AS prayer_count,
    (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id AND p.user_id = ?1) AS my_prayers
  FROM requests r JOIN users u ON u.id = r.user_id`;

function shapeRequest(r, me) {
  const { my_prayers, ...rest } = r;
  return { ...rest, is_mine: r.user_id === me, prayed_by_me: my_prayers > 0 };
}

async function loadRequest(c, id, me) {
  const r = await c.one(`${REQUEST_SELECT} WHERE r.id = ?2`, me, id);
  return r ? shapeRequest(r, me) : null;
}

function validateRequest(b) {
  const title = str(b.title, 100);
  const text = str(b.body, 2000);
  const category = CATEGORIES.includes(b.category) ? b.category : 'General';
  if (!title) fail(400, 'Please give your request a short title');
  if (!text) fail(400, 'Please describe your prayer request');
  return { title, text, category };
}

async function ownRequest(c, me, id) {
  const r = await c.one('SELECT * FROM requests WHERE id = ?', id);
  if (!r) fail(404, 'Prayer request not found');
  if (r.user_id !== me.id) fail(403, 'Only the person who posted this request can change it');
  return r;
}

// Prayer streak: consecutive days (in the member's own time zone) with a prayer.
function dayIn(tz, date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function streakFor(times, tz) {
  const days = [...new Set(times.map((t) => dayIn(tz, new Date(t.replace(' ', 'T') + 'Z'))))];
  const today = dayIn(tz, new Date());
  const yesterday = dayIn(tz, new Date(Date.now() - 86400000));
  if (!days.length || (days[0] !== today && days[0] !== yesterday)) return { streak: 0, prayedToday: false };
  let streak = 0;
  const cursor = new Date(days[0] + 'T12:00:00Z');
  for (const d of days) {
    if (d !== cursor.toISOString().slice(0, 10)) break;
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return { streak, prayedToday: days[0] === today };
}

// ---------- routes ----------
const routes = [];
const route = (method, pattern, handler) =>
  routes.push([method, new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>\\d+)') + '$'), handler]);

route('GET', '/api/setup-status', async (c) => ({ needsLeader: (await userCount(c)) === 0 }));

route('POST', '/api/login', async (c, b) => {
  const username = str(b.username, 40).toLowerCase();
  const key = 'login:' + username;
  if (await blocked(c, key, 10)) fail(429, 'Too many attempts. Try again in 15 minutes.');
  const user = await c.one('SELECT * FROM users WHERE username = ?', username);
  if (!user || !(await verifyPassword(b.password, user.password_hash))) {
    await recordFail(c, key);
    fail(401, 'Wrong username or password');
  }
  await c.run('DELETE FROM attempts WHERE key = ?', key);
  return { token: await startSession(c, user.id), user: publicUser(user) };
});

// First account becomes System Admin; everyone after needs the invite code.
route('POST', '/api/register', async (c, b) => {
  const display_name = str(b.display_name, 40);
  const username = str(b.username, 30).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const first = (await userCount(c)) === 0;
  if (!first) {
    if (await blocked(c, 'register', 20)) fail(429, 'Too many attempts. Try again in 15 minutes.');
    const code = str(b.inviteCode, 20).toUpperCase().replace(/\s/g, '');
    if (code !== (await inviteCode(c))) {
      await recordFail(c, 'register');
      fail(400, 'That cell invite code is not right. Ask your system admin for it.');
    }
  }
  if (!display_name) fail(400, 'Please enter your name');
  if (!USERNAME_RE.test(username)) fail(400, USERNAME_MSG);
  if (password.length < 6) fail(400, 'Password must be at least 6 characters');
  if (password === DEFAULT_PASSWORD) fail(400, 'Please choose a password other than the default');
  if ((await userCount(c)) >= MAX_MEMBERS) fail(400, `Member limit reached (${MAX_MEMBERS})`);
  if (await c.one('SELECT 1 FROM users WHERE username = ?', username)) fail(400, 'That username is already taken');
  const hash = await hashPassword(password);
  // is_admin is decided inside the INSERT so two simultaneous first sign-ups can't both become admin.
  const user = await c.one(
    `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, avatar)
     VALUES (?1, ?2, ?3, (SELECT COUNT(*) = 0 FROM users), 0,
             CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN '🕊️' ELSE ?4 END)
     RETURNING *`,
    username, display_name, hash, randomAvatar()
  );
  return { token: await startSession(c, user.id), user: publicUser(user), isLeader: !!user.is_admin };
});

route('POST', '/api/logout', async (c) => {
  await currentUser(c);
  await c.run('DELETE FROM sessions WHERE token = ?', c.token);
  return { ok: true };
});

route('GET', '/api/me', async (c) => ({ user: publicUser(await currentUser(c)) }));

route('POST', '/api/me/password', async (c, b) => {
  const me = await currentUser(c);
  if (!(await verifyPassword(b.currentPassword, me.password_hash))) fail(400, 'Current password is incorrect');
  if (typeof b.newPassword !== 'string' || b.newPassword.length < 6) fail(400, 'New password must be at least 6 characters');
  if (b.newPassword === DEFAULT_PASSWORD) fail(400, 'Please choose a password other than the default');
  const hash = await hashPassword(b.newPassword);
  await c.db.batch([
    c.db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').bind(hash, me.id),
    c.db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').bind(me.id, c.token), // sign out other devices
  ]);
  return { user: publicUser(await c.one('SELECT * FROM users WHERE id = ?', me.id)) };
});

route('PATCH', '/api/me', async (c, b) => {
  const me = await member(c);
  const display_name = str(b.display_name, 40) || me.display_name;
  const avatar = AVATARS.includes(b.avatar) ? b.avatar : me.avatar;
  await c.run('UPDATE users SET display_name = ?, avatar = ? WHERE id = ?', display_name, avatar, me.id);
  return { user: publicUser(await c.one('SELECT * FROM users WHERE id = ?', me.id)) };
});

// ----- members -----
route('GET', '/api/members', async (c) => {
  const me = await member(c);
  const rows = await c.all(
    `SELECT id, username, display_name, avatar, is_admin, must_change_password, created_at
     FROM users ORDER BY is_admin DESC, display_name COLLATE NOCASE`
  );
  // Only admins may see who is still on the (publicly known) default password;
  // for anyone else that would point straight at accounts they could log into.
  return {
    members: rows.map(({ must_change_password, ...m }) => ({
      ...m,
      is_admin: !!m.is_admin,
      ...(me.is_admin ? { must_change_password: !!must_change_password } : {}),
    })),
  };
});

route('POST', '/api/members', async (c, b) => {
  await admin(c);
  const username = str(b.username, 30).toLowerCase();
  const display_name = str(b.display_name, 40);
  if (!USERNAME_RE.test(username)) fail(400, USERNAME_MSG);
  if (!display_name) fail(400, 'Please enter the member’s name');
  if ((await userCount(c)) >= MAX_MEMBERS) fail(400, `Member limit reached (${MAX_MEMBERS})`);
  if (await c.one('SELECT 1 FROM users WHERE username = ?', username)) fail(400, 'That username is already taken');
  const row = await c.one(
    `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, avatar)
     VALUES (?, ?, ?, ?, 1, ?) RETURNING id`,
    username, display_name, await hashPassword(DEFAULT_PASSWORD), b.is_admin ? 1 : 0, randomAvatar()
  );
  return { id: row.id, defaultPassword: DEFAULT_PASSWORD };
});

route('POST', '/api/members/:id/reset-password', async (c, b, p) => {
  await admin(c);
  const id = Number(p.id);
  const res = await c.run('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
    await hashPassword(DEFAULT_PASSWORD), id);
  if (!res.meta.changes) fail(404, 'Member not found');
  await c.run('DELETE FROM sessions WHERE user_id = ?', id);
  return { ok: true, defaultPassword: DEFAULT_PASSWORD };
});

route('POST', '/api/members/:id/leader', async (c, b, p) => {
  const me = await admin(c);
  const id = Number(p.id);
  if (id === me.id) fail(400, 'You cannot change your own admin role');
  const res = await c.run('UPDATE users SET is_admin = ? WHERE id = ?', b.is_admin ? 1 : 0, id);
  if (!res.meta.changes) fail(404, 'Member not found');
  return { ok: true };
});

route('DELETE', '/api/members/:id', async (c, b, p) => {
  const me = await admin(c);
  const id = Number(p.id);
  if (id === me.id) fail(400, 'You cannot remove yourself');
  if (!(await c.one('SELECT 1 FROM users WHERE id = ?', id))) fail(404, 'Member not found');
  await c.db.batch([
    c.db.prepare('DELETE FROM prayers WHERE user_id = ? OR request_id IN (SELECT id FROM requests WHERE user_id = ?)').bind(id, id),
    c.db.prepare('DELETE FROM requests WHERE user_id = ?').bind(id),
    c.db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id),
    c.db.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);
  return { ok: true };
});

route('GET', '/api/invite', async (c) => { await admin(c); return { code: await inviteCode(c) }; });
route('POST', '/api/invite/regenerate', async (c) => {
  await admin(c);
  const code = newInviteCode();
  await c.run(`INSERT INTO settings (key, value) VALUES ('invite_code', ?)
               ON CONFLICT(key) DO UPDATE SET value = excluded.value`, code);
  return { code };
});

// ----- prayer requests -----
route('GET', '/api/requests', async (c) => {
  const me = await member(c);
  const f = c.url.searchParams.get('filter');
  const where = f === 'active' ? `WHERE r.status = 'active'`
    : f === 'answered' ? `WHERE r.status = 'answered'`
    : f === 'mine' ? 'WHERE r.user_id = ?1' : '';
  const rows = await c.all(`${REQUEST_SELECT} ${where} ORDER BY (r.status = 'answered'), r.created_at DESC`, me.id);
  return { requests: rows.map((r) => shapeRequest(r, me.id)) };
});

route('GET', '/api/requests/:id', async (c, b, p) => {
  const me = await member(c);
  const r = await loadRequest(c, Number(p.id), me.id);
  if (!r) fail(404, 'Prayer request not found');
  const prayers = await c.all(
    `SELECT p.*, u.display_name AS author_name, u.avatar AS author_avatar
     FROM prayers p JOIN users u ON u.id = p.user_id WHERE p.request_id = ? ORDER BY p.created_at, p.id`, r.id
  );
  return { request: r, prayers: prayers.map((x) => ({ ...x, is_mine: x.user_id === me.id })) };
});

route('POST', '/api/requests', async (c, b) => {
  const me = await member(c);
  const v = validateRequest(b);
  const row = await c.one('INSERT INTO requests (user_id, title, body, category) VALUES (?, ?, ?, ?) RETURNING id',
    me.id, v.title, v.text, v.category);
  return { request: await loadRequest(c, row.id, me.id) };
});

route('PUT', '/api/requests/:id', async (c, b, p) => {
  const me = await member(c);
  const r = await ownRequest(c, me, Number(p.id));
  const v = validateRequest(b);
  await c.run(`UPDATE requests SET title = ?, body = ?, category = ?, updated_at = datetime('now') WHERE id = ?`,
    v.title, v.text, v.category, r.id);
  return { request: await loadRequest(c, r.id, me.id) };
});

route('DELETE', '/api/requests/:id', async (c, b, p) => {
  const me = await member(c);
  const r = await ownRequest(c, me, Number(p.id));
  await c.db.batch([
    c.db.prepare('DELETE FROM prayers WHERE request_id = ?').bind(r.id),
    c.db.prepare('DELETE FROM requests WHERE id = ?').bind(r.id),
  ]);
  return { ok: true };
});

route('POST', '/api/requests/:id/answer', async (c, b, p) => {
  const me = await member(c);
  const r = await ownRequest(c, me, Number(p.id));
  if (b.answered !== false) {
    await c.run(`UPDATE requests SET status = 'answered', answer_note = ?, answered_at = datetime('now') WHERE id = ?`,
      str(b.note, 1000) || null, r.id);
  } else {
    await c.run(`UPDATE requests SET status = 'active', answer_note = NULL, answered_at = NULL WHERE id = ?`, r.id);
  }
  return { request: await loadRequest(c, r.id, me.id) };
});

// ----- prayers on a request -----
route('POST', '/api/requests/:id/prayers', async (c, b, p) => {
  const me = await member(c);
  const r = await c.one('SELECT id FROM requests WHERE id = ?', Number(p.id));
  if (!r) fail(404, 'Prayer request not found');
  const text = str(b.body, 2000);
  if (!text) fail(400, 'Please write your prayer');
  const row = await c.one('INSERT INTO prayers (request_id, user_id, body) VALUES (?, ?, ?) RETURNING id', r.id, me.id, text);
  return { id: row.id };
});

route('DELETE', '/api/prayers/:id', async (c, b, p) => {
  const me = await member(c);
  const pr = await c.one('SELECT * FROM prayers WHERE id = ?', Number(p.id));
  if (!pr) fail(404, 'Prayer not found');
  if (pr.user_id !== me.id) fail(403, 'You can only remove your own prayers');
  await c.run('DELETE FROM prayers WHERE id = ?', pr.id);
  return { ok: true };
});

// ----- dashboard -----
route('GET', '/api/stats', async (c) => {
  const me = await member(c);
  let tz = c.url.searchParams.get('tz') || 'UTC';
  try { dayIn(tz, new Date()); } catch { tz = 'UTC'; }
  const times = (await c.all('SELECT created_at FROM prayers WHERE user_id = ? ORDER BY created_at DESC LIMIT 3000', me.id))
    .map((r) => r.created_at);
  const { streak, prayedToday } = streakFor(times, tz);
  const n = async (sql, ...a) => (await c.one(sql, ...a)).n;
  return {
    streak,
    prayedToday,
    myPrayers: times.length,
    prayedThisWeek: await n(`SELECT COUNT(*) AS n FROM prayers WHERE user_id = ? AND created_at >= datetime('now', '-7 days')`, me.id),
    weeklyGoal: 7,
    active: await n(`SELECT COUNT(*) AS n FROM requests WHERE status = 'active'`),
    answered: await n(`SELECT COUNT(*) AS n FROM requests WHERE status = 'answered'`),
    needsPrayer: await n(`SELECT COUNT(*) AS n FROM requests r WHERE r.status = 'active' AND NOT EXISTS
      (SELECT 1 FROM prayers p WHERE p.request_id = r.id AND p.user_id != r.user_id)`),
    leaderboard: await c.all(
      `SELECT u.id, u.display_name, u.avatar, COUNT(p.id) AS n
       FROM users u LEFT JOIN prayers p ON p.user_id = u.id AND p.created_at >= datetime('now', '-7 days')
       GROUP BY u.id ORDER BY n DESC, u.display_name COLLATE NOCASE LIMIT 12`
    ),
  };
});

// ---------- entry point ----------
function corsHeaders(env, req) {
  const origin = req.headers.get('Origin') || '';
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = { 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Max-Age': '86400', Vary: 'Origin' };
  if (allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

const json = (data, status, headers) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req, env) {
    const cors = corsHeaders(env, req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const url = new URL(req.url);
    try {
      for (const [method, re, handler] of routes) {
        const m = method === req.method && url.pathname.match(re);
        if (m) {
          const c = makeCtx(env, req, url);
          return json(await handler(c, await readBody(req), m.groups || {}), 200, cors);
        }
      }
      if (url.pathname === '/' || url.pathname === '/api') return json({ ok: true, app: 'Prayer Wall API' }, 200, cors);
      fail(404, 'Not found');
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status, cors);
      console.error(err);
      return json({ error: 'Something went wrong on the server' }, 500, cors);
    }
  },
};
