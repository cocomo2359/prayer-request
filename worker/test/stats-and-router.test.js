import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { setup, ORIGIN } from './helpers.js';

// Backdate a member's prayers: each entry is "days ago" for one prayer.
function addPrayers(DB, userId, requestId, daysAgo) {
  const ins = DB.raw.prepare(`INSERT INTO prayers (request_id, user_id, body, created_at) VALUES (?, ?, 'p', datetime('now', ?))`);
  for (const d of daysAgo) ins.run(requestId, userId, `-${d} days`);
}

describe('dashboard stats', () => {
  test('counts, needs-prayer and leaderboard', async () => {
    const { api, admin, member, request } = setup();
    const a = await admin();
    const m = await member(a.token, 'mary');
    const q1 = await request(m.token);
    const q2 = await request(m.token);
    await request(a.token);
    await api('POST', `/api/requests/${q1.id}/prayers`, { token: a.token, body: { body: 'x' } });
    await api('POST', `/api/requests/${q2.id}/prayers`, { token: m.token, body: { body: 'own prayer does not count' } });
    const done = await request(m.token);
    await api('POST', `/api/requests/${done.id}/answer`, { token: m.token, body: {} });
    const s = (await api('GET', '/api/stats', { token: a.token })).body;
    assert.equal(s.active, 3);
    assert.equal(s.answered, 1);
    assert.equal(s.needsPrayer, 2); // q2 (only its owner prayed) and the admin's own request
    assert.equal(s.myPrayers, 1);
    assert.equal(s.prayedThisWeek, 1);
    assert.equal(s.weeklyGoal, 7);
    assert.deepEqual(s.leaderboard.map((l) => [l.display_name, l.n]), [['Admin', 1], ['Mary', 1]]);
  });

  test('streak counts consecutive days up to today', async () => {
    const { api, admin, request, DB } = setup();
    const a = await admin();
    const q = await request(a.token);
    addPrayers(DB, a.user.id, q.id, [0, 1, 1, 2, 4]); // gap on day 3
    const s = (await api('GET', '/api/stats?tz=UTC', { token: a.token })).body;
    assert.equal(s.streak, 3);
    assert.equal(s.prayedToday, true);
  });

  test('a streak ending yesterday is still alive; older ones are broken', async () => {
    const { api, admin, request, DB } = setup();
    const a = await admin();
    const q = await request(a.token);
    addPrayers(DB, a.user.id, q.id, [1, 2]);
    let s = (await api('GET', '/api/stats?tz=UTC', { token: a.token })).body;
    assert.deepEqual([s.streak, s.prayedToday], [2, false]);
    DB.raw.prepare('DELETE FROM prayers').run();
    addPrayers(DB, a.user.id, q.id, [2, 3]);
    s = (await api('GET', '/api/stats?tz=UTC', { token: a.token })).body;
    assert.deepEqual([s.streak, s.prayedToday], [0, false]);
  });

  test('no prayers means no streak; an invalid time zone falls back to UTC', async () => {
    const { api, admin } = setup();
    const a = await admin();
    const s = (await api('GET', '/api/stats?tz=Not/AZone', { token: a.token })).body;
    assert.deepEqual([s.streak, s.prayedToday, s.myPrayers], [0, false, 0]);
  });

  test('prayers older than 7 days are not in this week’s numbers', async () => {
    const { api, admin, request, DB } = setup();
    const a = await admin();
    const q = await request(a.token);
    addPrayers(DB, a.user.id, q.id, [10]);
    const s = (await api('GET', '/api/stats', { token: a.token })).body;
    assert.equal(s.prayedThisWeek, 0);
    assert.equal(s.leaderboard[0].n, 0);
    assert.equal(s.myPrayers, 1);
  });
});

describe('router, CORS and errors', () => {
  test('preflight: allowed origins get CORS headers, others do not', async () => {
    const { api } = setup();
    const ok = await api('OPTIONS', '/api/login', { origin: ORIGIN });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers.get('Access-Control-Allow-Origin'), ORIGIN);
    assert.match(ok.headers.get('Access-Control-Allow-Headers'), /Authorization/);
    const local = await api('OPTIONS', '/api/login', { origin: 'http://localhost:8080' });
    assert.equal(local.headers.get('Access-Control-Allow-Origin'), 'http://localhost:8080');
    const evil = await api('OPTIONS', '/api/login', { origin: 'https://evil.example' });
    assert.equal(evil.headers.get('Access-Control-Allow-Origin'), null);
  });

  test('error responses also carry CORS headers', async () => {
    const { api } = setup();
    const r = await api('GET', '/api/me', { origin: ORIGIN });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  });

  test('unknown paths, wrong methods and non-numeric ids are 404', async () => {
    const { api, admin } = setup();
    const a = await admin();
    assert.equal((await api('GET', '/api/nope')).status, 404);
    assert.equal((await api('PUT', '/api/members', { token: a.token, body: {} })).status, 404);
    assert.equal((await api('GET', '/api/requests/abc', { token: a.token })).status, 404);
    assert.deepEqual((await api('GET', '/api')).body, { ok: true, app: 'Prayer Wall API' });
  });

  test('a malformed or non-object JSON body is treated as empty', async () => {
    const { api, admin } = setup();
    const a = await admin();
    for (const rawBody of ['{not json', 'null', '"text"', '[1,2]']) {
      const r = await api('POST', '/api/requests', { token: a.token, rawBody });
      assert.equal(r.status, 400, rawBody);
      assert.match(r.body.error, /short title/);
    }
  });

  test('unexpected server errors return a generic 500', async () => {
    const { api, admin, DB } = setup();
    const a = await admin();
    const errorLog = mock.method(console, 'error', () => {});
    DB.raw.exec('DROP TABLE prayers');
    const r = await api('GET', '/api/stats', { token: a.token });
    errorLog.mock.restore();
    assert.equal(r.status, 500);
    assert.equal(r.body.error, 'Something went wrong on the server');
    assert.equal(errorLog.mock.callCount(), 1);
  });
});
