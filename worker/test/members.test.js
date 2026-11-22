import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

describe('member list', () => {
  test('any member can see the list, admins first, without password hashes', async () => {
    const { api, admin, member } = setup();
    const a = await admin();
    const z = await member(a.token, 'zoe');
    await member(a.token, 'amy');
    const r = await api('GET', '/api/members', { token: z.token });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.members.map((m) => m.username), ['admin', 'amy', 'zoe']);
    assert.equal(r.body.members[0].is_admin, true);
    for (const m of r.body.members) assert.equal(m.password_hash, undefined);
  });
});

test('only admins can see who is still on the default password', async () => {
  const { api, admin, member } = setup();
  const a = await admin();
  await api('POST', '/api/members', { token: a.token, body: { username: 'newbie', display_name: 'Newbie' } });
  const m = await member(a.token, 'mary');
  const asMember = (await api('GET', '/api/members', { token: m.token })).body.members;
  for (const row of asMember) assert.equal('must_change_password' in row, false, row.username);
  const asAdmin = (await api('GET', '/api/members', { token: a.token })).body.members;
  assert.equal(asAdmin.find((x) => x.username === 'newbie').must_change_password, true);
  assert.equal(asAdmin.find((x) => x.username === 'mary').must_change_password, false);
});

describe('adding members (admin)', () => {
  test('admin adds a member who logs in with the default password', async () => {
    const { api, admin, login } = setup();
    const a = await admin();
    const r = await api('POST', '/api/members', { token: a.token, body: { username: ' Grace ', display_name: 'Grace Tan' } });
    assert.equal(r.status, 200);
    assert.equal(r.body.defaultPassword, 'p@ssw0rd');
    const g = await login('grace', 'p@ssw0rd');
    assert.equal(g.status, 200);
    assert.equal(g.body.user.must_change_password, true);
    assert.equal(g.body.user.is_admin, false);
  });

  test('admin can add another admin directly', async () => {
    const { api, admin, login } = setup();
    const a = await admin();
    await api('POST', '/api/members', { token: a.token, body: { username: 'coleader', display_name: 'Co Leader', is_admin: true } });
    assert.equal((await login('coleader', 'p@ssw0rd')).body.user.is_admin, true);
  });

  test('validates input and rejects non-admins', async () => {
    const { api, admin, member } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary');
    const add = (token, body) => api('POST', '/api/members', { token, body });
    assert.equal((await add(m.token, { username: 'zed', display_name: 'Zed' })).status, 403);
    assert.match((await add(a.token, { username: 'x', display_name: 'X' })).body.error, /Username must be/);
    assert.match((await add(a.token, { username: 'x'.repeat(35), display_name: 'Long' })).body.error, /Username must be/);
    assert.match((await add(a.token, { username: 'okname', display_name: '' })).body.error, /member’s name/);
    assert.match((await add(a.token, { username: 'MARY', display_name: 'Mary 2' })).body.error, /already taken/);
  });

  test('stops at the 30-member limit', async () => {
    const { api, admin, DB } = setup();
    const a = await admin();
    const ins = DB.raw.prepare(`INSERT INTO users (username, display_name, password_hash) VALUES (?, 'U', 'x')`);
    for (let i = 0; i < 29; i++) ins.run('user' + i);
    const r = await api('POST', '/api/members', { token: a.token, body: { username: 'late', display_name: 'Late' } });
    assert.match(r.body.error, /limit reached/);
  });
});

describe('reset password, admin role, remove', () => {
  test('reset puts the member back on the default password and logs them out', async () => {
    const { api, admin, member, login } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary', 'mary123');
    const r = await api('POST', `/api/members/${m.user.id}/reset-password`, { token: a.token });
    assert.deepEqual(r.body, { ok: true, defaultPassword: 'p@ssw0rd' });
    assert.equal((await api('GET', '/api/me', { token: m.token })).status, 401);
    assert.equal((await login('mary', 'mary123')).status, 401);
    assert.equal((await login('mary', 'p@ssw0rd')).body.user.must_change_password, true);
    assert.equal((await api('POST', '/api/members/999/reset-password', { token: a.token })).status, 404);
    assert.equal((await api('POST', `/api/members/${a.user.id}/reset-password`, { token: m.token })).status, 401);
  });

  test('make and remove admin; cannot change own role', async () => {
    const { api, admin, member } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary');
    assert.equal((await api('GET', '/api/invite', { token: m.token })).status, 403);
    assert.deepEqual((await api('POST', `/api/members/${m.user.id}/leader`, { token: a.token, body: { is_admin: true } })).body, { ok: true });
    assert.equal((await api('GET', '/api/invite', { token: m.token })).status, 200);
    await api('POST', `/api/members/${m.user.id}/leader`, { token: a.token, body: { is_admin: false } });
    assert.equal((await api('GET', '/api/invite', { token: m.token })).status, 403);
    const self = await api('POST', `/api/members/${a.user.id}/leader`, { token: a.token, body: { is_admin: false } });
    assert.match(self.body.error, /own admin role/);
    assert.equal((await api('POST', '/api/members/999/leader', { token: a.token, body: { is_admin: true } })).status, 404);
  });

  test('removing a member deletes their requests, prayers and sessions', async () => {
    const { api, admin, member, request, DB } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary');
    const theirs = await request(m.token, { title: 'Mary request' });
    const mine = await request(a.token, { title: 'Admin request' });
    await api('POST', `/api/requests/${theirs.id}/prayers`, { token: a.token, body: { body: 'Admin prays for Mary' } });
    await api('POST', `/api/requests/${mine.id}/prayers`, { token: m.token, body: { body: 'Mary prays for admin' } });
    const r = await api('DELETE', `/api/members/${m.user.id}`, { token: a.token });
    assert.deepEqual(r.body, { ok: true });
    assert.equal((await api('GET', `/api/requests/${theirs.id}`, { token: a.token })).status, 404);
    const still = await api('GET', `/api/requests/${mine.id}`, { token: a.token });
    assert.equal(still.body.prayers.length, 0);
    assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM prayers').get().n, 0);
    assert.equal((await api('GET', '/api/me', { token: m.token })).status, 401);
  });

  test('cannot remove yourself or a missing member; non-admins cannot remove', async () => {
    const { api, admin, member } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary');
    assert.match((await api('DELETE', `/api/members/${a.user.id}`, { token: a.token })).body.error, /yourself/);
    assert.equal((await api('DELETE', '/api/members/999', { token: a.token })).status, 404);
    assert.equal((await api('DELETE', `/api/members/${a.user.id}`, { token: m.token })).status, 403);
  });
});

describe('invite code', () => {
  test('is stable until regenerated; the old code stops working', async () => {
    const { api, admin } = setup();
    const a = await admin();
    const first = (await api('GET', '/api/invite', { token: a.token })).body.code;
    assert.match(first, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal((await api('GET', '/api/invite', { token: a.token })).body.code, first);
    const next = (await api('POST', '/api/invite/regenerate', { token: a.token })).body.code;
    assert.match(next, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.equal((await api('GET', '/api/invite', { token: a.token })).body.code, next);
    const old = await api('POST', '/api/register', { body: { display_name: 'Late', username: 'late', password: 'secret1', inviteCode: first === next ? 'XXXXXX' : first } });
    assert.match(old.body.error, /invite code/);
  });
});
