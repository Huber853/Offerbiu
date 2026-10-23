import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { setupTestEnv, fixtureUser, fixtureJob, fixtureResume, fixtureApplication } from './test-env.mjs';

const folder = setupTestEnv();
const { db } = await import('../server/db.mjs');
const { sha256 } = await import('../server/security.mjs');
const { canonicalJson, EVALUATION_PROMPT_VERSION } = await import('../shared/job-workflow.mjs');
const optional = async name => fs.existsSync(new URL('../server/'+name, import.meta.url)) ? import('../server/'+name) : {};
const materials = await optional('application-materials.mjs');
const submissions = await optional('application-submissions.mjs');
let sequence = 0;
let responseFactory;
let requests = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  requests.push(JSON.parse(options.body));
  const output = await responseFactory(JSON.parse(options.body));
  return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
};

function required(fn) { assert.equal(typeof fn, 'function', 'workflow operation must be implemented'); }
async function fixture() {
  const n = ++sequence, user = fixtureUser(db, 'materials-'+n), other = fixtureUser(db, 'other-'+n);
  const job = fixtureJob(db, { id: 'job-'+n, record_type:'job',source_type:'employer_official',direct_apply_verified:true });
  const resume = fixtureResume(db, user);
  const application = fixtureApplication(db, user, job.id);
  const profile = { schemaVersion: 1, revision: 1, preferences: { confirmedAt: new Date().toISOString(), targetRoles: ['后端开发'], preferredCities: ['西安'], cityConstraint: 'preferred', graduationDate: '2027-06', degree: '本科', major: '软件工程', languages: [] }, facts: [
    { id: 'education-'+n, kind: 'education', entityKey: 'school-'+n, text: '在示例大学学习软件工程，本科学历，2027-06 毕业。', status: 'confirmed', confirmedAt: new Date().toISOString(), source: { type: 'manual' } },
    { id: 'project-'+n, kind: 'project', entityKey: 'course-'+n, text: resume.data.projects[0].details, status: 'confirmed', confirmedAt: new Date().toISOString(), source: { type: 'resume', resumeId: resume.id, resumeRevision: 1, field: 'projects.0.details', excerpt: resume.data.projects[0].details } },
  ] };
  const time = new Date().toISOString();
  db.prepare('INSERT INTO candidate_profiles(user_id,revision,data_json,created_at,updated_at) VALUES(?,1,?,?,?)').run(user, JSON.stringify(profile), time, time);
  const { profileInput } = await import('../server/candidate-profile.mjs');
  const { currentJobInput } = await import('../server/job-evaluation.mjs');
  const safeProfile = profileInput(user, 1);
  const jobInput = currentJobInput(user, job.id);
  const evaluationId = 'evaluation-'+n;
  db.prepare(`INSERT INTO job_evaluations(id,user_id,job_id,profile_revision,profile_hash,job_hash,rule_version,prompt_version,provider,model,endpoint_fingerprint,cache_key,gate_state,total_score,coverage,inputs_json,result_json,created_at)
    VALUES(?,?,?,1,?,?,'1',?,'deepseek','deepseek-flash','test-endpoint',?,'needs_review',80,1,?,?,?)`)
    .run(evaluationId,user,job.id,safeProfile.hash,jobInput.jobHash,EVALUATION_PROMPT_VERSION,'cache-'+n,JSON.stringify({...jobInput,profile:safeProfile}),JSON.stringify({units:[],eligibilityCandidates:[],modelQuestions:[]}),time);
  const fact = profile.facts[1];
  const draft = { schema_version: 1, patches: [{ id: 'patch-1', path: 'projects.0.details', original: resume.data.projects[0].details, revised: '负责课程项目的 Python API 开发，使用 SQLite 实现数据保存。', fact_ids: [fact.id], fact_quotes: [{fact_id:fact.id,quote:'负责 Python API 开发和 SQLite 数据保存'}], reason: '突出开发职责' }], form_fields: [{ id: 'field-1', type: 'self_introduction', max_length: 150, count_mode: 'codepoints', text: '我有 Python API 开发和 SQLite 数据保存的课程项目实践。', fact_ids: [fact.id], fact_quotes:[{fact_id:fact.id,quote:'Python API 开发和 SQLite 数据保存'}] }], questions: [], warnings: [] };
  const body = { evaluationId, resumeId: resume.id, resumeRevision: 1, profileRevision: 1, requestId: crypto.randomUUID(), acknowledgePendingConditions: true, fields: [{type:'self_introduction',maxLength:150,countMode:'codepoints'}], consent:true };
  requests=[]; responseFactory = async () => structuredClone(draft);
  return { user, other, job, resume, application, profile, fact, draft, body, evaluationId };
}
const fail = status => error => error?.status === status;
async function generated(f) { return materials.generateMaterials(f.user,f.application,f.body); }
async function reviewed(f) {
  const material = await generated(f);
  responseFactory = async () => ({schema_version:1,verdict:'passed',findings:[],checked_patch_ids:['patch-1'],checked_field_ids:['field-1']});
  return materials.reviewMaterial(f.user, material.id, {version:1,consent:true});
}
async function accepted(f) {
  const material = await reviewed(f);
  return materials.createMaterialResume(f.user,material.id,{version:1,sourceResumeRevision:1,selectedPatchIds:['patch-1'],title:'定制简历'});
}
function submissionBody(f, resume = f.resume) { return { requestId:crypto.randomUUID(),resumeId:resume.id,resumeRevision:resume.revision,materialId:null,jdSnapshotFrom:'current_catalog',submittedFields:[],submittedAt:'2026-10-23T11:00:00+08:00',channel:'official_portal',confirmedSubmitted:true }; }

test('generation saves a safe immutable draft without creating a resume or changing progress', async () => {
  required(materials.generateMaterials); const f=await fixture(); const material=await generated(f);
  assert.equal(material.version,1); assert.equal(material.reviewState,'pending');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE user_id=?').get(f.user).n,1);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(f.application).status,'saved');
  const external=JSON.stringify(requests[0].messages), stored=JSON.stringify(material.inputs);
  for(const secret of ['合成测试姓名','private@example.test','13800000000','media','portrait']) { assert.ok(!external.includes(secret)); assert.ok(!stored.includes(secret)); }
  assert.ok(!external.includes(f.user)); assert.ok(!external.includes(f.resume.id));
  assert.equal(material.content.form_fields[0].usedLength,Array.from(f.draft.form_fields[0].text).length);
});

test('generation is idempotent by normalized payload and rejects request-key reuse', async () => {
  required(materials.generateMaterials); const f=await fixture(); const first=await generated(f);
  const again=await generated(f); assert.equal(again.id,first.id); assert.equal(again.replayed,true); assert.equal(requests.length,1);
  await assert.rejects(materials.generateMaterials(f.user,f.application,{...f.body,fields:[]}),fail(409));
});

test('confirmed calendar dates can change Chinese formatting without changing month or precision',async()=>{
  const f=await fixture(); const fact=f.profile.facts[0];
  f.draft.patches=[];
  Object.assign(f.draft.form_fields[0],{text:'我于2027年6月毕业。',fact_ids:[fact.id],fact_quotes:[{fact_id:fact.id,quote:'2027-06 毕业'}]});
  const saved=await generated(f);
  assert.equal(saved.content.form_fields[0].text,'我于2027年6月毕业。');
  f.draft.form_fields[0].text='我于2027年8月毕业。';
  await assert.rejects(materials.generateMaterials(f.user,f.application,{...f.body,requestId:crypto.randomUUID()}),fail(502));
  f.draft.form_fields[0].text='我于2027年6月15日毕业。';
  await assert.rejects(materials.generateMaterials(f.user,f.application,{...f.body,requestId:crypto.randomUUID()}),fail(502));
});

for(const [label,change] of [
  ['arbitrary object path', d=>d.patches[0].path='__proto__.polluted'],
  ['structural path', d=>d.patches[0].path='projects.0.name'],
  ['mismatched original', d=>d.patches[0].original='not the saved text'],
  ['unknown fact', d=>d.patches[0].fact_ids=['nonexistent-fact']],
  ['missing quote coverage', d=>d.patches[0].fact_quotes=[]],
  ['invented quote', d=>d.patches[0].fact_quotes[0].quote='并不存在的原句'],
  ['new numerical achievement', d=>d.patches[0].revised='负责 Python API 开发，性能提升 99%。'],
  ['new named institution', d=>d.patches[0].revised='在未知大学负责 Python API 开发。'],
  ['new technology claim', d=>d.patches[0].revised='负责 Kubernetes 平台开发。'],
  ['unsubstantiated responsibility', d=>d.patches[0].revised='独立负责 Python API 开发。'],
  ['duplicate path', d=>d.patches.push({...d.patches[0],id:'patch-2'})],
  ['missing requested field', d=>d.form_fields=[]],
  ['field over chosen limit', d=>d.form_fields[0].text='开发'.repeat(100)],
]) test('generation rejects '+label+' and preserves all source data', async () => {
  required(materials.generateMaterials); const f=await fixture(); change(f.draft);
  await assert.rejects(generated(f),fail(502));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM application_materials WHERE user_id=?').get(f.user).n,0);
  assert.equal(db.prepare('SELECT data FROM resumes WHERE id=?').get(f.resume.id).data,JSON.stringify(f.resume.data));
});

test('facts belonging to a different resume entity cannot be applied to this project', async () => {
  required(materials.generateMaterials); const f=await fixture();
  f.profile.facts[1].source.field='projects.1.details'; f.profile.facts[1].entityKey='another-project';
  db.prepare('UPDATE candidate_profiles SET data_json=? WHERE user_id=?').run(JSON.stringify(f.profile),f.user);
  const {profileInput}=await import('../server/candidate-profile.mjs'); const p=profileInput(f.user,1);
  const row=db.prepare('SELECT inputs_json FROM job_evaluations WHERE id=?').get(f.evaluationId);
  db.prepare('UPDATE job_evaluations SET profile_hash=?,inputs_json=? WHERE id=?').run(p.hash,JSON.stringify({...JSON.parse(row.inputs_json),profile:p}),f.evaluationId);
  await assert.rejects(generated(f),fail(502));
});

test('real imported entity pointers work without leaking resume identifiers or raw catalog payload', async () => {
  const f=await fixture();f.profile.facts[1].source.field='projects.0';f.profile.facts[1].entityKey=`resume_${f.resume.id}_projects_0`;
  db.prepare('UPDATE candidate_profiles SET data_json=? WHERE user_id=?').run(JSON.stringify(f.profile),f.user);
  const {profileInput}=await import('../server/candidate-profile.mjs'), profile=profileInput(f.user,1);
  const row=db.prepare('SELECT inputs_json FROM job_evaluations WHERE id=?').get(f.evaluationId), inputs=JSON.parse(row.inputs_json);
  db.prepare('UPDATE job_evaluations SET profile_hash=?,inputs_json=? WHERE id=?').run(profile.hash,JSON.stringify({...inputs,profile}),f.evaluationId);
  const result=await generated(f);assert.equal(result.reviewState,'pending');
  const input=JSON.parse(requests[0].messages[1].content);assert.ok(!JSON.stringify(input).includes(f.resume.id));assert.equal(input.job.rawPayload,undefined);
});

test('supported institution names remain valid when surrounding Chinese prose is rewritten', async () => {
  const f=await fixture(),fact=f.profile.facts[0];f.draft.patches=[{id:'patch-education',path:'education.0.details',original:f.resume.data.education[0].details,
    revised:'就读于示例大学，学习软件工程，本科学历，2027-06 毕业。',fact_ids:[fact.id],fact_quotes:[{fact_id:fact.id,quote:fact.text}],reason:'整理教育事实'}];
  const result=await generated(f);assert.equal(result.content.patches[0].id,'patch-education');
});

test('generation rechecks resume revision after the model await', async () => {
  required(materials.generateMaterials); const f=await fixture();
  responseFactory=async()=>{db.prepare('UPDATE resumes SET revision=2 WHERE id=?').run(f.resume.id);return f.draft;};
  await assert.rejects(generated(f),fail(409)); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM application_materials WHERE user_id=?').get(f.user).n,0);
});

test('source deletion during generation reports an input conflict without saving a draft', async () => {
  const f=await fixture();responseFactory=async()=>{db.prepare('DELETE FROM resumes WHERE id=?').run(f.resume.id);return f.draft;};
  await assert.rejects(generated(f),error=>error.status===409&&error.code==='INPUT_CHANGED');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM application_materials WHERE user_id=?').get(f.user).n,0);
});

test('same-user evaluation for another job is rejected before any AI call', async () => {
  required(materials.generateMaterials); const f=await fixture(); const otherJob=fixtureJob(db,{id:'different-'+sequence});
  db.prepare('UPDATE job_evaluations SET job_id=? WHERE id=?').run(otherJob.id,f.evaluationId);
  await assert.rejects(generated(f),fail(404)); assert.equal(requests.length,0);
});

test('material reads and writes enforce user ownership and linked ownership', async () => {
  required(materials.generateMaterials); const f=await fixture(); const m=await generated(f);
  assert.throws(()=>materials.getMaterial(f.other,m.id),fail(404));
  assert.throws(()=>materials.updateMaterial(f.other,m.id,{version:1,patches:[]}),fail(404));
  const foreign=fixtureResume(db,f.other); db.prepare('UPDATE application_materials SET source_resume_id=? WHERE id=?').run(foreign.id,m.id);
  assert.throws(()=>materials.getMaterial(f.user,m.id),fail(404));
});

test('editing permits only text deltas and invalidates the review for the entire new version', async () => {
  required(materials.reviewMaterial); const f=await fixture(); const m=await reviewed(f);
  assert.equal(m.reviewState,'passed');
  assert.throws(()=>materials.updateMaterial(f.user,m.id,{version:1,patches:[{id:'patch-1',path:'skills',revised:'Python'}]}),fail(400));
  const updated=materials.updateMaterial(f.user,m.id,{version:1,patches:[{id:'patch-1',revised:'使用 SQLite 保存课程项目数据，并负责 Python API 开发。'}]});
  assert.equal(updated.version,2); assert.equal(updated.reviewState,'pending'); assert.equal(updated.review,null);
  assert.equal(updated.content.patches[0].path,'projects.0.details');
  assert.throws(()=>materials.updateMaterial(f.user,m.id,{version:1,formFields:[]}),fail(409));
});

test('review must independently cover every patch and field and invalid output stays pending', async () => {
  required(materials.reviewMaterial); const f=await fixture(); const m=await generated(f);
  responseFactory=async()=>({schema_version:1,verdict:'passed',findings:[],checked_patch_ids:['patch-1'],checked_field_ids:[]});
  await assert.rejects(materials.reviewMaterial(f.user,m.id,{version:1,consent:true}),fail(502));
  assert.equal(materials.getMaterial(f.user,m.id).reviewState,'pending');
});

test('review findings require known target and evidence IDs', async () => {
  required(materials.reviewMaterial); const f=await fixture(); const m=await generated(f);
  responseFactory=async()=>({schema_version:1,verdict:'needs_revision',findings:[{target_id:'unknown',type:'unsupported_fact',explanation:'缺少支持',evidence_ids:['made-up']}],checked_patch_ids:['patch-1'],checked_field_ids:['field-1']});
  await assert.rejects(materials.reviewMaterial(f.user,m.id,{version:1,consent:true}),fail(502));
});

test('review never spans a SQLite transaction across the external await', async () => {
  required(materials.reviewMaterial); const f=await fixture(); const m=await generated(f);
  responseFactory=async()=>{ db.exec('BEGIN IMMEDIATE');db.exec('ROLLBACK');return {schema_version:1,verdict:'passed',findings:[],checked_patch_ids:['patch-1'],checked_field_ids:['field-1']};};
  const r=await materials.reviewMaterial(f.user,m.id,{version:1,consent:true});assert.equal(r.reviewState,'passed');
  assert.equal(r.usage.draft.usage.completion_tokens,20);assert.equal(r.usage.review[0].usage.completion_tokens,20);
  assert.equal(r.review.provider,r.usage.review[0].provider);assert.equal(r.review.endpointFingerprint,r.usage.review[0].endpointFingerprint);
  assert.equal(requests[1].messages.length,2);assert.ok(!JSON.stringify(requests[1]).includes('role":"assistant'));
});

test('adoption clones contacts and design locally, creates V1 once, and freezes the material', async () => {
  required(materials.createMaterialResume); const f=await fixture(); const adopted=await accepted(f), m=adopted.material, r=adopted.resume;
  assert.notEqual(r.id,f.resume.id);assert.equal(r.data.basics.email,f.resume.data.basics.email);assert.equal(r.data.projects[0].details,f.draft.patches[0].revised);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM resume_versions WHERE resume_id=?').get(r.id).n,1);
  const replay=materials.createMaterialResume(f.user,m.id,{version:1,sourceResumeRevision:1,selectedPatchIds:['patch-1'],title:'定制简历'});
  assert.equal(replay.resume.id,r.id);assert.equal(replay.replayed,true);
  assert.throws(()=>materials.updateMaterial(f.user,m.id,{version:1,patches:[]}),fail(409));
  db.prepare('DELETE FROM resumes WHERE id=?').run(r.id);
  assert.throws(()=>materials.createMaterialResume(f.user,m.id,{version:1,sourceResumeRevision:1,selectedPatchIds:['patch-1'],title:'定制简历'}),e=>e.status===410&&e.code==='CREATED_RESUME_DELETED');
});

test('source profile and job changes block review and adoption with conflicts', async () => {
  required(materials.createMaterialResume); const f=await fixture(); const m=await reviewed(f);
  db.prepare('UPDATE candidate_profiles SET revision=2 WHERE user_id=?').run(f.user);
  assert.throws(()=>materials.createMaterialResume(f.user,m.id,{version:1,sourceResumeRevision:1,selectedPatchIds:['patch-1']}),fail(409));
  assert.equal(materials.getMaterial(f.user,m.id).stale,true);
});

test('submission reads the selected historical resume version and freezes the selected JD', async () => {
  required(submissions.createSubmission); const f=await fixture(); const body=submissionBody(f);
  const original=structuredClone(f.resume.data); f.resume.data.projects[0].details='现在的新内容';
  db.prepare('UPDATE resumes SET revision=2,data=? WHERE id=?').run(JSON.stringify(f.resume.data),f.resume.id);
  const saved=submissions.createSubmission(f.user,f.application,body);
  assert.deepEqual(saved.snapshot.resume.data,original);assert.equal(saved.resumeRevision,1);assert.equal(saved.submittedAt,'2026-10-23T03:00:00.000Z');
  db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...f.job,description:'改变后的 JD'}),f.job.id);
  assert.equal(submissions.getSubmission(f.user,saved.id).snapshot.job.description,f.job.description);
});

test('submission requires explicit confirmation and a timezone-aware valid timestamp', async () => {
  required(submissions.createSubmission); const f=await fixture(), b=submissionBody(f);
  for(const change of [{confirmedSubmitted:false},{submittedAt:'2026-10-23T03:00:00'},{submittedAt:'2026-02-31T03:00:00Z'}]) assert.throws(()=>submissions.createSubmission(f.user,f.application,{...b,...change}),fail(400));
});

test('submission idempotency survives deleted resume, material and evaluation sources', async () => {
  required(submissions.createSubmission); const f=await fixture(), a=await accepted(f), b={...submissionBody(f,a.resume),materialId:a.material.id,jdSnapshotFrom:'evaluation',evaluationId:f.evaluationId,submittedFields:[{sourceFieldId:'field-1',text:f.draft.form_fields[0].text}]};
  const first=submissions.createSubmission(f.user,f.application,b);
  db.prepare('DELETE FROM resumes WHERE id=?').run(a.resume.id); materials.deleteMaterial(f.user,a.material.id);db.prepare('DELETE FROM job_evaluations WHERE id=?').run(f.evaluationId);
  const replay=submissions.createSubmission(f.user,f.application,b);assert.equal(replay.id,first.id);assert.equal(replay.replayed,true);
  assert.throws(()=>submissions.createSubmission(f.user,f.application,{...b,channel:'email'}),fail(409));
});

test('archive stores only chosen fields and marks exact user changes without inherited review', async () => {
  required(submissions.createSubmission); const f=await fixture(), a=await accepted(f), b={...submissionBody(f,a.resume),materialId:a.material.id,submittedFields:[{sourceFieldId:'field-1',text:'用户实际提交的文字'},{sourceFieldId:null,text:'手工网申字段'}]};
  const s=submissions.createSubmission(f.user,f.application,b);
  assert.equal(s.snapshot.submittedFields.length,2);assert.equal(s.snapshot.submittedFields[0].editedByUser,true);assert.equal(s.snapshot.submittedFields[0].reviewed,false);assert.equal(s.snapshot.submittedFields[1].sourceFieldId,null);
  const noFields=submissions.createSubmission(f.user,f.application,{...b,requestId:crypto.randomUUID(),submittedFields:[]});assert.deepEqual(noFields.snapshot.submittedFields,[]);
});

test('submission enforces derived resume, app/job relationships and user isolation', async () => {
  required(submissions.createSubmission); const f=await fixture(), a=await accepted(f), b={...submissionBody(f),materialId:a.material.id};
  assert.throws(()=>submissions.createSubmission(f.user,f.application,b),fail(409));
  const foreignResume=fixtureResume(db,f.other);assert.throws(()=>submissions.createSubmission(f.user,f.application,{...b,materialId:null,resumeId:foreignResume.id}),fail(404));
  const otherJob=fixtureJob(db,{id:'other-sub-job-'+sequence}), otherApp=fixtureApplication(db,f.user,otherJob.id,'other-sub-app-'+sequence);
  assert.throws(()=>submissions.createSubmission(f.user,otherApp,{...b,resumeId:a.resume.id}),fail(404));
  const s=submissions.createSubmission(f.user,f.application,{...b,resumeId:a.resume.id});assert.throws(()=>submissions.getSubmission(f.other,s.id),fail(404));assert.throws(()=>submissions.deleteSubmission(f.other,s.id),fail(404));
});

test('submission events and sequences are atomic and later records never regress progress', async () => {
  required(submissions.createSubmission); const f=await fixture(), b=submissionBody(f), first=submissions.createSubmission(f.user,f.application,b);
  assert.equal(first.sequence,1);assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(f.application).status,'applied');
  db.prepare("UPDATE applications SET status='interview' WHERE id=?").run(f.application);
  const second=submissions.createSubmission(f.user,f.application,{...b,requestId:crypto.randomUUID()});assert.equal(second.sequence,2);
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(f.application).status,'interview');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM application_events WHERE application_id=? AND kind='submission_recorded'").get(f.application).n,2);
  submissions.deleteSubmission(f.user,first.id);submissions.deleteSubmission(f.user,second.id);
  const third=submissions.createSubmission(f.user,f.application,{...b,requestId:crypto.randomUUID()});assert.equal(third.sequence,3);assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get(f.application).status,'interview');
});

test('lists paginate summaries and explicit deletion preserves independent records', async () => {
  required(materials.listMaterials);required(submissions.listSubmissions);const f=await fixture(),a=await accepted(f),s=submissions.createSubmission(f.user,f.application,submissionBody(f,a.resume));
  const ml=materials.listMaterials(f.user,f.application,{limit:1,offset:0}), sl=submissions.listSubmissions(f.user,f.application,{limit:1,offset:0});
  assert.equal(ml.total,1);assert.equal(ml.items[0].inputs,undefined);assert.equal(sl.total,1);assert.equal(sl.items[0].snapshot,undefined);
  materials.deleteMaterial(f.user,a.material.id);assert.equal(submissions.getSubmission(f.user,s.id).snapshot.resume.id,a.resume.id);assert.ok(db.prepare('SELECT id FROM resumes WHERE id=?').get(a.resume.id));
});

test.after(()=>{globalThis.fetch=originalFetch;db.close();fs.rmSync(folder,{recursive:true,force:true});});
