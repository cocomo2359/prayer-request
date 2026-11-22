import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

describe('setup-status and register', () => {
  test('fresh install needs its first admin; first sign-up becomes System Admin', async () => {
    const { api } = setup();
    assert.deepEqual((await api('GET', '/api/setup-status')).body, { needsLeader: true });
    const r = await api('POST', '/api/register', { body: { display_name: ' Pastor ', username: 'Pastor', password: 'secret1' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.isLeader, true);
    assert.equal(r.body.user.is_admin, true);
    assert.equal(r.body.user.must_change_password, false);
    assert.equal(r.body.user.username, 'pastor');
    assert.equal(r.body.user.display_name, 'Pastor');
    assert.equal(r.body.user.avatar, '🕊️');
    assert.match(r.body.token, /^[0-9a-f]{64}$/);
    assert.equal(r.body.user.password_hash, undefined);
    assert.deepEqual((await api('GET', '/api/setup-status')).body, { needsLeader: false });
  });

  test('later sign-ups need the invite code (case and spaces ignored) and are not admins', async () => {
    const { api, admin } = setup();
    const a = await admin();
    const missing = await api('POST', '/api/register', { body: { display_name: 'Eve', username: 'eve', password: 'secret1' } });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /invite code/);
    const { code } = (await api('GET', '/api/invite', { token: a.token })).body;
    const spaced = code.slice(0, 3).toLowerCase() + ' ' + code.slice(3).toLowerCase();
    const ok = await api('POST', '/api/register', { body: { display_name: 'Eve', username: 'eve', password: 'secret1', inviteCode: spaced } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.isLeader, false);
    assert.equal(ok.body.user.is_admin, false);
  });

  test('validates name, username, password and duplicates', async () => {
    const { api, admin } = setup();
    const a = await admin();
    const { code } = (await api('GET', '/api/invite', { token: a.token })).body;
    const reg = (body) => api('POST', '/api/register', { body: { inviteCode: code, ...body } });
    const cases = [
      [{ display_name: '  ', username: 'bob', password: 'secret1' }, /enter your name/],
      [{ display_name: 'Bob', username: 'b', password: 'secret1' }, /Username must be/],
      [{ display_name: 'Bob', username: 'bob smith', password: 'secret1' }, /Username must be/],
      [{ display_name: 'Bob', username: 'bob', password: '12345' }, /at least 6/],
      [{ display_name: 'Bob', username: 'bob', password: 'p@ssw0rd' }, /too easy to guess/],
      [{ display_name: 'Bob', username: 'ADMIN', password: 'secret1' }, /already taken/],
      [{ display_name: 'Bob', username: 'b'.repeat(31), password: 'secret1' }, /Username must be/],
    ];
    for (const [body, msg] of cases) {
      const r = await reg(body);
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.match(r.body.error, msg);
    }
  });

  test('a too-long username is rejected, not truncated into a different account', async () => {
    const { api, admin, DB } = setup();
    const a = await admin();
    const { code } = (await api('GET', '/api/invite', { token: a.token })).body;
    const r = await api('POST', '/api/register', { body: { display_name: 'Long', username: 'a'.repeat(35), password: 'secret1', inviteCode: code } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /3–30 characters/);
    assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM users').get().n, 1);
  });

  test('wrong invite codes are throttled after 20 tries', async () => {
    const { api, admin } = setup();
    await admin();
    for (let i = 0; i < 20; i++) {
      await api('POST', '/api/register', { body: { display_name: 'X', username: 'xx' + i, password: 'secret1', inviteCode: 'NOPE' } });
    }
    const r = await api('POST', '/api/register', { body: { display_name: 'X', username: 'xyz', password: 'secret1', inviteCode: 'NOPE' } });
    assert.equal(r.status, 429);
  });

  test('stops at the 30-member limit', async () => {
    const { api, admin, DB } = setup();
    const a = await admin();
    const ins = DB.raw.prepare(`INSERT INTO users (username, display_name, password_hash) VALUES (?, 'U', 'x')`);
    for (let i = 0; i < 29; i++) ins.run('user' + i);
    const { code } = (await api('GET', '/api/invite', { token: a.token })).body;
    const r = await api('POST', '/api/register', { body: { display_name: 'Late', username: 'late', password: 'secret1', inviteCode: code } });
    assert.equal(r.status, 400);
    assert.match(r.body.error, /limit reached/);
  });
});

describe('login and logout', () => {
  test('logs in case-insensitively and rejects wrong passwords', async () => {
    const { admin, login } = setup();
    await admin('admin', 'admin123');
    const ok = await login('  ADMIN ', 'admin123');
    assert.equal(ok.status, 200);
    assert.equal(ok.body.user.username, 'admin');
    assert.match(ok.body.token, /^[0-9a-f]{64}$/);
    const bad = await login('admin', 'nope');
    assert.equal(bad.status, 401);
    assert.equal(bad.body.error, 'Wrong username or password');
    const unknown = await login('ghost', 'whatever');
    assert.equal(unknown.status, 401);
    const nonString = await login(42, { x: 1 });
    assert.equal(nonString.status, 401);
  });

  test('locks a username for 15 minutes after 10 failures, success resets the count', async () => {
    const { admin, login, DB } = setup();
    await admin('admin', 'admin123');
    for (let i = 0; i < 9; i++) await login('admin', 'bad');
    assert.equal((await login('admin', 'admin123')).status, 200); // 9 failures: still allowed, and resets
    for (let i = 0; i < 10; i++) await login('admin', 'bad');
    const locked = await login('admin', 'admin123');
    assert.equal(locked.status, 429);
    // After the window passes, the lock lifts.
    DB.raw.prepare(`UPDATE attempts SET first_at = first_at - 16 * 60 * 1000`).run();
    assert.equal((await login('admin', 'admin123')).status, 200);
  });

  test('a failure after the window starts a fresh count', async () => {
    const { admin, login, DB } = setup();
    await admin('admin', 'admin123');
    for (let i = 0; i < 10; i++) await login('admin', 'bad');
    DB.raw.prepare(`UPDATE attempts SET first_at = first_at - 16 * 60 * 1000`).run();
    await login('admin', 'bad');
    assert.equal(DB.raw.prepare(`SELECT n FROM attempts WHERE key = 'login:admin'`).get().n, 1);
  });

  test('logout ends only that session', async () => {
    const { api, admin, login } = setup();
    const a = await admin('admin', 'admin123');
    const second = (await login('admin', 'admin123')).body.token;
    assert.deepEqual((await api('POST', '/api/logout', { token: a.token })).body, { ok: true });
    assert.equal((await api('GET', '/api/me', { token: a.token })).status, 401);
    assert.equal((await api('GET', '/api/me', { token: second })).status, 200);
  });
});

describe('sessions and /api/me', () => {
  test('missing, unknown and expired tokens are rejected', async () => {
    const { api, admin, DB } = setup();
    const a = await admin();
    assert.equal((await api('GET', '/api/me')).status, 401);
    assert.equal((await api('GET', '/api/me', { token: 'deadbeef' })).status, 401);
    DB.raw.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() - 1);
    const r = await api('GET', '/api/me', { token: a.token });
    assert.equal(r.status, 401);
    assert.match(r.body.error, /expired/);
  });

  test('a non-Bearer Authorization header is treated as logged out', async () => {
    const { env, admin } = setup();
    const a = await admin();
    const worker = (await import('../src/index.js')).default;
    const res = await worker.fetch(new Request('https://api.example/api/me', { headers: { Authorization: 'Token ' + a.token } }), env);
    assert.equal(res.status, 401);
  });

  test('profile update keeps valid avatars and names only', async () => {
    const { api, admin } = setup();
    const a = await admin();
    let r = await api('PATCH', '/api/me', { token: a.token, body: { display_name: ' Pastor Dan ', avatar: '🦁' } });
    assert.equal(r.body.user.display_name, 'Pastor Dan');
    assert.equal(r.body.user.avatar, '🦁');
    r = await api('PATCH', '/api/me', { token: a.token, body: { display_name: '   ', avatar: '💩' } });
    assert.equal(r.body.user.display_name, 'Pastor Dan');
    assert.equal(r.body.user.avatar, '🦁');
  });
});

describe('change password', () => {
  test('checks the current password and the new password rules', async () => {
    const { api, admin } = setup();
    const a = await admin('admin', 'admin123');
    const change = (currentPassword, newPassword) => api('POST', '/api/me/password', { token: a.token, body: { currentPassword, newPassword } });
    assert.match((await change('wrong', 'newpass1')).body.error, /Current password is incorrect/);
    assert.match((await change('admin123', '123')).body.error, /at least 6/);
    assert.match((await change('admin123', 42)).body.error, /at least 6/);
    assert.match((await change('admin123', 'p@ssw0rd')).body.error, /too easy to guess/);
  });

  test('changing the password signs out other devices and allows the new one', async () => {
    const { api, admin, login } = setup();
    const a = await admin('admin', 'admin123');
    const other = (await login('admin', 'admin123')).body.token;
    const r = await api('POST', '/api/me/password', { token: a.token, body: { currentPassword: 'admin123', newPassword: 'newpass1' } });
    assert.equal(r.status, 200);
    assert.equal((await api('GET', '/api/me', { token: a.token })).status, 200);
    assert.equal((await api('GET', '/api/me', { token: other })).status, 401);
    assert.equal((await login('admin', 'admin123')).status, 401);
    assert.equal((await login('admin', 'newpass1')).status, 200);
  });

  test('members on a temporary password must change it before using the app', async () => {
    const { api, admin, member, login } = setup();
    const a = await admin();
    const grace = await member(a.token, 'grace');
    const { tempPassword } = (await api('POST', `/api/members/${grace.user.id}/reset-password`, { token: a.token })).body;
    const g = await login('grace', tempPassword);
    assert.equal(g.body.user.must_change_password, true);
    const t = g.body.token;
    assert.equal((await api('GET', '/api/me', { token: t })).status, 200); // allowed
    for (const [m, p] of [['GET', '/api/requests'], ['GET', '/api/members'], ['GET', '/api/stats'], ['PATCH', '/api/me']]) {
      const r = await api(m, p, { token: t, body: m === 'PATCH' ? {} : undefined });
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.equal(r.body.error, 'Please change your password first');
    }
    const r = await api('POST', '/api/me/password', { token: t, body: { currentPassword: tempPassword, newPassword: 'grace456' } });
    assert.equal(r.body.user.must_change_password, false);
    assert.equal((await api('GET', '/api/requests', { token: t })).status, 200);
  });
});
