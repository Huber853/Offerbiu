import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { setupTestEnv, fixtureUser, fixtureJob, fixtureResume } from './test-env.mjs';
import { polishDiagnosisMarkup } from '../workspace/ui.js';

setupTestEnv();
const { db } = await import('../server/db.mjs');
const { screenPolishRevision, hrResumeSkillPrompt } = await import('../server/hr-resume-skill.mjs');
const { polishResume } = await import('../server/ai.mjs');
const { saveProfile } = await import('../server/candidate-profile.mjs');
const { createSession } = await import('../server/security.mjs');
const { handleRequest } = await import('../server/routes.mjs');

const originalFetch = globalThis.fetch;
const promptFile = url => fs.readFileSync(new URL(url, import.meta.url), 'utf8');
test.after(() => { globalThis.fetch = originalFetch; db.close(); });

test('diagnosis markup escapes text and stays empty when the model omits it', () => {
  const html = polishDiagnosisMarkup({ diagnosis: { impression: '<b>第一眼</b>', issues: ['动词偏空'], risks: ['没有数字'] } });
  assert.match(html, /HR 初看/);
  assert.match(html, /具体问题/);
  assert.match(html, /改完仍要核对/);
  assert.ok(html.includes('&lt;b&gt;第一眼&lt;/b&gt;'));
  assert.equal(polishDiagnosisMarkup({}), '');
  assert.equal(polishDiagnosisMarkup({ diagnosis: null }), '');
});

test('adapted skill keeps the MIT rules and the same constraints on material prompts', () => {
  assert.match(hrResumeSkillPrompt, /支持\/协助 < 参与 < 负责 < 推动 < 主导/);
  assert.match(hrResumeSkillPrompt, /业务背景 \+ 个人动作 \+ 方法\/工具 \+ 可验证结果/);
  assert.match(hrResumeSkillPrompt, /赋能、闭环、抓手、沉淀、拉通/);
  assert.match(hrResumeSkillPrompt, /coinluu\/resume-jd-optimizer-cn/);
  assert.match(hrResumeSkillPrompt, /MIT License/);
  assert.match(hrResumeSkillPrompt, /不得臆造目标岗位/);
  assert.match(hrResumeSkillPrompt, /实习/);
  assert.match(hrResumeSkillPrompt, /2027/);
  const license = promptFile('../server/prompts/resume-jd-optimizer-cn.LICENSE');
  assert.match(license, /MIT License/);
  assert.match(license, /Copyright \(c\) 2026 coinluu/);
  for (const file of ['../server/prompts/draft-materials.txt', '../server/prompts/review-materials.txt']) {
    const text = promptFile(file);
    assert.match(text, /支持\/协助 < 参与 < 负责 < 推动 < 主导/);
    assert.match(text, /实习/);
  }
  const editor = promptFile('../workspace/editor.js');
  assert.equal(editor.split("/ai/polish").length - 1, 1);
  assert.match(editor, /name="consent"/);
  assert.match(editor, /采纳到简历/);
  assert.match(editor, /未点采纳前/);
});

test('screen rejects invented metrics, stronger verbs, titles, tools and employers', () => {
  const original = '担任实习生，参与接口联调与缺陷记录。';
  assert.throws(() => screenPolishRevision(original, '担任测试负责人，主导接口质量。'), error => error.code === 'AI_OUTPUT_INVALID' && /主导/.test(error.message));
  assert.throws(() => screenPolishRevision(original, '担任项目负责人，参与接口联调。'), error => /负责人/.test(error.message));
  assert.throws(() => screenPolishRevision('参与数据整理。', '参与数据整理，完成业务闭环。'), error => /闭环/.test(error.message));
  assert.throws(() => screenPolishRevision('参与 Python 开发。', '参与 Kubernetes 开发。'), error => /kubernetes/i.test(error.message));
  assert.throws(() => screenPolishRevision('参与课程项目。', '在未知大学参与课程项目。'), error => /未知大学/.test(error.message));
  assert.throws(() => screenPolishRevision('参与整理周报。', '参与整理周报，性能提升 40%。'), error => /数字/.test(error.message));
  assert.throws(() => screenPolishRevision('参与整理周报。', '参与整理周报，提升５０％。'), error => /数字/.test(error.message));
  assert.throws(() => screenPolishRevision('协助整理周报。', '负责整理周报。'), error => /负责/.test(error.message));
  assert.doesNotThrow(() => screenPolishRevision('协助整理周报。', '支持整理周报。'));
  assert.doesNotThrow(() => screenPolishRevision(
    '在课程项目中负责 Python API 开发和 SQLite 数据保存。',
    '负责课程项目的 Python API 开发，使用 SQLite 保存数据。',
  ));
});

test('polish stays a proposal until accept, and inflated output is not stored', async () => {
  const user = fixtureUser(db, 'skill-flow');
  const resume = fixtureResume(db, user);
  fixtureJob(db, { recruit_type: '实习', requirements: '熟悉 Kubernetes，并希望性能提升 50%。', description: '负责高并发服务。' });
  saveProfile(user, {
    revision: 0,
    preferences: { targetRoles: ['后端开发'], preferredCities: ['西安'], cityConstraint: 'preferred', graduationDate: '2027-06', degree: '本科', major: '软件工程', languages: [] },
    facts: [
      { id: 'metric', kind: 'project', entityKey: 'course', text: '课程项目覆盖 12 个接口，联系电话 13800000000。', source: { type: 'manual' } },
      { id: 'draftmetric', kind: 'project', entityKey: 'draftcourse', text: '另有未确认指标 99%。', source: { type: 'manual' } },
    ],
    confirmPreferences: true,
    confirmedFactIds: ['metric'],
  });
  const stored = JSON.parse(db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data);
  stored.media = { portrait: 'data:image/jpeg;base64,SECRETIMAGEPAYLOAD' };
  db.prepare('UPDATE resumes SET data=? WHERE id=?').run(JSON.stringify(stored), resume.id);
  const originalData = db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data;
  let sent;
  const model = payload => { globalThis.fetch = async (_url, options) => { sent = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(payload) } }], usage: { total_tokens: 12 } }), { status: 200 }); }; };
  const body = { resumeId: resume.id, revision: 1, field: 'projects.0.details', jobId: 'job-demo', tone: 'professional', consent: true };
  model({ revised: '在课程项目中负责 Kubernetes 开发，性能提升 50%。', changes: ['对齐岗位'], questions: [], match: null });
  await assert.rejects(polishResume(user, body), error => error.code === 'AI_OUTPUT_INVALID' && /数字/.test(error.message));
  model({ revised: '主导课程项目的 Python API 开发和 SQLite 数据保存。', changes: ['写得更高级'], questions: [], match: null });
  await assert.rejects(polishResume(user, body), error => error.code === 'AI_OUTPUT_INVALID' && /主导/.test(error.message));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_reports WHERE user_id=?').get(user).n, 0);
  assert.equal(db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data, originalData);

  const safe = '负责课程项目的 Python API 开发，使用 SQLite 保存数据。';
  model({ revised: safe, changes: ['把背景和动作写紧'], questions: ['原文没有写接口数量；已确认事实里有 12 个接口，需要的话再补。'], diagnosis: { impression: '能看出是课程里的接口开发。', issues: ['结果缺数字'], risks: ['12 这个数字还没写进段落'] }, match: { score: 88, matched: ['Python'], missing: ['Kubernetes 尚未体现'], advice: '不要把岗位要求写进经历。' } });
  const proposal = await polishResume(user, body);
  assert.equal(proposal.revised, safe);
  assert.equal(proposal.applied_at, null);
  assert.equal(proposal.diagnosis.impression, '能看出是课程里的接口开发。');
  assert.equal(proposal.match.score, 88);
  assert.equal(db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data, originalData);
  assert.equal(sent.messages[0].content, hrResumeSkillPrompt);
  const input = JSON.parse(sent.messages[1].content);
  assert.equal(input.selected_text, resume.data.projects[0].details);
  assert.equal(input.recruit_type, '实习');
  assert.equal(input.cohort, 2027);
  assert.equal(input.confirmed_facts.length, 1);
  assert.match(input.confirmed_facts[0].text, /12/);
  const envelope = JSON.stringify(sent);
  for (const secret of ['合成测试姓名', 'private@example.test', '13800000000', 'SECRETIMAGEPAYLOAD', '99%', 'data:image']) assert.equal(envelope.includes(secret), false);

  model({ revised: safe, changes: ['只整理表达'], questions: [], diagnosis: { impression: '没有目标岗位，只看是否好懂。', issues: [], risks: [] }, match: { score: 90, matched: ['臆造的岗位'], missing: [], advice: '不该出现。' } });
  const untargeted = await polishResume(user, { ...body, jobId: null });
  assert.equal(untargeted.match, null);
  assert.equal(JSON.parse(sent.messages[1].content).target_role, '');
  assert.equal(db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data, originalData);

  const clean = JSON.parse(originalData);
  delete clean.media;
  db.prepare('UPDATE resumes SET data=? WHERE id=?').run(JSON.stringify(clean), resume.id);
  let cookie;
  const csrf = createSession(user, { setHeader(_key, value) { cookie = value.split(';')[0]; } });
  const server = http.createServer(handleRequest);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  globalThis.fetch = originalFetch;
  try {
    const request = async (path, method = 'GET', payload) => {
      const response = await originalFetch(base + '/api' + path, { method, headers: { Cookie: cookie, ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {}) }, ...(method !== 'GET' ? { body: JSON.stringify(payload || {}) } : {}) });
      return { status: response.status, body: await response.json() };
    };
    const before = await request('/resumes/' + resume.id);
    assert.equal(before.status, 200);
    assert.equal(before.body.revision, 1);
    assert.equal(before.body.data.projects[0].details, resume.data.projects[0].details);
    const reports = await request('/ai/reports');
    assert.equal(reports.body.find(item => item.id === proposal.id).applied_at, null);
    assert.equal(reports.body.find(item => item.id === proposal.id).diagnosis.issues[0], '结果缺数字');
    const applied = await request('/ai/reports/' + proposal.id + '/apply', 'POST', { revision: 1 });
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.revision, 2);
    assert.equal(applied.body.data.projects[0].details, safe);
    const after = await request('/resumes/' + resume.id);
    assert.equal(after.body.data.projects[0].details, safe);
    assert.equal((await request('/ai/reports')).body.find(item => item.id === proposal.id).applied_at == null, false);
  } finally {
    await new Promise(resolve => server.close(resolve));
    globalThis.fetch = originalFetch;
  }
});
