import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestEnv } from './test-env.mjs';
setupTestEnv();
const { db } = await import('../server/db.mjs');
const { handleRequest } = await import('../server/routes.mjs');
const server = http.createServer(handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

function cookieOf(response) {
  return response.headers.getSetCookie?.()?.find(item => item.startsWith('offerbiu_session='))?.split(';')[0]
    || (response.headers.get('set-cookie') || '').split(',').find(item => item.trim().startsWith('offerbiu_session='))?.split(';')[0];
}
async function send(path, { method = 'GET', cookie = '', token = '', body } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': token } : {}) },
    ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}),
  });
  return { status: response.status, body: await response.json(), cookie: cookieOf(response) || cookie };
}

test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('changing a password rejects the old password and signs out other sessions', async () => {
  const registered = await send('/api/auth/register', { method: 'POST', body: { email: 'owner@example.test', name: '本人', password: 'correct-horse' } });
  assert.equal(registered.status, 201);
  const other = await send('/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'correct-horse' } });
  assert.equal(other.status, 200);
  const changed = await send('/api/auth/password', { method: 'POST', cookie: registered.cookie, token: registered.body.csrf, body: { currentPassword: 'wrong-password', newPassword: 'new-password-1' } });
  assert.equal(changed.status, 401);
  const still = await send('/api/candidate-profile', { cookie: other.cookie });
  assert.equal(still.status, 200);
  const ok = await send('/api/auth/password', { method: 'POST', cookie: registered.cookie, token: registered.body.csrf, body: { currentPassword: 'correct-horse', newPassword: 'new-password-1' } });
  assert.equal(ok.status, 200);
  assert.notEqual(ok.body.csrf, registered.body.csrf);
  assert.equal((await send('/api/candidate-profile', { cookie: other.cookie })).status, 401);
  assert.equal((await send('/api/candidate-profile', { cookie: ok.cookie })).status, 200);
  assert.equal((await send('/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'correct-horse' } })).status, 401);
  assert.equal((await send('/api/auth/login', { method: 'POST', body: { email: 'owner@example.test', password: 'new-password-1' } })).status, 200);
});

test('deleting an account removes only that account after an explicit confirmation', async () => {
  const alpha = await send('/api/auth/register', { method: 'POST', body: { email: 'alpha@example.test', name: '甲', password: 'alpha-password' } });
  const beta = await send('/api/auth/register', { method: 'POST', body: { email: 'beta@example.test', name: '乙', password: 'beta-password' } });
  assert.equal(alpha.status, 201);
  assert.equal(beta.status, 201);
  const betaTask = await send('/api/tasks', { method: 'POST', cookie: beta.cookie, token: beta.body.csrf, body: { title: '乙的待办', kind: '跟进' } });
  assert.equal(betaTask.status, 201);
  const rejected = await send('/api/auth/account', { method: 'DELETE', cookie: alpha.cookie, token: alpha.body.csrf, body: { email: 'beta@example.test', password: 'alpha-password', confirm: true } });
  assert.equal(rejected.status, 400);
  assert.equal((await send('/api/session', { cookie: alpha.cookie })).body.user.email, 'alpha@example.test');
  const deleted = await send('/api/auth/account', { method: 'DELETE', cookie: alpha.cookie, token: alpha.body.csrf, body: { email: 'alpha@example.test', password: 'alpha-password', confirm: true } });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal((await send('/api/session', { cookie: alpha.cookie })).body.user, null);
  const betaTasks = await send('/api/tasks', { cookie: beta.cookie });
  assert.equal(betaTasks.status, 200);
  assert.equal(betaTasks.body.some(task => task.title === '乙的待办'), true);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('alpha@example.test').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE email=?').get('beta@example.test').n, 1);
});
