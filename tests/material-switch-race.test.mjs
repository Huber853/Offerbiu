import test from 'node:test';
import assert from 'node:assert/strict';
import { mountApplicationMaterials } from '../workspace/application-materials.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
const draft = id => ({ id, applicationId: 'app', version: 1, sourceResumeRevision: 1, profileRevision: 1,
  reviewState: 'pending', inputs: { profile: { facts: [] } },
  content: { patches: [{ id: 'patch', path: 'basics.summary', original: '原文', revised: `${id} 的正文`, reason: '表达调整', fact_ids: [] }], form_fields: [], warnings: [], questions: [] } });

async function mount(t) {
  const handlers = {}, pending = new Map(), originalFetch = globalThis.fetch;
  let html = '', currentId = '', textarea = { value: '' };
  const error = { textContent: '' };
  const root = {
    get innerHTML() { return html; },
    set innerHTML(value) {
      html = value; currentId = value.match(/data-material-id="([^"]*)"/)?.[1] || '';
      textarea = { value: value.match(/<textarea name="revised"[^>]*>([^<]*)<\/textarea>/)?.[1] || '' };
    },
    addEventListener(type, handler) { handlers[type] = handler; }, removeEventListener() {},
    querySelector(selector) {
      if (selector === '#current-material') return { dataset: { materialId: currentId }, scrollIntoView() {} };
      if (selector === '[data-material-error]') return error;
      return null;
    },
    querySelectorAll(selector) {
      return selector === '[data-patch]' && currentId ? [{ dataset: { patch: 'patch' }, querySelector: () => textarea }] : [];
    },
  };
  globalThis.fetch = async path => {
    let value;
    if (path === '/api/applications') value = [{ id: 'app', job_id: 'job', job: { id: 'job', company: '测试公司', title: '开发岗位' } }];
    else if (path === '/api/candidate-profile') value = { revision: 1 };
    else if (path === '/api/resumes') value = [];
    else if (path.startsWith('/api/job-evaluations') || path.startsWith('/api/applications/app/')) value = { items: [], total: 0 };
    else if (path.startsWith('/api/materials/')) {
      const id = path.split('/').pop();
      value = id === 'a' ? draft(id) : await new Promise(resolve => pending.set(id, () => resolve(draft(id))));
    } else throw new Error('Unexpected request: ' + path);
    return Response.json(value);
  };
  const handle = await mountApplicationMaterials(root, { applicationId: 'app' });
  t.after(() => { handle.destroy(); globalThis.fetch = originalFetch; });
  return {
    handle, root, pending,
    get currentId() { return currentId; }, get text() { return textarea.value; },
    async open(id) { handlers.click({ target: { closest: () => ({ disabled: false, dataset: { materialAction: 'open', id } }) } }); await flush(); },
    edit(value) { textarea.value = value; handlers.input({ target: { closest: selector => selector === '#material-edit-form' ? {} : null } }); },
  };
}

test('opening a historical material preserves edits made while its response is pending', async t => {
  const page = await mount(t);
  await page.open('a'); await page.open('b');
  page.edit('请求期间刚写入的真实经历');
  assert.equal(page.handle.isDirty(), true);
  page.pending.get('b')(); await flush();
  assert.equal(page.currentId, 'a');
  assert.equal(page.text, '请求期间刚写入的真实经历');
  assert.equal(page.handle.isDirty(), true);
});

test('a slower earlier material response cannot replace the latest chosen material', async t => {
  const page = await mount(t);
  await page.open('a'); await page.open('b'); await page.open('c');
  page.pending.get('c')(); await flush();
  assert.equal(page.currentId, 'c');
  assert.equal(page.handle.isDirty(), false);
  page.pending.get('b')(); await flush();
  assert.equal(page.currentId, 'c');
  assert.equal(page.text, 'c 的正文');
});
