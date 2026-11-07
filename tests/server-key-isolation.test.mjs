import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, fixtureUser } from './test-env.mjs';
setupTestEnv();
const { db } = await import('../server/db.mjs');
const { serverDeepSeekKeyFor, serverKeyPolicy } = await import('../server/ai-access.mjs');
const { callJson } = await import('../server/ai-client.mjs');
const { aiSettings } = await import('../server/ai.mjs');
fixtureUser(db, 'alice');
fixtureUser(db, 'bob');
const key = process.env.DEEPSEEK_API_KEY;
const previous = {
  HOST: process.env.HOST,
  APP_ORIGIN: process.env.APP_ORIGIN,
  OFFERBIU_SERVER_KEY_EMAILS: process.env.OFFERBIU_SERVER_KEY_EMAILS,
};

test.after(() => {
  for (const [name, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  db.close();
});

test('localhost without an allowlist keeps the server key, and other deployments do not', async () => {
  delete process.env.OFFERBIU_SERVER_KEY_EMAILS;
  delete process.env.APP_ORIGIN;
  process.env.HOST = '127.0.0.1';
  assert.equal(serverKeyPolicy(), 'local-shared');
  assert.equal(serverDeepSeekKeyFor('alice'), key);
  assert.equal(aiSettings('bob').source, 'server');
  process.env.HOST = '0.0.0.0';
  assert.equal(serverKeyPolicy(), 'personal-only');
  assert.equal(serverDeepSeekKeyFor('alice'), '');
  assert.equal(aiSettings('alice').source, 'none');
  process.env.HOST = '127.0.0.1';
  process.env.APP_ORIGIN = 'https://jobs.example';
  assert.equal(serverDeepSeekKeyFor('alice'), '');
  process.env.OFFERBIU_SERVER_KEY_EMAILS = 'alice@example.test';
  assert.equal(serverKeyPolicy(), 'allowlist');
  assert.equal(serverDeepSeekKeyFor('alice'), key);
  assert.equal(serverDeepSeekKeyFor('bob'), '');
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response('no'); };
  await assert.rejects(callJson('bob', { task: 'test', system: 'json', input: { ok: true } }), error => error.code === 'AI_NOT_CONFIGURED');
  assert.equal(called, false);
});
