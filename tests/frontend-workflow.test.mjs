import test from 'node:test';
import assert from 'node:assert/strict';

const profile = await import('../workspace/profile.js').catch(() => ({}));
const evaluation = await import('../workspace/job-evaluation.js').catch(() => ({}));
const materials = await import('../workspace/application-materials.js').catch(() => ({}));
const { api } = await import('../workspace/api.js');

test('import merge preserves confirmed facts and leaves imported facts unconfirmed', () => {
  const current = { revision: 2, preferences: { targetRoles: ['后端'] }, facts: [{ id: 'old', text: '真实经历', status: 'confirmed' }] };
  const preview = { preferences: { targetRoles: ['产品'] }, facts: [{ id: 'new', text: '新经历', status: 'draft' }] };
  const result = profile.mergeProfileImport?.(current, preview, ['new'], false);
  assert.deepEqual(result?.facts?.map(x => [x.id, x.status]), [['old', 'confirmed'], ['new', 'draft']]);
  assert.deepEqual(result?.preferences, current.preferences);
});

test('draft education or sample facts do not make profile ready', () => {
  const result = profile.profileMissing?.({ preferences: { targetRoles: ['后端'], confirmedAt: 'now' }, facts: [{ kind: 'education', status: 'draft' }, { kind: 'project', status: 'confirmed' }] });
  assert.ok(Array.isArray(result) && result.some(text => text.includes('教育')));
});

test('selected evaluations run sequentially and preserve individual failures', async () => {
  assert.equal(typeof evaluation.runSequentialEvaluations, 'function');
  let active = 0, maximum = 0;
  const result = await evaluation.runSequentialEvaluations(['a', 'b', 'c'], async id => {
    active++; maximum = Math.max(maximum, active);
    await Promise.resolve(); active--;
    if (id === 'b') throw new Error('模型服务暂不可用');
    return { id };
  });
  assert.equal(maximum, 1);
  assert.deepEqual(result.map(x => x.status), ['success', 'error', 'success']);
  assert.equal(result[1].error, '模型服务暂不可用');
});

test('cancelling a batch stops the next request and rejects selections above ten', async () => {
  assert.equal(typeof evaluation.runSequentialEvaluations, 'function');
  const controller = new AbortController(); const called = [];
  const result = await evaluation.runSequentialEvaluations(['a', 'b', 'c'], async id => { called.push(id); controller.abort(); return { id }; }, { signal: controller.signal });
  assert.deepEqual(called, ['a']);
  assert.ok(result.slice(1).every(x => x.status === 'cancelled'));
  await assert.rejects(evaluation.runSequentialEvaluations(Array.from({ length: 11 }, (_, i) => String(i)), async () => ({})), /10/);
});

test('submission only includes deliberately chosen fields and retains edited text', () => {
  const result = materials.selectedSubmissionFields?.([
    { selected: false, sourceFieldId: 'first', text: '未选择' },
    { selected: true, sourceFieldId: 'second', text: '我最终提交的文本\r\n第二行' },
    { selected: true, sourceFieldId: null, text: '手工输入' },
  ]);
  assert.deepEqual(result, [{ sourceFieldId: 'second', text: '我最终提交的文本\n第二行' }, { sourceFieldId: null, text: '手工输入' }]);
});

test('AI request timeout aborts transport with a recoverable timeout error', async () => {
  const savedFetch = globalThis.fetch; let transportAborted = false;
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => { transportAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  });
  try { await assert.rejects(api('/job-evaluations', { method: 'POST', data: {}, timeout: 5 }), error => error.code === 'REQUEST_TIMEOUT'); assert.equal(transportAborted, true); }
  finally { globalThis.fetch = savedFetch; }
});

test('leaving the page aborts an outstanding request as cancellation', async () => {
  const savedFetch = globalThis.fetch, controller = new AbortController();
  globalThis.fetch = async (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
  });
  try { const request = api('/materials/one/review', { method: 'POST', signal: controller.signal, timeout: 1000 }); controller.abort(); await assert.rejects(request, error => error.name === 'AbortError' && error.code !== 'REQUEST_TIMEOUT'); }
  finally { globalThis.fetch = savedFetch; }
});

test('evaluation evidence renders untrusted model text as text', () => {
  const markup = evaluation.evaluationDetailMarkup({ profileRevision: 1, result: { units: [{ requirement_id: 'J01', relation: 'unknown', reason: '<img src=x onerror=alert(1)>', fact_ids: [] }], gates: [], questions: ['<script>alert(1)</script>'] }, inputs: { units: [{ id: 'J01', text: '<b>岗位原文</b>' }] } });
  assert.equal(markup.includes('<script>alert'), false);
  assert.equal(markup.includes('<img src=x'), false);
  assert.ok(markup.includes('&lt;img src=x'));
  assert.ok(markup.includes('&lt;b&gt;岗位原文'));
});
