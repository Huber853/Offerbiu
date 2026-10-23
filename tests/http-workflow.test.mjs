import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { setupTestEnv,fixtureUser,fixtureResume,fixtureJob,fixtureApplication } from './test-env.mjs';
setupTestEnv();
const {db}=await import('../server/db.mjs');
const {createSession}=await import('../server/security.mjs');
const {handleRequest}=await import('../server/routes.mjs');
fixtureUser(db,'http-a');fixtureUser(db,'http-b');
fixtureJob(db);fixtureResume(db,'http-a');fixtureResume(db,'http-b');
fixtureApplication(db,'http-a');fixtureApplication(db,'http-b');
let cookie;
const csrf=createSession('http-a',{setHeader(k,v){cookie=v.split(';')[0];}});
const server=http.createServer(handleRequest);
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base='http://127.0.0.1:'+server.address().port;
const request=async(path,method='GET',body,authenticated=true,token=csrf)=>{
  const r=await fetch(base+'/api'+path,{method,headers:{...(authenticated?{Cookie:cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json','X-CSRF-Token':token}:{})},...(method!=='GET'?{body:JSON.stringify(body||{})}:{})});
  return {status:r.status,body:await r.json()};
};
test.after(async()=>{await new Promise(r=>server.close(r));db.close();});
test('workflow endpoints require a valid account and CSRF on writes',async()=>{
  assert.equal((await request('/candidate-profile','GET',null,false)).status,401);
  assert.equal((await request('/candidate-profile','PUT',{},true,'wrong')).status,403);
  const profile=await request('/candidate-profile');
  assert.equal(profile.status,200);
  assert.equal(profile.body.revision,0);
});
test('profile import is a preview and enforces source ownership',async()=>{
  assert.equal((await request('/candidate-profile/import','POST',{resumeId:'resume-http-b',resumeRevision:1,profileRevision:0})).status,404);
  const preview=await request('/candidate-profile/import','POST',{resumeId:'resume-http-a',resumeRevision:1,profileRevision:0});
  assert.equal(preview.status,200);
  assert.ok(preview.body.facts.length>0);
  assert.ok(preview.body.facts.every(f=>f.status!=='confirmed'));
  assert.equal((await request('/candidate-profile')).body.revision,0);
});
test('manual submissions are idempotent archives independent of later source changes',async()=>{
  const body={requestId:'00000000-0000-4000-8000-000000000044',resumeId:'resume-http-a',resumeRevision:1,materialId:null,
    jdSnapshotFrom:'current_catalog',submittedFields:[],submittedAt:'2026-10-23T03:00:00Z',channel:'official_portal',confirmedSubmitted:true};
  const created=await request('/applications/app-http-a/submissions','POST',body);
  assert.equal(created.status,201,JSON.stringify(created.body));
  const retry=await request('/applications/app-http-a/submissions','POST',body);
  assert.ok([200,201].includes(retry.status));
  assert.equal(retry.body.id,created.body.id);
  db.prepare("UPDATE resumes SET data=?,revision=2 WHERE id='resume-http-a'").run(JSON.stringify({basics:{name:'later'}}));
  const archive=await request('/submissions/'+created.body.id);
  assert.equal(archive.status,200);
  assert.ok(JSON.stringify(archive.body).includes('合成测试姓名'));
  assert.equal(db.prepare('SELECT status FROM applications WHERE id=?').get('app-http-a').status,'applied');
  assert.equal((await request('/applications/app-http-b/submissions','POST',{...body,requestId:'00000000-0000-4000-8000-000000000055'})).status,404);
});
test('version two personal export includes workflow records but excludes credentials',async()=>{
  const out=await request('/export');
  assert.equal(out.status,200);
  assert.equal(out.body.format,'offerbiu-user-data-v2');
  const serialized=JSON.stringify(out.body);
  assert.ok(!serialized.includes(process.env.DEEPSEEK_API_KEY));
  assert.ok(!serialized.includes('key_encrypted'));
  assert.ok(!serialized.includes('password_hash'));
  assert.ok(out.body.submissions || out.body.application_submissions);
});


test('historical resume preview is owned and matches the selected version',async()=>{
  const historical=await request('/resumes/resume-http-a/versions/1');
  assert.equal(historical.status,200);
  assert.equal(historical.body.revision,1);
  assert.equal(historical.body.data.basics.name,'合成测试姓名');
  assert.equal((await request('/resumes/resume-http-b/versions/1')).status,404);
});

test('submission confirmation freezes the previewed catalog version or reports a conflict',async()=>{
  const preview=await request('/applications/app-http-a/submission-preview');
  assert.equal(preview.status,200);
  assert.match(preview.body.jobHash,/^[a-f0-9]{64}$/);
  assert.equal((await request('/applications/app-http-b/submission-preview')).status,404);
  const row=db.prepare('SELECT payload FROM jobs WHERE id=?').get('job-demo');
  const job=JSON.parse(row.payload);
  db.prepare('UPDATE jobs SET payload=? WHERE id=?').run(JSON.stringify({...job,description:'预览之后更新的岗位正文'}),job.id);
  const body={requestId:'00000000-0000-4000-8000-000000000066',resumeId:'resume-http-a',resumeRevision:1,materialId:null,
    jdSnapshotFrom:'current_catalog',expectedJobHash:preview.body.jobHash,submittedFields:[],submittedAt:'2026-10-23T03:00:00Z',channel:'official_portal',confirmedSubmitted:true};
  const rejected=await request('/applications/app-http-a/submissions','POST',body);
  assert.equal(rejected.status,409);
  assert.equal(rejected.body.code,'SUBMISSION_PREVIEW_CHANGED');
  const fresh=await request('/applications/app-http-a/submission-preview');
  const created=await request('/applications/app-http-a/submissions','POST',{...body,expectedJobHash:fresh.body.jobHash});
  assert.equal(created.status,201);
  assert.equal(created.body.snapshot.job.description,'预览之后更新的岗位正文');
  const replay=await request('/applications/app-http-a/submissions','POST',{...body,expectedJobHash:fresh.body.jobHash});
  assert.equal(replay.status,200);
  assert.equal(replay.body.id,created.body.id);
});
