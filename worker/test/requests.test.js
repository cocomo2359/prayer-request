import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './helpers.js';

async function cell() {
  const s = setup();
  const a = await s.admin();
  const m = await s.member(a.token, 'mary');
  const p = await s.member(a.token, 'peter');
  return { ...s, a, m, p };
}

describe('creating requests', () => {
  test('creates a request with author details', async () => {
    const { api, m } = await cell();
    const r = await api('POST', '/api/requests', { token: m.token, body: { title: ' Job ', body: ' Interview Friday ', category: 'Work' } });
    assert.equal(r.status, 200);
    const q = r.body.request;
    assert.equal(q.title, 'Job');
    assert.equal(q.body, 'Interview Friday');
    assert.equal(q.category, 'Work');
    assert.equal(q.status, 'active');
    assert.equal(q.author_name, 'Mary');
    assert.equal(q.is_mine, true);
    assert.equal(q.prayed_by_me, false);
    assert.equal(q.prayer_count, 0);
    assert.equal(q.my_prayers, undefined);
  });

  test('unknown categories fall back to General; title and body are required', async () => {
    const { api, m } = await cell();
    const r = await api('POST', '/api/requests', { token: m.token, body: { title: 'T', body: 'B', category: 'Gossip' } });
    assert.equal(r.body.request.category, 'General');
    assert.match((await api('POST', '/api/requests', { token: m.token, body: { title: ' ', body: 'B' } })).body.error, /short title/);
    assert.match((await api('POST', '/api/requests', { token: m.token, body: { title: 'T', body: '' } })).body.error, /describe your prayer/);
  });

  test('long titles and bodies are trimmed to their limits', async () => {
    const { api, m } = await cell();
    const r = await api('POST', '/api/requests', { token: m.token, body: { title: 'x'.repeat(150), body: 'y'.repeat(2500) } });
    assert.equal(r.body.request.title.length, 100);
    assert.equal(r.body.request.body.length, 2000);
  });
});

describe('listing and reading', () => {
  test('filters: all, active, answered, mine; answered requests listed last', async () => {
    const { api, request, m, p } = await cell();
    const mine = await request(m.token, { title: 'Mary 1' });
    const answered = await request(m.token, { title: 'Mary 2' });
    await request(p.token, { title: 'Peter 1' });
    await api('POST', `/api/requests/${answered.id}/answer`, { token: m.token, body: {} });
    const titles = async (filter) =>
      (await api('GET', '/api/requests' + (filter ? '?filter=' + filter : ''), { token: p.token })).body.requests.map((r) => r.title);
    const all = await titles();
    assert.equal(all.length, 3);
    assert.equal(all[2], 'Mary 2');
    assert.deepEqual((await titles('active')).sort(), ['Mary 1', 'Peter 1']);
    assert.deepEqual(await titles('answered'), ['Mary 2']);
    assert.deepEqual(await titles('mine'), ['Peter 1']);
    assert.ok(mine.id);
  });

  test('a single request includes its prayers; missing requests are 404', async () => {
    const { api, request, m, p } = await cell();
    const q = await request(m.token);
    await api('POST', `/api/requests/${q.id}/prayers`, { token: p.token, body: { body: 'Amen' } });
    const r = await api('GET', `/api/requests/${q.id}`, { token: p.token });
    assert.equal(r.body.request.prayer_count, 1);
    assert.equal(r.body.request.prayed_by_me, true);
    assert.equal(r.body.request.is_mine, false);
    assert.equal(r.body.prayers[0].author_name, 'Peter');
    assert.equal(r.body.prayers[0].is_mine, true);
    assert.equal((await api('GET', `/api/requests/${q.id}`, { token: m.token })).body.prayers[0].is_mine, false);
    assert.equal((await api('GET', '/api/requests/999', { token: m.token })).status, 404);
  });
});

describe('owner-only changes', () => {
  test('only the owner can edit; edits are validated and bump updated_at', async () => {
    const { api, request, m, p, a, DB } = await cell();
    const q = await request(m.token);
    DB.raw.prepare(`UPDATE requests SET created_at = '2020-01-01 00:00:00', updated_at = '2020-01-01 00:00:00'`).run();
    for (const t of [p.token, a.token]) {
      const r = await api('PUT', `/api/requests/${q.id}`, { token: t, body: { title: 'Hacked', body: 'x' } });
      assert.equal(r.status, 403);
    }
    assert.match((await api('PUT', `/api/requests/${q.id}`, { token: m.token, body: { title: '', body: 'x' } })).body.error, /short title/);
    const r = await api('PUT', `/api/requests/${q.id}`, { token: m.token, body: { title: 'Updated', body: 'New', category: 'Family' } });
    assert.equal(r.body.request.title, 'Updated');
    assert.equal(r.body.request.category, 'Family');
    assert.notEqual(r.body.request.updated_at, '2020-01-01 00:00:00');
    assert.equal((await api('PUT', '/api/requests/999', { token: m.token, body: { title: 'a', body: 'b' } })).status, 404);
  });

  test('only the owner can delete; deleting removes its prayers', async () => {
    const { api, request, m, p, a, DB } = await cell();
    const q = await request(m.token);
    await api('POST', `/api/requests/${q.id}/prayers`, { token: p.token, body: { body: 'Amen' } });
    assert.equal((await api('DELETE', `/api/requests/${q.id}`, { token: a.token })).status, 403);
    assert.deepEqual((await api('DELETE', `/api/requests/${q.id}`, { token: m.token })).body, { ok: true });
    assert.equal((await api('GET', `/api/requests/${q.id}`, { token: m.token })).status, 404);
    assert.equal(DB.raw.prepare('SELECT COUNT(*) AS n FROM prayers').get().n, 0);
  });

  test('only the owner can mark answered (with optional note) and reopen', async () => {
    const { api, request, m, p } = await cell();
    const q = await request(m.token);
    assert.equal((await api('POST', `/api/requests/${q.id}/answer`, { token: p.token, body: {} })).status, 403);
    let r = await api('POST', `/api/requests/${q.id}/answer`, { token: m.token, body: { note: ' Got the job! ' } });
    assert.equal(r.body.request.status, 'answered');
    assert.equal(r.body.request.answer_note, 'Got the job!');
    assert.ok(r.body.request.answered_at);
    r = await api('POST', `/api/requests/${q.id}/answer`, { token: m.token, body: { answered: false } });
    assert.equal(r.body.request.status, 'active');
    assert.equal(r.body.request.answer_note, null);
    assert.equal(r.body.request.answered_at, null);
    r = await api('POST', `/api/requests/${q.id}/answer`, { token: m.token, body: { note: '   ' } });
    assert.equal(r.body.request.answer_note, null);
  });
});

describe('prayers', () => {
  test('anyone can pray; empty prayers and missing requests are rejected', async () => {
    const { api, request, m, p } = await cell();
    const q = await request(m.token);
    const r = await api('POST', `/api/requests/${q.id}/prayers`, { token: p.token, body: { body: ' Lord, give peace ' } });
    assert.ok(r.body.id > 0);
    assert.match((await api('POST', `/api/requests/${q.id}/prayers`, { token: p.token, body: { body: '  ' } })).body.error, /write your prayer/);
    assert.equal((await api('POST', '/api/requests/999/prayers', { token: p.token, body: { body: 'x' } })).status, 404);
    const got = await api('GET', `/api/requests/${q.id}`, { token: m.token });
    assert.equal(got.body.prayers[0].body, 'Lord, give peace');
  });

  test('only the author can remove a prayer', async () => {
    const { api, request, m, p } = await cell();
    const q = await request(m.token);
    const id = (await api('POST', `/api/requests/${q.id}/prayers`, { token: p.token, body: { body: 'Amen' } })).body.id;
    assert.equal((await api('DELETE', `/api/prayers/${id}`, { token: m.token })).status, 403);
    assert.deepEqual((await api('DELETE', `/api/prayers/${id}`, { token: p.token })).body, { ok: true });
    assert.equal((await api('DELETE', `/api/prayers/${id}`, { token: p.token })).status, 404);
  });
});
