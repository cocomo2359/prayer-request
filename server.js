const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const { db, DEFAULT_PASSWORD, getInviteCode, regenerateInviteCode } = require('./db');

const app = express();
const PORT = process.env.PORT || 8080;
const SESSION_DAYS = 30;
const COOKIE = 'pw_session';

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------
const AVATARS = ['🙂', '😊', '🕊️', '🌻', '🌿', '⭐', '🔥', '🦁', '🐑', '🌈', '☀️', '💧', '🍇', '🌾', '⛰️', '🎵'];
const CATEGORIES = ['General', 'Health', 'Family', 'Work', 'Studies', 'Finances', 'Spiritual', 'Thanksgiving'];

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(res, token, maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`
  );
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    avatar: u.avatar,
    is_admin: !!u.is_admin,
    must_change_password: !!u.must_change_password,
  };
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

function bad(res, msg, code = 400) {
  return res.status(code).json({ error: msg });
}

// ---------- auth middleware ----------
function auth(req, res, next) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return bad(res, 'Please log in', 401);
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    )
    .get(token, Date.now());
  if (!row) return bad(res, 'Session expired, please log in again', 401);
  req.user = row;
  req.token = token;
  next();
}

// Members still on the default password must change it before using the app.
function passwordChanged(req, res, next) {
  if (req.user.must_change_password) return bad(res, 'Please change your password first', 403);
  next();
}

function adminOnly(req, res, next) {
  if (!req.user.is_admin) return bad(res, 'Only the System Admin can do this', 403);
  next();
}

// Simple in-memory login throttle (enough for a 12-person group).
const attempts = new Map();
function throttled(key) {
  const now = Date.now();
  const a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60 * 1000) { a.n = 0; a.t = now; }
  return a.n >= 10;
}
function recordFail(key) {
  const a = attempts.get(key) || { n: 0, t: Date.now() };
  a.n += 1;
  attempts.set(key, a);
}

// ---------- auth routes ----------
app.post('/api/login', (req, res) => {
  const username = str(req.body.username, 40);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const key = `${req.ip}|${username.toLowerCase()}`;
  if (throttled(key)) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFail(key);
    return bad(res, 'Wrong username or password', 401);
  }
  attempts.delete(key);
  startSession(res, user.id);
  res.json({ user: publicUser(user) });
});

function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + SESSION_DAYS * 86400 * 1000
  );
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  setSessionCookie(res, token, SESSION_DAYS * 86400);
}

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const USERNAME_MSG = 'Username must be 3–30 characters: letters, numbers, dot, dash or underscore';
const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;

// Tells the login screen whether the app still needs its first System Admin.
app.get('/api/setup-status', (req, res) => {
  res.json({ needsLeader: userCount() === 0 });
});

// Self sign-up. The very first account becomes the System Admin; everyone
// after that needs the cell's invite code (shown to admins on Members page).
app.post('/api/register', (req, res) => {
  const key = `register|${req.ip}`;
  if (throttled(key)) return bad(res, 'Too many attempts. Try again in 15 minutes.', 429);
  const display_name = str(req.body.display_name, 40);
  const username = str(req.body.username, 30).toLowerCase();
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const first = userCount() === 0;

  if (!first) {
    const code = str(req.body.inviteCode, 20).toUpperCase().replace(/\s/g, '');
    if (code !== getInviteCode()) {
      recordFail(key);
      return bad(res, 'That cell invite code is not right. Ask your system admin for it.');
    }
  }
  if (!display_name) return bad(res, 'Please enter your name');
  if (!USERNAME_RE.test(username)) return bad(res, USERNAME_MSG);
  if (password.length < 6) return bad(res, 'Password must be at least 6 characters');
  if (password === DEFAULT_PASSWORD) return bad(res, 'Please choose a password other than the default');
  if (userCount() >= 30) return bad(res, 'Member limit reached (30)');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return bad(res, 'That username is already taken');
  }
  const avatar = first ? '🕊️' : AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, avatar)
       VALUES (?, ?, ?, ?, 0, ?)`
    )
    .run(username, display_name, bcrypt.hashSync(password, 10), first ? 1 : 0, avatar);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  startSession(res, user.id);
  res.status(201).json({ user: publicUser(user), isLeader: first });
});

app.post('/api/logout', auth, (req, res) => {
  db.prepare('DELETE FROM sessions WHERE token = ?').run(req.token);
  setSessionCookie(res, '', 0);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => {
  res.json({ user: publicUser(req.user), avatars: AVATARS, categories: CATEGORIES });
});

app.post('/api/me/password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== 'string' || !bcrypt.compareSync(currentPassword, req.user.password_hash)) {
    return bad(res, 'Current password is incorrect');
  }
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    return bad(res, 'New password must be at least 6 characters');
  }
  if (newPassword === DEFAULT_PASSWORD) return bad(res, 'Please choose a password other than the default');
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(
    bcrypt.hashSync(newPassword, 10),
    req.user.id
  );
  // Sign out other devices.
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(req.user.id, req.token);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

app.patch('/api/me', auth, passwordChanged, (req, res) => {
  const display_name = str(req.body.display_name, 40) || req.user.display_name;
  const avatar = AVATARS.includes(req.body.avatar) ? req.body.avatar : req.user.avatar;
  db.prepare('UPDATE users SET display_name = ?, avatar = ? WHERE id = ?').run(display_name, avatar, req.user.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: publicUser(user) });
});

// Everything below requires a logged-in member with a non-default password.
app.use('/api', auth, passwordChanged);

// ---------- members ----------
app.get('/api/members', (req, res) => {
  const members = db
    .prepare(
      `SELECT id, username, display_name, avatar, is_admin, must_change_password, created_at
       FROM users ORDER BY is_admin DESC, display_name COLLATE NOCASE`
    )
    .all()
    .map((m) => ({ ...m, is_admin: !!m.is_admin, must_change_password: !!m.must_change_password }));
  res.json({ members });
});

app.post('/api/members', adminOnly, (req, res) => {
  const username = str(req.body.username, 30).toLowerCase();
  const display_name = str(req.body.display_name, 40);
  if (!USERNAME_RE.test(username)) return bad(res, USERNAME_MSG);
  if (!display_name) return bad(res, 'Please enter the member’s name');
  const total = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (total >= 30) return bad(res, 'Member limit reached (30)');
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) {
    return bad(res, 'That username is already taken');
  }
  const avatar = AVATARS[Math.floor(Math.random() * AVATARS.length)];
  const info = db
    .prepare(
      `INSERT INTO users (username, display_name, password_hash, is_admin, must_change_password, avatar)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(username, display_name, bcrypt.hashSync(DEFAULT_PASSWORD, 10), req.body.is_admin ? 1 : 0, avatar);
  res.status(201).json({ id: Number(info.lastInsertRowid), defaultPassword: DEFAULT_PASSWORD });
});

app.get('/api/invite', adminOnly, (req, res) => res.json({ code: getInviteCode() }));
app.post('/api/invite/regenerate', adminOnly, (req, res) => res.json({ code: regenerateInviteCode() }));

// Promote / demote another member to System Admin.
app.post('/api/members/:id/leader', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 'You cannot change your own admin role');
  const info = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(req.body.is_admin ? 1 : 0, id);
  if (!info.changes) return bad(res, 'Member not found', 404);
  res.json({ ok: true });
});

app.post('/api/members/:id/reset-password', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  const info = db
    .prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?')
    .run(bcrypt.hashSync(DEFAULT_PASSWORD, 10), id);
  if (!info.changes) return bad(res, 'Member not found', 404);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
  res.json({ ok: true, defaultPassword: DEFAULT_PASSWORD });
});

app.delete('/api/members/:id', adminOnly, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return bad(res, 'You cannot remove yourself');
  const info = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  if (!info.changes) return bad(res, 'Member not found', 404);
  res.json({ ok: true });
});

// ---------- prayer requests ----------
const REQUEST_SELECT = `
  SELECT r.*, u.display_name AS author_name, u.avatar AS author_avatar,
    (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id) AS prayer_count,
    (SELECT COUNT(*) FROM prayers p WHERE p.request_id = r.id AND p.user_id = @me) AS my_prayers
  FROM requests r JOIN users u ON u.id = r.user_id`;

function shapeRequest(r, me) {
  return { ...r, is_mine: r.user_id === me, prayed_by_me: r.my_prayers > 0 };
}

function loadRequest(id, me) {
  const r = db.prepare(`${REQUEST_SELECT} WHERE r.id = @id`).get({ id, me });
  return r ? shapeRequest(r, me) : null;
}

app.get('/api/requests', (req, res) => {
  const me = req.user.id;
  const filter = req.query.filter;
  let where = '';
  if (filter === 'active') where = `WHERE r.status = 'active'`;
  else if (filter === 'answered') where = `WHERE r.status = 'answered'`;
  else if (filter === 'mine') where = `WHERE r.user_id = @me`;
  const rows = db
    .prepare(`${REQUEST_SELECT} ${where} ORDER BY (r.status = 'answered'), r.created_at DESC`)
    .all({ me });
  res.json({ requests: rows.map((r) => shapeRequest(r, me)) });
});

app.get('/api/requests/:id', (req, res) => {
  const r = loadRequest(Number(req.params.id), req.user.id);
  if (!r) return bad(res, 'Prayer request not found', 404);
  const prayers = db
    .prepare(
      `SELECT p.*, u.display_name AS author_name, u.avatar AS author_avatar
       FROM prayers p JOIN users u ON u.id = p.user_id
       WHERE p.request_id = ? ORDER BY p.created_at ASC`
    )
    .all(r.id)
    .map((p) => ({ ...p, is_mine: p.user_id === req.user.id }));
  res.json({ request: r, prayers });
});

function validateRequest(body) {
  const title = str(body.title, 100);
  const text = str(body.body, 2000);
  const category = CATEGORIES.includes(body.category) ? body.category : 'General';
  if (!title) return { error: 'Please give your request a short title' };
  if (!text) return { error: 'Please describe your prayer request' };
  return { title, text, category };
}

app.post('/api/requests', (req, res) => {
  const v = validateRequest(req.body);
  if (v.error) return bad(res, v.error);
  const info = db
    .prepare('INSERT INTO requests (user_id, title, body, category) VALUES (?, ?, ?, ?)')
    .run(req.user.id, v.title, v.text, v.category);
  res.status(201).json({ request: loadRequest(Number(info.lastInsertRowid), req.user.id) });
});

// Owner-only guard for edit / delete / mark answered.
function ownRequest(req, res, next) {
  const r = db.prepare('SELECT * FROM requests WHERE id = ?').get(Number(req.params.id));
  if (!r) return bad(res, 'Prayer request not found', 404);
  if (r.user_id !== req.user.id) return bad(res, 'Only the person who posted this request can change it', 403);
  req.request = r;
  next();
}

app.put('/api/requests/:id', ownRequest, (req, res) => {
  const v = validateRequest(req.body);
  if (v.error) return bad(res, v.error);
  db.prepare(
    `UPDATE requests SET title = ?, body = ?, category = ?, updated_at = datetime('now') WHERE id = ?`
  ).run(v.title, v.text, v.category, req.request.id);
  res.json({ request: loadRequest(req.request.id, req.user.id) });
});

app.delete('/api/requests/:id', ownRequest, (req, res) => {
  db.prepare('DELETE FROM requests WHERE id = ?').run(req.request.id);
  res.json({ ok: true });
});

app.post('/api/requests/:id/answer', ownRequest, (req, res) => {
  const answered = req.body.answered !== false;
  if (answered) {
    db.prepare(
      `UPDATE requests SET status = 'answered', answer_note = ?, answered_at = datetime('now') WHERE id = ?`
    ).run(str(req.body.note, 1000) || null, req.request.id);
  } else {
    db.prepare(
      `UPDATE requests SET status = 'active', answer_note = NULL, answered_at = NULL WHERE id = ?`
    ).run(req.request.id);
  }
  res.json({ request: loadRequest(req.request.id, req.user.id) });
});

// ---------- prayers on a request ----------
app.post('/api/requests/:id/prayers', (req, res) => {
  const r = db.prepare('SELECT id FROM requests WHERE id = ?').get(Number(req.params.id));
  if (!r) return bad(res, 'Prayer request not found', 404);
  const body = str(req.body.body, 2000);
  if (!body) return bad(res, 'Please write your prayer');
  const info = db
    .prepare('INSERT INTO prayers (request_id, user_id, body) VALUES (?, ?, ?)')
    .run(r.id, req.user.id, body);
  res.status(201).json({ id: Number(info.lastInsertRowid) });
});

app.delete('/api/prayers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM prayers WHERE id = ?').get(Number(req.params.id));
  if (!p) return bad(res, 'Prayer not found', 404);
  if (p.user_id !== req.user.id) return bad(res, 'You can only remove your own prayers', 403);
  db.prepare('DELETE FROM prayers WHERE id = ?').run(p.id);
  res.json({ ok: true });
});

// ---------- dashboard stats (the "Duolingo-style" bits) ----------
function streakFor(userId) {
  const days = db
    .prepare(
      `SELECT DISTINCT date(created_at, 'localtime') AS d FROM prayers
       WHERE user_id = ? ORDER BY d DESC LIMIT 400`
    )
    .all(userId)
    .map((r) => r.d);
  if (!days.length) return { streak: 0, prayedToday: false };
  const fmt = (dt) => dt.toLocaleDateString('en-CA'); // YYYY-MM-DD in server local time
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400000);
  const prayedToday = days[0] === fmt(today);
  if (!prayedToday && days[0] !== fmt(yesterday)) return { streak: 0, prayedToday: false };
  let streak = 0;
  const cursor = new Date(days[0] + 'T12:00:00');
  for (const d of days) {
    if (d !== fmt(cursor)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return { streak, prayedToday };
}

app.get('/api/stats', (req, res) => {
  const me = req.user.id;
  const one = (sql, ...a) => db.prepare(sql).get(...a).n;
  const { streak, prayedToday } = streakFor(me);
  const leaderboard = db
    .prepare(
      `SELECT u.id, u.display_name, u.avatar, COUNT(p.id) AS n
       FROM users u LEFT JOIN prayers p ON p.user_id = u.id
         AND p.created_at >= datetime('now', '-7 days')
       GROUP BY u.id ORDER BY n DESC, u.display_name COLLATE NOCASE LIMIT 12`
    )
    .all();
  // Requests nobody (other than the owner) has prayed for yet.
  const needsPrayer = one(
    `SELECT COUNT(*) AS n FROM requests r WHERE r.status = 'active' AND NOT EXISTS
     (SELECT 1 FROM prayers p WHERE p.request_id = r.id AND p.user_id != r.user_id)`
  );
  const prayedThisWeek = one(
    `SELECT COUNT(*) AS n FROM prayers WHERE user_id = ? AND created_at >= datetime('now', '-7 days')`,
    me
  );
  res.json({
    streak,
    prayedToday,
    myPrayers: one('SELECT COUNT(*) AS n FROM prayers WHERE user_id = ?', me),
    prayedThisWeek,
    weeklyGoal: 7,
    active: one(`SELECT COUNT(*) AS n FROM requests WHERE status = 'active'`),
    answered: one(`SELECT COUNT(*) AS n FROM requests WHERE status = 'answered'`),
    needsPrayer,
    leaderboard,
  });
});

app.use('/api', (req, res) => bad(res, 'Not found', 404));

// SPA fallback
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`Prayer Wall running at http://localhost:${PORT}`));
