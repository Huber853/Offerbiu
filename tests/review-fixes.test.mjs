import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestEnv, fixtureUser } from './test-env.mjs';
setupTestEnv();
const { db } = await import('../server/db.mjs');
const { handleRequest, originAllowed } = await import('../server/routes.mjs');
const { createSession, now } = await import('../server/security.mjs');
const { guardBaseUrl } = await import('../server/ai-provider.mjs');
const userId = fixtureUser(db, 'review');
let cookie;
const csrf = createSession(userId, { setHeader(_name, value) { cookie = value.split(';')[0]; } });
const server = http.createServer(handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;

async function send(path, { method = 'GET', body, authenticated = true } = {}) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...(authenticated ? { Cookie: cookie } : {}),
      ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}),
    },
    ...(method !== 'GET' ? { body: JSON.stringify(body || {}) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

test('spoofed forwarded headers cannot define the CSRF origin from a public address', () => {
  const headers = { origin: 'https://evil.example', host: '127.0.0.1:4174', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' };
  assert.equal(originAllowed({ headers, socket: { remoteAddress: '203.0.113.9' } }), false);
  assert.equal(originAllowed({ headers: { origin: 'http://127.0.0.1:4174', host: '127.0.0.1:4174', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, socket: { remoteAddress: '203.0.113.9' } }), true);
  assert.equal(originAllowed({ headers, socket: { remoteAddress: '127.0.0.1' } }), true);
  const previous = process.env.APP_ORIGIN;
  process.env.APP_ORIGIN = 'https://jobs.example';
  try {
    assert.equal(originAllowed({ headers, socket: { remoteAddress: '127.0.0.1' } }), false);
    assert.equal(originAllowed({ headers: { origin: 'https://jobs.example/', host: '127.0.0.1:9' }, socket: { remoteAddress: '203.0.113.9' } }), true);
  } finally {
    if (previous === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = previous;
  }
});

test('custom AI endpoints reject documentation and benchmarking addresses', async () => {
  await assert.rejects(guardBaseUrl('https://192.0.2.1/v1'), error => error.status === 400);
  await assert.rejects(guardBaseUrl('https://198.51.100.8/v1'), error => error.status === 400);
});

test('an over-long API key is rejected and a broken ciphertext explains itself', async () => {
  const tooLong = await send('/api/settings/ai', { method: 'PUT', body: { provider: 'deepseek', model: 'deepseek-flash', apiKey: 'k'.repeat(501) } });
  assert.equal(tooLong.status, 400);
  assert.equal(db.prepare('SELECT key_encrypted FROM ai_settings WHERE user_id=?').get(userId), undefined);
  db.prepare('INSERT INTO ai_settings(user_id,key_encrypted,model,provider,base_url,updated_at) VALUES(?,?,?,?,?,?)')
    .run(userId, 'not-a-valid-ciphertext', 'deepseek-flash', 'deepseek', '', now());
  const broken = await send('/api/settings/ai/test', { method: 'POST', body: { provider: 'deepseek', model: 'deepseek-flash' } });
  assert.equal(broken.status, 503);
  assert.equal(broken.body.code, 'KEY_UNREADABLE');
  assert.match(broken.body.error, /无法解密/);
});

test('a malformed percent-encoded path is a client error', async () => {
  assert.equal((await send('/%E0%A4', { authenticated: false })).status, 400);
  assert.equal((await send('/api/private-jobs/%E0%A4')).status, 400);
});
