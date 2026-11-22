import worker from '../src/index.js';
import { createD1 } from './d1-fake.js';

export const ORIGIN = 'https://app.example';

// A fresh Worker environment with an empty database.
export function setup() {
  const DB = createD1();
  const env = { DB, ALLOWED_ORIGINS: `${ORIGIN}, http://localhost:8080` };

  async function api(method, path, { token, body, origin, rawBody } = {}) {
    const headers = {};
    if (body !== undefined || rawBody !== undefined) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = 'Bearer ' + token;
    if (origin) headers.Origin = origin;
    const res = await worker.fetch(
      new Request('https://api.example' + path, {
        method,
        headers,
        body: rawBody !== undefined ? rawBody : body !== undefined ? JSON.stringify(body) : undefined,
      }),
      env
    );
    const text = await res.text();
    return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null };
  }

  // Registers the first account (becomes System Admin).
  async function admin(username = 'admin', password = 'admin123') {
    const r = await api('POST', '/api/register', { body: { display_name: 'Admin', username, password } });
    return { token: r.body.token, user: r.body.user };
  }

  // Registers a regular member via the invite code.
  async function member(adminToken, username, password = username + '123') {
    const { body } = await api('GET', '/api/invite', { token: adminToken });
    const r = await api('POST', '/api/register', {
      body: { display_name: username[0].toUpperCase() + username.slice(1), username, password, inviteCode: body.code },
    });
    return { token: r.body.token, user: r.body.user };
  }

  async function login(username, password) {
    return api('POST', '/api/login', { body: { username, password } });
  }

  async function request(token, fields = {}) {
    const r = await api('POST', '/api/requests', {
      token,
      body: { title: 'Pray for me', body: 'Details', category: 'Health', ...fields },
    });
    return r.body.request;
  }

  return { env, DB, api, admin, member, login, request };
}
