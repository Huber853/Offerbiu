import test from 'node:test';
import assert from 'node:assert/strict';
import { setupTestEnv, fixtureUser, fixtureJob, fixtureResume } from './test-env.mjs';
setupTestEnv();
const { db } = await import('../server/db.mjs');
const { callJson, getAiTarget } = await import('../server/ai-client.mjs');
const { encrypt } = await import('../server/security.mjs');
for (const user of ['transport','busy','budget','custom']) fixtureUser(db,user);
const originalFetch=globalThis.fetch;
const response=(data={ok:true})=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(data)}}],usage:{total_tokens:12}}),{status:200});
const args={task:'test',system:'Return JSON.',input:{message:'合成测试资料'}};
test.after(()=>{globalThis.fetch=originalFetch;db.close();});
test('provider metadata never exposes a credential',async()=>{
  const target=await getAiTarget('transport');
  assert.equal(target.provider,'deepseek');
  assert.equal(target.model,process.env.DEEPSEEK_MODEL||'deepseek-flash');
  assert.ok(target.endpointFingerprint);
  assert.ok(!JSON.stringify(target).includes(process.env.DEEPSEEK_API_KEY));
});
test('JSON caller validates complete model output and releases its lock after invalid output',async()=>{
  globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'length',message:{content:'{"ok":'}}]}),{status:200});
  await assert.rejects(callJson('transport',args),e=>e.code==='AI_OUTPUT_INVALID');
  globalThis.fetch=async()=>response();
  const result=await callJson('transport',{...args,validate:data=>{assert.equal(data.ok,true);}});
  assert.deepEqual(result.data,{ok:true});
  assert.equal(result.usage.total_tokens,12);
});
test('all business callers share one user concurrency slot',async()=>{
  let entered,finish;
  const started=new Promise(r=>{entered=r;});
  globalThis.fetch=()=>{entered();return new Promise(r=>{finish=()=>r(response());});};
  const pending=callJson('busy',args);
  await started;
  await assert.rejects(callJson('busy',{...args,task:'other'}),e=>e.code==='AI_BUSY'&&e.status===429);
  finish();await pending;
});
test('business budget stops the thirty first actual call for one user',async()=>{
  globalThis.fetch=async()=>response();
  for(let i=0;i<30;i++) await callJson('budget',args);
  await assert.rejects(callJson('budget',args),e=>e.code==='AI_BUDGET_EXCEEDED'&&e.status===429);
});
test('custom provider never inherits the server DeepSeek key',async()=>{
  db.prepare('INSERT INTO ai_settings(user_id,provider,model,base_url,updated_at) VALUES(?,?,?,?,?)').run('custom','custom','test-model','https://example.com/v1',new Date().toISOString());
  await assert.rejects(callJson('custom',args),e=>e.code==='AI_NOT_CONFIGURED');
});
test('provider error details do not leak credential or upstream request body',async()=>{
  globalThis.fetch=async()=>new Response('secret detail '+process.env.DEEPSEEK_API_KEY,{status:401});
  await assert.rejects(callJson('transport',args),e=>e.code==='AI_UPSTREAM_ERROR'&&!e.message.includes(process.env.DEEPSEEK_API_KEY));
});

test('existing paragraph polish preserves its report contract through the shared caller',async()=>{
  fixtureUser(db,'legacy-polish');const resume=fixtureResume(db,'legacy-polish');const job=fixtureJob(db);
  const {polishResume}=await import('../server/ai.mjs');let sent;
  globalThis.fetch=async(_url,options)=>{sent=JSON.parse(options.body);return response({revised:'负责 Python API 开发，使用 SQLite 保存课程数据。',changes:['压缩重复表达'],questions:[],match:{score:60,matched:['Python'],missing:['测试经历尚未体现'],advice:'补充已确认的相关实践。'}});};
  const body={resumeId:resume.id,revision:1,field:'projects.0.details',jobId:job.id,tone:'concise',consent:true};
  const result=await polishResume('legacy-polish',body);
  assert.equal(result.match.score,60);assert.equal(result.field_path,'projects.0.details');assert.equal(result.model,'deepseek-flash');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM ai_reports WHERE user_id=?').get('legacy-polish').n,1);
  assert.equal(db.prepare('SELECT data FROM resumes WHERE id=?').get(resume.id).data,JSON.stringify(resume.data));
  const input=JSON.parse(sent.messages[1].content);assert.equal(input.selected_text,resume.data.projects[0].details);
  for(const secret of ['合成测试姓名','private@example.test','13800000000'])assert.ok(!JSON.stringify(input).includes(secret));
  await assert.rejects(polishResume('legacy-polish',{...body,revision:2}),e=>e.status===409);
});
