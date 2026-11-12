import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv } from './test-env.mjs';
setupTestEnv();
const { sanitizeResume } = await import('../server/security.mjs');
const { blankResume } = await import('../shared/templates.mjs');

test('overlong resume text is rejected and shorter text is kept whole', () => {
  const data = blankResume();
  data.projects[0].details = '项目'.repeat(6000);
  assert.equal(data.projects[0].details.length, 12000);
  assert.equal(sanitizeResume(data).projects[0].details, data.projects[0].details);
  data.projects[0].details += '多';
  assert.throws(() => sanitizeResume(data), error => error.status === 400 && error.message.includes('未保存'));
});
