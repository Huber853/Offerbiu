import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'offerbiu-profile-test-'));
process.env.OFFERBIU_STORAGE = workspace;
process.env.OFFERBIU_DB = path.join(workspace, 'test.sqlite');
process.env.OFFERBIU_JOB_SOURCE = path.join(workspace, 'absent-catalog.json');
process.env.DEEPSEEK_API_KEY = 'test-only-not-a-real-provider-key';

async function moduleOrEmpty(url) {
  if (!fs.existsSync(new URL(url, import.meta.url))) return {};
  return import(url);
}

const shared = await moduleOrEmpty('../shared/job-workflow.mjs');
const profiles = await moduleOrEmpty('../server/candidate-profile.mjs');
const evaluations = await moduleOrEmpty('../server/job-evaluation.mjs');
const { db } = await import('../server/db.mjs');
let sequence = 0;

function newUser() {
  const userId = `profile_user_${++sequence}`;
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .run(userId, `${userId}@example.invalid`, '隐私姓名', 'not-a-login-hash', new Date().toISOString());
  return userId;
}

function resumeFixture(userId) {
  const data = {
    basics: { name: '隐私姓名', phone: '13800123456', email: 'private@example.invalid', city: '西安', headline: '后端开发', website: 'https://private.example.invalid' },
    education: [{ school: '示例大学', degree: '本科', major: '软件工程', start: '2023-09', end: '2027-06', details: '学习数据库。联络 private@example.invalid 13800123456 隐私姓名' }],
    projects: [{ name: '课程系统', role: '开发', start: '2025-09', end: '2025-12', details: '负责 Python API 开发和 SQLite 数据保存。' }],
    experience: [], skills: 'Python\nSQLite', awards: '', media: { portrait: { src: 'data:image/png;base64,private-image' } },
  };
  const resumeId = `resume_${userId}`;
  db.prepare('INSERT INTO resumes(id,user_id,title,template,data,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(resumeId, userId, '本人简历', 'minimal', JSON.stringify(data), 1, new Date().toISOString(), new Date().toISOString());
  return { resumeId, data };
}

function manualBody(revision = 0) {
  return { revision, preferences: { targetRoles: ['后端开发'], preferredCities: ['西安'], cityConstraint: 'preferred', degree: '本科', major: '软件工程', graduationDate: '2027-06', languages: [] },
    facts: [
      { id: `education_${revision}`, kind: 'education', entityKey: 'university', text: '示例大学软件工程本科，2027年6月毕业。', source: { type: 'manual' } },
      { id: `project_${revision}`, kind: 'project', entityKey: 'project_one', text: '负责 Python API 开发和 SQLite 数据保存。', source: { type: 'manual' } },
    ], confirmPreferences: true, confirmedFactIds: [`education_${revision}`, `project_${revision}`] };
}

function assertHttp(status, code) {
  return error => error?.status === status && (!code || error.code === code);
}

function jobFixture(overrides = {}) {
  const jobId = `profile_job_${++sequence}`;
  const sourceUrl = `https://talent.baidu.com/jobs/detail/GRADUATE/${jobId}`;
  const job = { id: jobId, external_id: jobId, company: '百度', title: '后端开发', cities: ['西安'], category: '软件研发', cohort: 2027,
    description: '参与 API 开发。', requirements: '掌握 Python。\n有 SQLite 项目经验者优先。\n本科及以上，毕业时间为2027年1月至12月。', education: '本科及以上',
    cohort_evidence: '2027届', cohort_evidence_url: sourceUrl, source_url: sourceUrl, apply_url: sourceUrl, source_type: 'employer_official', source_policy: 'official-nwu-v1', record_type: 'job',
    direct_apply_verified: true, catalog_status: 'active', deadline: '2099-12-31',
    content_quality: { level: 'complete', reason: '具体岗位正文完整。' },
    availability: { state: 'available', checked_at: new Date().toISOString(), method: 'official_detail', evidence_url: sourceUrl, evidence_quote: '该岗位提供申请入口', last_available_at: new Date().toISOString() },
    eligibility_constraints: [
      { id: 'degree', kind: 'minimum_degree', operator: 'at_least', value: '本科', source_field: 'requirements', source_quote: '本科及以上', source_url: sourceUrl, reviewed_at: new Date().toISOString() },
      { id: 'graduation', kind: 'graduation_window', operator: 'between', value: { start: '2027-01', end: '2027-12' }, source_field: 'requirements', source_quote: '毕业时间为2027年1月至12月', source_url: sourceUrl, reviewed_at: new Date().toISOString() },
    ], ...overrides };
  db.prepare('INSERT INTO jobs(id,company,title,cities,category,cohort,payload,collected_at,catalog_active) VALUES(?,?,?,?,?,?,?,?,1)')
    .run(job.id, job.company, job.title, job.cities.join(' / '), job.category, job.cohort, JSON.stringify(job), new Date().toISOString());
  return job;
}

function updateJob(job) { db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify(job), job.id); }

function modelRelations(input) {
  const fact = input.profile.facts.find(item => item.kind === 'project');
  return { schema_version: 1, units: input.units.map(unit => ({ requirement_id: unit.id, group: unit.sourceField === 'requirements' && /SQLite/.test(unit.text) ? 'experience' : /Python/.test(unit.text) ? 'skills' : 'other',
    importance: /优先/.test(unit.text) ? 'preferred' : 'required', relation: /Python/.test(unit.text) ? 'supported' : /SQLite/.test(unit.text) ? 'partial' : 'unknown',
    fact_ids: /Python|SQLite/.test(unit.text) ? [fact.id] : [], evidence_quotes: /Python|SQLite/.test(unit.text) ? ['负责 Python API 开发和 SQLite 数据保存。'] : [], reason: /Python|SQLite/.test(unit.text) ? '事实中存在相关实践。' : '该条为资格或一般职责，由条件核对展示。' })), eligibility_candidates: [], questions: [] };
}

function mockModel(t, transform = data => data, beforeReply = () => {}) {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (_url, options) => {
    const payload = JSON.parse(options.body);
    const input = JSON.parse(payload.messages[1].content);
    seen.push(input);
    await beforeReply(input);
    return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(transform(modelRelations(input), input)) } }], usage: { prompt_tokens: 50, completion_tokens: 30, total_tokens: 80 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  t.after(() => { globalThis.fetch = original; });
  return seen;
}

test('city hard preferences compare definite cities and preserve broad areas as unknown',async t=>{
  const userId=newUser(), body=manualBody();
  body.preferences={...body.preferences,cityConstraint:'required',preferredCities:['成都']};
  const profile=profiles.saveProfile(userId,body);mockModel(t);
  for(const [cities,expected] of [[['成都'],'pass'],[['四川省·成都'],'pass'],[['四川省'],'needs_review'],[['深圳'],'fail'],[['广东省·深圳'],'fail'],[['成都','全国'],'pass']]){
    const job=jobFixture({cities});
    const result=await evaluations.evaluateJob(userId,{jobId:job.id,profileRevision:profile.revision,consent:true});
    assert.equal(result.result.gates.find(g=>g.kind==='city').state,expected,JSON.stringify(cities));
  }
});

test('text normalization and counting preserve NFC, LF, spaces and Unicode precision', () => {
  assert.equal(typeof shared.normalizeText, 'function', 'workflow text normalization must exist');
  assert.equal(shared.normalizeText('e\u0301\r\n 😀 '), 'é\n 😀 ');
  assert.equal(shared.countText('e\u0301\r\n😀'), 3);
  assert.equal(shared.countText('e\u0301\r\n😀', 'utf16'), 4);
  assert.equal(shared.countText('e\u0301\r\n😀', 'utf8_bytes'), 7);
  assert.equal(shared.canonicalJson({ z: 'e\u0301\r\n', a: { d: 2, b: 1 } }), '{"a":{"b":1,"d":2},"z":"é\\n"}');
  assert.throws(() => shared.countText('x', 'words'));
});

test('old catalog quality and HTTP 200 stay unknown without positive recruitment evidence', () => {
  assert.equal(typeof shared.qualityForJob, 'function', 'workflow quality normalization must exist');
  assert.equal(shared.qualityForJob({ description: '长正文'.repeat(1000) }).level, 'unknown');
  const job = { link_checked_at: new Date().toISOString(), availability: { state: 'available', http_status: 200 } };
  assert.equal(shared.availabilityForJob(job).state, 'unknown');
  assert.equal(shared.availabilityForJob(job).last_available_at, null);
  assert.equal(shared.availabilityForJob({ deadline: '2020-01-01' }).state, 'closed');
  assert.equal(shared.availabilityForJob({ deadline: '2020-02-31' }).state, 'unknown');
  assert.equal(shared.isZonedTimestamp('2026-02-31T10:00:00Z'), false);
  const base = { source_url: 'https://example.invalid/jobs/1', availability: { state: 'available', checked_at: new Date().toISOString(), method: 'official_detail', evidence_url: 'https://example.invalid/', evidence_quote: '欢迎加入' } };
  assert.equal(shared.availabilityForJob(base).state, 'unknown');
  base.availability = { ...base.availability, state: 'closed', evidence_url: base.source_url, http_status: 404, evidence_quote: '404 Not Found' };
  assert.equal(shared.availabilityForJob(base).state, 'unknown');
});

test('resume import is a contact-free draft preview and never overwrites the saved profile', () => {
  assert.equal(typeof profiles.importProfile, 'function', 'profile import must exist');
  const userId = newUser();
  const { resumeId } = resumeFixture(userId);
  const preview = profiles.importProfile(userId, { resumeId, resumeRevision: 1 });
  assert.equal(preview.revision, 0);
  assert.equal(profiles.getProfile(userId).revision, 0);
  assert.equal(preview.preferences.confirmedAt, null);
  assert.ok(preview.facts.every(f => f.status === 'draft' && f.confirmedAt === null));
  for (const secret of ['隐私姓名', '13800123456', 'private@example.invalid', 'private-image']) assert.ok(!JSON.stringify(preview).includes(secret), secret);
  const saved = profiles.saveProfile(userId, { ...preview, confirmPreferences: true, confirmedFactIds: preview.facts.map(f => f.id) });
  assert.equal(saved.ready, true);
  assert.equal(saved.revision, 1);
  assert.equal(profiles.importProfile(userId, { resumeId, resumeRevision: 1 }).revision, 1);
  assert.equal(profiles.getProfile(userId).revision, 1);
});

test('profile confirmation is explicit, server dated, revision checked and required for AI', () => {
  assert.equal(typeof profiles.saveProfile, 'function', 'profile save must exist');
  const userId = newUser();
  const body = manualBody();
  body.preferences.confirmedAt = '2000-01-01T00:00:00Z';
  body.facts.forEach(f => { f.status = 'confirmed'; f.confirmedAt = '2000-01-01T00:00:00Z'; });
  assert.throws(() => profiles.saveProfile(userId, { ...body, confirmedFactIds: undefined }), assertHttp(400));
  const draft = profiles.saveProfile(userId, { ...body, confirmPreferences: false, confirmedFactIds: [] });
  assert.equal(draft.ready, false);
  assert.equal(draft.facts[0].status, 'draft');
  assert.equal(draft.preferences.confirmedAt, null);
  assert.throws(() => profiles.profileInput(userId, 1), assertHttp(400, 'PROFILE_INCOMPLETE'));
  const saved = profiles.saveProfile(userId, { ...draft, confirmPreferences: true, confirmedFactIds: draft.facts.map(f => f.id) });
  assert.equal(saved.revision, 2);
  assert.notEqual(saved.preferences.confirmedAt, body.preferences.confirmedAt);
  assert.ok(saved.facts.every(f => f.confirmedAt && f.confirmedAt !== '2000-01-01T00:00:00Z'));
  assert.ok(saved.facts.every(f => f.source.confirmedAt === f.confirmedAt));
  const input = profiles.profileInput(userId, 2);
  assert.equal(input.facts.length, 2);
  assert.ok(!JSON.stringify(input).includes('source'));
  assert.ok(input.facts.every(fact => /^entity_[a-f0-9]{24}$/.test(fact.entityKey)));
  assert.throws(() => profiles.saveProfile(userId, { ...saved, revision: 1, confirmPreferences: true, confirmedFactIds: [] }), assertHttp(409));
  assert.throws(() => profiles.profileInput(userId, 1), assertHttp(409));
});

test('resume provenance is validated and an edited imported fact becomes manual', () => {
  const userId = newUser();
  const otherUser = newUser();
  const { resumeId } = resumeFixture(userId);
  const foreign = resumeFixture(otherUser);
  assert.throws(() => profiles.importProfile(otherUser, { resumeId, resumeRevision: 1 }), assertHttp(404));
  const preview = profiles.importProfile(userId, { resumeId, resumeRevision: 1 });
  const forged = structuredClone(preview);
  forged.facts[0].source.resumeId = foreign.resumeId;
  assert.throws(() => profiles.saveProfile(userId, { ...forged, confirmPreferences: true, confirmedFactIds: [] }), assertHttp(400));
  let saved = profiles.saveProfile(userId, { ...preview, confirmPreferences: true, confirmedFactIds: preview.facts.map(f => f.id) });
  const original = saved.facts.find(f => f.kind === 'project');
  original.text += ' 使用参数校验。';
  saved = profiles.saveProfile(userId, { ...saved, confirmPreferences: true, confirmedFactIds: saved.facts.map(f => f.id) });
  const edited = saved.facts.find(f => f.id === original.id);
  assert.equal(edited.source.type, 'manual');
  assert.equal(edited.source.originalSource.type, 'resume');
  db.prepare('DELETE FROM resumes WHERE id=?').run(resumeId);
  assert.doesNotThrow(() => profiles.saveProfile(userId, { ...saved, confirmPreferences: true, confirmedFactIds: saved.facts.map(f => f.id) }));
});

test('an edited import preview can explicitly become manual while retaining validated provenance', () => {
  const userId = newUser(); const { resumeId } = resumeFixture(userId);
  const preview = profiles.importProfile(userId, { resumeId, resumeRevision: 1 });
  const project = preview.facts.find(fact => fact.kind === 'project');
  const source = structuredClone(project.source);
  project.text += ' 补充参数检查。';
  project.kind = 'experience';
  project.entityKey = 'corrected_manual_experience';
  project.source = { type: 'manual', originalSource: source };
  const saved = profiles.saveProfile(userId, { ...preview, confirmPreferences: true, confirmedFactIds: preview.facts.map(fact => fact.id) });
  assert.deepEqual(saved.facts.find(fact => fact.id === project.id).source.originalSource, source);
  const forged = profiles.importProfile(userId, { resumeId, resumeRevision: 1 });
  forged.facts[0].source = { type: 'manual', originalSource: { ...forged.facts[0].source, excerpt: '不属于源简历的原文' } };
  assert.throws(() => profiles.saveProfile(userId, { ...forged, confirmPreferences: true, confirmedFactIds: [] }), assertHttp(400));
});

test('fact capacity uses codepoints and confirmed input is never silently truncated', () => {
  const userId = newUser();
  const body = manualBody();
  body.facts[1].text = '😀'.repeat(1200);
  const saved = profiles.saveProfile(userId, body);
  assert.equal(Array.from(saved.facts[1].text).length, 1200);
  assert.throws(() => profiles.saveProfile(userId, { ...saved, facts: [{ ...saved.facts[0], text: 'x'.repeat(1201) }], confirmPreferences: true, confirmedFactIds: [] }), assertHttp(400));
  const large = manualBody();
  large.facts.push(...Array.from({ length: 14 }, (_, i) => ({ id: `extra_${i}`, kind: 'skill', entityKey: `skill_${i}`, text: '能'.repeat(1200), source: { type: 'manual' } })));
  large.confirmedFactIds = large.facts.map(f => f.id);
  const largeUser = newUser();
  profiles.saveProfile(largeUser, large);
  assert.throws(() => profiles.profileInput(largeUser, 1), assertHttp(400, 'PROFILE_TOO_LARGE'));
  assert.throws(() => profiles.saveProfile(newUser(), { ...manualBody(), extra: '大'.repeat(70000) }), assertHttp(413));
  assert.throws(() => profiles.saveProfile(newUser(), { ...manualBody(), extra: 'e\u0301'.repeat(68000) }), assertHttp(413));
});

test('deleted fact IDs are retired and deleting current profile leaves unrelated users intact', () => {
  const userId = newUser();
  const other = newUser();
  profiles.saveProfile(other, manualBody());
  let saved = profiles.saveProfile(userId, manualBody());
  const removed = saved.facts.pop();
  saved = profiles.saveProfile(userId, { ...saved, confirmPreferences: true, confirmedFactIds: saved.facts.map(f => f.id) });
  assert.throws(() => profiles.saveProfile(userId, { ...saved, facts: [...saved.facts, removed], confirmPreferences: true, confirmedFactIds: [] }), assertHttp(400));
  profiles.deleteProfile(userId);
  assert.equal(profiles.getProfile(userId).revision, 0);
  assert.equal(profiles.getProfile(other).revision, 1);
});

test('each explicit save reconfirms a new input even within the same millisecond', () => {
  const userId = newUser(); let saved = profiles.saveProfile(userId, manualBody());
  const hashes = new Set([profiles.profileInput(userId, saved.revision).hash]);
  for (let i = 0; i < 20; i++) {
    saved = profiles.saveProfile(userId, { ...saved, confirmPreferences: true, confirmedFactIds: saved.facts.map(fact => fact.id) });
    hashes.add(profiles.profileInput(userId, saved.revision).hash);
  }
  assert.equal(hashes.size, 21);
});

test('evaluation computes scores on the server and caches a fixed evidence-backed input', async t => {
  assert.equal(typeof evaluations.evaluateJob, 'function', 'job evaluation must exist');
  const userId = newUser();
  profiles.saveProfile(userId, manualBody());
  const job = jobFixture();
  const calls = mockModel(t);
  const request = { jobId: job.id, profileRevision: 1, jdSupplement: '', consent: true };
  const first = await evaluations.evaluateJob(userId, request);
  assert.equal(first.cached, false);
  assert.equal(first.gateState, 'pass');
  assert.equal(first.totalScore, 80);
  assert.equal(first.coverage, 1);
  assert.equal(first.contentQuality, 'complete');
  assert.equal(first.availability, 'available');
  assert.equal(first.stale, false);
  const second = await evaluations.evaluateJob(userId, request);
  assert.equal(second.id, first.id);
  assert.equal(second.cached, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].units.every(unit => unit.id && unit.sourceUrl && unit.sourceField));
  assert.equal(evaluations.getEvaluation(userId, first.id).inputs.profile.facts.length, 2);
  assert.equal(evaluations.listEvaluations(userId, {}).total, 1);
  assert.throws(() => evaluations.getEvaluation(newUser(), first.id), assertHttp(404));
});

test('changing availability rechecks a cache hit; changing text or quality makes history stale', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody());
  const job = jobFixture(); const calls = mockModel(t);
  const request = { jobId: job.id, profileRevision: 1, jdSupplement: '', consent: true };
  const first = await evaluations.evaluateJob(userId, request);
  job.availability = { state: 'unknown', checked_at: new Date().toISOString(), http_status: 403, failure_type: 'login_wall' }; updateJob(job);
  const unknown = await evaluations.evaluateJob(userId, request);
  assert.equal(unknown.cached, true);
  assert.equal(unknown.gateState, 'needs_review');
  assert.equal(unknown.totalScore, 80);
  assert.equal(unknown.scoreLabel, '待核实的材料匹配分');
  assert.equal(calls.length, 1);
  job.content_quality = { level: 'reference_only', reason: '缺少适用引用原文。' }; updateJob(job);
  assert.equal(evaluations.getEvaluation(userId, first.id).stale, true);
  assert.equal(evaluations.listEvaluations(userId, {}).total, 0);
  assert.equal(evaluations.listEvaluations(userId, { includeStale: '1' }).total, 1);
  const incomplete = await evaluations.evaluateJob(userId, request);
  assert.equal(incomplete.totalScore, null);
  assert.equal(incomplete.cached, false);
  assert.equal(calls.length, 2);
  assert.notEqual(incomplete.jobHash, first.jobHash);
});

test('all JD units and paired fact excerpts must validate before any result is saved', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture();
  let mode = 'quote';
  mockModel(t, data => {
    const supported = data.units.find(unit => unit.relation === 'supported');
    if (mode === 'quote') supported.evidence_quotes = ['不存在于事实的经历'];
    if (mode === 'missing') data.units.pop();
    if (mode === 'duplicate') data.units[1].requirement_id = data.units[0].requirement_id;
    if (mode === 'unknown-id') supported.fact_ids = ['not_owned_or_confirmed'];
    if (mode === 'score') data.total_score = 100;
    return data;
  });
  const request = { jobId: job.id, profileRevision: 1, consent: true };
  for (const invalid of ['quote', 'missing', 'duplicate', 'unknown-id', 'score']) {
    mode = invalid;
    await assert.rejects(evaluations.evaluateJob(userId, request), assertHttp(502));
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_evaluations WHERE user_id=?').get(userId).n, 0);
});

test('JD limits reject the entire input before AI; supplements never upgrade public quality', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture({ description: Array.from({ length: 41 }, (_, i) => `${i + 1}.独立职责`).join('\n') });
  const calls = mockModel(t);
  const request = { jobId: job.id, profileRevision: 1, consent: true };
  await assert.rejects(evaluations.evaluateJob(userId, request), assertHttp(400, 'JD_TOO_MANY_UNITS'));
  job.description = '正文'; updateJob(job);
  await assert.rejects(evaluations.evaluateJob(userId, { ...request, jdSupplement: '长'.repeat(24000) }), assertHttp(400, 'JD_TOO_LARGE'));
  resumeFixture(userId);
  await assert.rejects(evaluations.evaluateJob(userId, { ...request, jdSupplement: '13800123456'.repeat(2182) }), assertHttp(400, 'JD_TOO_LARGE'));
  assert.equal(calls.length, 0);
  job.content_quality = { level: 'unknown', reason: '尚未检查。' }; updateJob(job);
  const result = await evaluations.evaluateJob(userId, { ...request, jdSupplement: '补充适用要求：掌握 Python。' });
  assert.equal(result.contentQuality, 'unknown');
  assert.equal(result.totalScore, null);
  assert.equal(evaluations.getEvaluation(userId, result.id).inputs.units.at(-1).sourceType, 'user_supplement');
  assert.equal(JSON.parse(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload).content_quality.level, 'unknown');
});

test('unreviewed or ambiguous eligibility cannot hard-fail; only reviewed precise rules may fail', async t => {
  const calls = mockModel(t);
  const userId = newUser(); const profile = profiles.saveProfile(userId, manualBody());
  const job = jobFixture();
  const request = { jobId: job.id, profileRevision: 1, consent: true };
  job.requirements += '\n硕士及以上';
  job.education = '';
  job.eligibility_constraints[0] = { ...job.eligibility_constraints[0], value: '硕士', source_quote: '硕士及以上', reviewed_at: null }; updateJob(job);
  assert.equal((await evaluations.evaluateJob(userId, request)).gateState, 'needs_review');
  job.eligibility_constraints[0].reviewed_at = new Date().toISOString(); updateJob(job);
  const failed = await evaluations.evaluateJob(userId, request);
  assert.equal(failed.gateState, 'fail');
  assert.equal(failed.totalScore, null);
  job.requirements = job.requirements.replace('硕士及以上', '硕士优先');
  job.eligibility_constraints[0].source_quote = '硕士优先'; updateJob(job);
  assert.equal((await evaluations.evaluateJob(userId, request)).gateState, 'needs_review');
  const required = { ...profile, preferences: { ...profile.preferences, cityConstraint: 'required', preferredCities: ['成都'] }, confirmPreferences: true, confirmedFactIds: profile.facts.map(f => f.id) };
  profiles.saveProfile(userId, required);
  assert.equal((await evaluations.evaluateJob(userId, { ...request, profileRevision: 2 })).gateState, 'fail');
  job.cities = ['全国']; updateJob(job);
  assert.equal((await evaluations.evaluateJob(userId, { ...request, profileRevision: 2 })).gateState, 'needs_review');
  assert.equal(calls.length, 5);
});

test('graduation date precision overlapping a reviewed boundary stays needs_review', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture(); mockModel(t);
  job.eligibility_constraints[1].value = { start: '2027-06-15', end: '2027-12-31' }; updateJob(job);
  assert.equal((await evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, consent: true })).gateState, 'needs_review');
});

test('degree contradictions and nonmandatory wording stay pending even when a rule was reviewed', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture(); mockModel(t);
  job.requirements += '\n硕士及以上';
  job.education = '硕士及以上（任职要求）；官网摘要另标本科';
  job.eligibility_constraints[0] = { ...job.eligibility_constraints[0], value: '硕士', source_quote: '硕士及以上' }; updateJob(job);
  const body = { jobId: job.id, profileRevision: 1, consent: true };
  assert.equal((await evaluations.evaluateJob(userId, body)).gateState, 'needs_review');
  job.education = '';
  job.requirements = job.requirements.replace('硕士及以上', '不强制硕士学历');
  job.eligibility_constraints[0].source_quote = '不强制硕士学历'; updateJob(job);
  assert.equal((await evaluations.evaluateJob(userId, body)).gateState, 'needs_review');
});

test('coverage threshold excludes unknowns and renormalizes a single applicable group', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture();
  job.description = '一般职责'; job.requirements += '\nPython能力一\nPython能力二\nPython能力三\nPython能力四'; updateJob(job);
  let unknowns = 1;
  mockModel(t, data => {
    const skills = data.units.filter(unit => unit.group === 'skills');
    for (const [index, unit] of skills.entries()) {
      if (index >= skills.length - unknowns) { unit.relation = 'unknown'; unit.fact_ids = []; unit.evidence_quotes = []; }
    }
    data.units.filter(unit => unit.group === 'experience').forEach(unit => { unit.group = 'other'; unit.relation = 'unknown'; unit.fact_ids = []; unit.evidence_quotes = []; });
    return data;
  });
  const body = { jobId: job.id, profileRevision: 1, consent: true };
  const accepted = await evaluations.evaluateJob(userId, body);
  assert.equal(accepted.coverage, 0.8);
  assert.equal(accepted.totalScore, 100);
  unknowns = 2;
  job.description += ' 更新'; updateJob(job);
  const insufficient = await evaluations.evaluateJob(userId, body);
  assert.equal(insufficient.coverage, 0.6);
  assert.equal(insufficient.totalScore, null);
});

test('supplement whitespace remains part of the fixed hash and pasted contacts are excluded', async t => {
  const userId = newUser(); resumeFixture(userId); profiles.saveProfile(userId, manualBody()); const job = jobFixture(); const calls = mockModel(t);
  const body = { jobId: job.id, profileRevision: 1, consent: true, jdSupplement: '掌握 Python。 ' };
  const first = await evaluations.evaluateJob(userId, body);
  const second = await evaluations.evaluateJob(userId, { ...body, jdSupplement: '掌握 Python。  ' });
  assert.notEqual(first.jobHash, second.jobHash);
  await evaluations.evaluateJob(userId, { ...body, jdSupplement: '掌握 Python。 隐私姓名 13800123456 private@example.invalid 住址：西安市某街道88号' });
  for (const secret of ['隐私姓名', '13800123456', 'private@example.invalid', '某街道88号']) assert.ok(!JSON.stringify(calls.at(-1)).includes(secret), secret);
});

test('model eligibility suggestions stay needs_review and cannot overrule source rules', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture();
  mockModel(t, (data, input) => ({ ...data, eligibility_candidates: [{ kind: 'minimum_degree', requirement_id: input.units.at(-1).id, source_quote: '本科及以上', reason: '模型建议补充核对。', value: '博士' }] }));
  const result = await evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, consent: true });
  assert.equal(result.gateState, 'needs_review');
  assert.ok(result.result.gates.some(gate => gate.kind === 'model_candidate' && gate.state === 'needs_review'));
});

test('profile changes while AI is running return a conflict and never save an active old result', async t => {
  const userId = newUser(); const saved = profiles.saveProfile(userId, manualBody()); const job = jobFixture();
  mockModel(t, data => data, () => { profiles.saveProfile(userId, { ...saved, confirmPreferences: true, confirmedFactIds: saved.facts.map(f => f.id) }); });
  await assert.rejects(evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, consent: true }), assertHttp(409));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM job_evaluations WHERE user_id=?').get(userId).n, 0);
});

test('profile deletion makes historical evaluations stale but leaves independent history until deleted', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture(); mockModel(t);
  const result = await evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, consent: true });
  profiles.deleteProfile(userId);
  assert.equal(evaluations.getEvaluation(userId, result.id).stale, true);
  evaluations.deleteEvaluation(userId, result.id);
  assert.throws(() => evaluations.getEvaluation(userId, result.id), assertHttp(404));
  assert.ok(db.prepare('SELECT id FROM jobs WHERE id=?').get(job.id));
});

test('recent evaluation ordering retrieves the newest result rather than the best history', async t => {
  const userId = newUser(); profiles.saveProfile(userId, manualBody()); const job = jobFixture(); let lowered = false;
  mockModel(t, data => { if (lowered) for (const unit of data.units.filter(unit => unit.group !== 'other')) { unit.relation = 'not_shown'; unit.fact_ids = []; unit.evidence_quotes = []; } return data; });
  const first = await evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, consent: true });
  lowered = true;
  const last = await evaluations.evaluateJob(userId, { jobId: job.id, profileRevision: 1, jdSupplement: '新补充正文', consent: true });
  db.prepare('UPDATE job_evaluations SET created_at=? WHERE id=?').run('2026-01-01T00:00:00Z', first.id);
  db.prepare('UPDATE job_evaluations SET created_at=? WHERE id=?').run('2026-01-02T00:00:00Z', last.id);
  assert.equal(evaluations.listEvaluations(userId, { jobId: job.id, includeStale: '1', sort: 'recent', limit: '1' }).items[0].id, last.id);
});

test.after(() => { db.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
