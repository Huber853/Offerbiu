import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { setupTestEnv, fixtureUser, fixtureJob, fixtureResume } from './test-env.mjs';
setupTestEnv();
const {db}=await import('../server/db.mjs');
const jobs=await import('../server/private-jobs.mjs');
const {safePublicIp,publicUrl,fetchPublicPage}=await import('../server/private-job-fetch.mjs');
const {resolveJob,targetColumns}=await import('../server/job-targets.mjs');
const evaluations=await import('../server/job-evaluation.mjs');
const profiles=await import('../server/candidate-profile.mjs');
const materials=await import('../server/application-materials.mjs');
const submissions=await import('../server/application-submissions.mjs');
const {polishResume}=await import('../server/ai.mjs');
let sequence=0;
const owner=()=>fixtureUser(db,'private-user-'+(++sequence));
const fail=(status,code)=>error=>error.status===status&&(!code||error.code===code);
const body=(extra={})=>({company:'私人示例公司',title:'后端开发',cities:['西安'],cohort:2027,description:'负责 Python API 开发。',requirements:'熟悉 Python 和 SQLite。',confirmed:true,...extra});
const publicLookup=async()=>[{address:'93.184.216.34',family:4}];

test('manual/text preview preserves original, leaves unknowns empty and never creates public or private records',async()=>{
  const user=owner(),text=' 公司：示例\n岗位：后端开发\n城市：西安，成都\n届别：2027届\n岗位职责：\n负责 API 开发。\n任职要求：\n熟悉 Python。\n';
  const preview=await jobs.previewPrivateJob(user,{mode:'text',text});
  assert.equal(preview.draft.company,'示例');assert.deepEqual(preview.draft.cities,['西安','成都']);assert.equal(preview.draft.cohort,2027);
  assert.equal(preview.draft.deadline,'');assert.equal(preview.draft.original_text,text);assert.equal(preview.provenance.reviewed,false);
  assert.equal(jobs.listPrivateJobs(user).total,0);
  const manual=await jobs.previewPrivateJob(user,{mode:'manual',fields:{title:'仅知道岗位'}});assert.equal(manual.draft.title,'仅知道岗位');
  const saved=jobs.savePrivateJob(user,{...preview.draft,confirmed:true,source_type:'employer_official',direct_apply_verified:true,eligibility_constraints:[{kind:'minimum_degree',value:'博士'}],availability:{state:'available'}});
  assert.equal(saved.original_text,text);assert.equal(saved.source_type,'private');assert.equal(saved.direct_apply_verified,false);assert.deepEqual(saved.eligibility_constraints,[]);assert.equal(saved.availability.state,'unknown');
  assert.equal(db.prepare('SELECT id FROM jobs WHERE id=?').get(saved.id),undefined);
  assert.throws(()=>jobs.savePrivateJob(user,{title:'未确认'}),fail(400));
});

test('public URL fixtures extract plain text and blocked/failed pages retain a manual fallback',async()=>{
  const user=owner(),seen=[];
  const request=async(url,address,_signal,maximum)=>{seen.push([url.href,address,maximum]);return {status:200,text:'<html><script>bad()</script><p>公司：网页公司</p><p>岗位：开发工程师</p><p>岗位职责：</p><p>负责 API &amp; 数据保存</p><p>任职要求：</p><p>熟悉 Python</p></html>'};};
  const result=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/job/1'},{lookup:publicLookup,request});
  assert.equal(result.draft.company,'网页公司');assert.equal(result.draft.title,'开发工程师');assert.ok(!result.draft.original_text.includes('bad()'));assert.ok(result.draft.description.includes('API & 数据保存'));assert.equal(seen[0][1].address,'93.184.216.34');
  const encoded=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/job/entities'},{lookup:publicLookup,request:async()=>({status:200,text:'<p>岗位职责：</p><p>负责 &amp;lt;b&amp;gt;API&#xD800;接口&amp;lt;/b&amp;gt;</p><p>任职要求：</p><p>熟悉 Python</p>'})});
  assert.ok(encoded.draft.description.includes('&lt;b&gt;API'));assert.equal(encoded.draft.description.includes('<b>'),false);
  for(const options of [{lookup:async()=>[{address:'10.0.0.1',family:4}],request},{lookup:publicLookup,request:async()=>{throw new Error('blocked')}}]) {
    const fallback=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/nope'},options);assert.ok(fallback.warning);assert.equal(fallback.draft.source_url,'https://example.com/nope');assert.equal(fallback.provenance.method,'url_only');
  }
  const blocked=await jobs.previewPrivateJob(user,{mode:'url',url:'https://127.0.0.1/'},{lookup:publicLookup,request});assert.equal(blocked.draft.source_url,'');assert.ok(blocked.warning);
  const link=jobs.savePrivateJob(user,{source_url:'https://example.com/only-link',confirmed:true});assert.equal(link.title,'');assert.equal(link.content_quality.level,'reference_only');
  assert.throws(()=>evaluations.currentJobInput(user,link.id),fail(400,'JD_INSUFFICIENT'));
});

test('SSRF guard rejects private/reserved IPv4 and IPv6, credentials, ports, rebinding and redirects',async()=>{
  for(const ip of ['127.0.0.1','10.1.2.3','172.16.1.1','192.168.1.1','169.254.169.254','0.0.0.0','100.64.1.1','224.0.0.1','192.0.2.5','198.18.0.1','203.0.113.1','::1','fe80::1','fd00::1','::ffff:7f00:1','2001:db8::1','2001:0db8::1','2002:7f00:1::','64:ff9b::127.0.0.1'])assert.equal(safePublicIp(ip),false,ip);
  for(const ip of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(safePublicIp(ip),true,ip);
  for(const url of ['http://example.com','https://localhost/','https://service.internal/','https://user:pass@example.com/','https://example.com:8443/','https://2130706433/','https://[::ffff:127.0.0.1]/'])assert.throws(()=>publicUrl(url),fail(400),url);
  let calls=0;
  await assert.rejects(fetchPublicPage('https://example.com',{lookup:async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}],request:async()=>{calls++;}}),fail(400));assert.equal(calls,0);
  await assert.rejects(fetchPublicPage('https://example.com',{lookup:publicLookup,request:async()=>{calls++;return {status:302,location:'https://10.0.0.1/admin'};}}),fail(400));assert.equal(calls,1);
  let hops=0;await assert.rejects(fetchPublicPage('https://example.com',{lookup:publicLookup,request:async()=>{hops++;return {status:302,location:'/again'};}}),fail(422));assert.equal(hops,4);
  const keepAlive=setTimeout(()=>{},100);try{await assert.rejects(fetchPublicPage('https://example.com',{lookup:()=>new Promise(()=>{}),timeout:5}),fail(422));}finally{clearTimeout(keepAlive);}
});

test('URL navigation/login shells stay reference-only and server preview preserves captured provenance',async()=>{
  const user=owner();
  for(const text of ['<nav>关于我们 公司介绍 人才招聘 联系我们</nav>','<div>请登录后查看职位详情，输入手机号码与验证码</div>','<div id="app">Loading jobs...</div><script>renderJob()</script>','<h2>岗位职责</h2><p>请登录后查看完整职位信息</p><input type="password">']){
    const result=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/shell'},{lookup:publicLookup,request:async()=>({status:200,text})});
    assert.equal(result.draft.description,'');assert.equal(result.draft.requirements,'');assert.ok(result.warning);assert.equal(result.provenance.method,'url_reference');
  }
  const original='公司：保留原文公司\n岗位：后端\n岗位职责：\n负责 API 开发。\n任职要求：\n熟悉 Python。';
  const preview=await jobs.previewPrivateJob(user,{mode:'text',text:original});
  const saved=jobs.savePrivateJob(user,{...preview.draft,previewId:preview.previewId,original_text:'本人编辑后的摘要',confirmed:true});
  assert.equal(saved.original_text,'本人编辑后的摘要');assert.equal(saved.sources[0].original_text,original);assert.equal(saved.sources[0].provenance,'text');assert.equal(saved.sources[0].verified_official,false);
  assert.throws(()=>jobs.savePrivateJob(owner(),{...preview.draft,previewId:preview.previewId,confirmed:true}),fail(409,'PREVIEW_EXPIRED'));
  const full=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/real'},{lookup:publicLookup,request:async()=>({status:200,text:'<p>岗位：后端开发</p><p>岗位职责：</p><p>负责 Python API 开发和 SQLite 数据保存。</p><p>任职要求：</p><p>熟悉数据库。</p><footer><a href="/login">登录</a></footer>'})});
  assert.equal(full.provenance.method,'public_https_text');assert.ok(full.draft.description.includes('Python'));
});

test('oversized extracted labels produce editable bounded preview and retain original text',async()=>{
  const user=owner(),original='公司：'+'很长公司'.repeat(80)+'\n岗位：'+'很长职位'.repeat(100)+'\n城市：'+'城市'.repeat(50)+'\n岗位职责：负责 API 开发。';
  const preview=await jobs.previewPrivateJob(user,{mode:'text',text:original});assert.ok(preview.warning);assert.equal(preview.draft.company.length,200);assert.equal(preview.draft.title.length,300);assert.equal(preview.draft.cities[0].length,80);assert.equal(preview.draft.original_text,original);
  assert.ok(jobs.savePrivateJob(user,{...preview.draft,confirmed:true,previewId:preview.previewId}).id);
});

test('a binary NUL-containing HTTP success falls back to an editable link-only preview',async()=>{
  const user=owner(),preview=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/binary'},{lookup:publicLookup,request:async()=>({status:200,text:'<p>岗位职责</p>\0binary'})});
  assert.ok(preview.warning);assert.equal(preview.provenance.method,'url_only');assert.equal(preview.draft.source_url,'https://example.com/binary');assert.equal(preview.draft.description,'');assert.equal(preview.draft.original_text,'');
  assert.equal(jobs.savePrivateJob(user,{...preview.draft,confirmed:true,previewId:preview.previewId}).content_quality.level,'reference_only');
});

test('HTTPS transport pins DNS, omits cookies and auth, enforces body/content limits',async t=>{
  const original=https.get;t.after(()=>{https.get=original;});let size=20,contentType='text/html',encoding;
  https.get=(url,options,onResponse)=>{
    assert.equal(options.agent,false);assert.deepEqual(Object.keys(options.headers).sort(),['Accept','Accept-Encoding','User-Agent']);
    options.lookup('example.com',{all:true},(err,addresses)=>{assert.equal(err,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
    options.lookup('example.com',{},(err,address,family)=>{assert.equal(address,'93.184.216.34');assert.equal(family,4);});
    const request=new EventEmitter();queueMicrotask(()=>{const response=Readable.from([Buffer.alloc(size,65)]);response.statusCode=200;response.headers={'content-type':contentType,...(encoding?{'content-encoding':encoding}:{})};onResponse(response);});return request;
  };
  assert.equal((await fetchPublicPage('https://example.com',{lookup:publicLookup,maximum:40})).text.length,20);
  size=41;await assert.rejects(fetchPublicPage('https://example.com',{lookup:publicLookup,maximum:40}),fail(422));
  size=10;contentType='application/pdf';await assert.rejects(fetchPublicPage('https://example.com',{lookup:publicLookup}),fail(422));
  contentType='text/html';encoding='gzip';await assert.rejects(fetchPublicPage('https://example.com',{lookup:publicLookup}),fail(422));
});

test('duplicate choices are explicit, URL/source IDs strong, fuzzy weak, no history merge and creation retries idempotent',()=>{
  const user=owner(),first=jobs.savePrivateJob(user,body({source_url:'https://example.com/jobs/one?utm_source=feed',source_id:'one'}));
  const app='dup-app-'+sequence,time=new Date().toISOString();db.prepare('INSERT INTO applications(id,user_id,job_id,private_job_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(app,user,...targetColumns(first.id),time,time);
  const candidate=body({source_url:'https://example.com/jobs/one?utm_source=other'});
  assert.equal(jobs.duplicateJobs(user,candidate)[0].strength,'strong');assert.throws(()=>jobs.savePrivateJob(user,candidate),fail(409,'DUPLICATE_REVIEW_REQUIRED'));
  const reuse=jobs.savePrivateJob(user,{...candidate,duplicateAction:'reuse',duplicateId:first.id,requestId:crypto.randomUUID()});assert.equal(reuse.id,first.id);
  const add={...candidate,original_text:'第二来源原文',duplicateAction:'add_source',duplicateId:first.id,requestId:crypto.randomUUID()};
  const added=jobs.savePrivateJob(user,add);assert.equal(added.revision,2);assert.equal(added.sources.length,2);assert.equal(jobs.savePrivateJob(user,add).revision,2);
  assert.throws(()=>jobs.savePrivateJob(user,{...add,original_text:'变化'}),fail(409,'IDEMPOTENCY_CONFLICT'));
  const separate={...candidate,duplicateAction:'keep_separate',requestId:crypto.randomUUID()};const saved=jobs.savePrivateJob(user,separate);assert.notEqual(saved.id,first.id);assert.equal(jobs.savePrivateJob(user,separate).id,saved.id);
  assert.equal(jobs.duplicateJobs(user,body({source_url:'https://elsewhere.com/different'})).find(j=>j.id===first.id).strength,'weak');
  assert.equal(jobs.duplicateJobs(user,body({title:'不同岗位',source_url:'https://example.com/another',source_id:'one'})).find(j=>j.id===first.id).strength,'strong');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM applications WHERE user_id=?').get(user).n,1);assert.equal(db.prepare('SELECT private_job_id FROM applications WHERE id=?').get(app).private_job_id,first.id);
  assert.equal(jobs.privateJobHistory(user,first.id).length,2);
  const other=owner();assert.equal(jobs.duplicateJobs(other,candidate).some(j=>j.id===first.id),false);
});

test('public duplicate reuse keeps official catalog unchanged and cannot append private source',()=>{
  const user=owner(),job=fixtureJob(db,{id:'public-duplicate',source_url:'https://example.com/public'}),draft=body({source_url:job.source_url});
  const before=db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload;
  assert.equal(jobs.duplicateJobs(user,draft).find(j=>j.id===job.id).job_type,'public');
  assert.equal(jobs.savePrivateJob(user,{...draft,duplicateAction:'reuse',duplicateId:job.id}).id,job.id);
  assert.throws(()=>jobs.savePrivateJob(user,{...draft,duplicateAction:'add_source',duplicateId:job.id}),fail(400));
  assert.equal(db.prepare('SELECT payload FROM jobs WHERE id=?').get(job.id).payload,before);
});

test('strong duplicate matches are retained before the thirty-candidate display limit',()=>{
  const user=owner(),draft=body({company:'候选排序公司',title:'候选排序岗位',duplicateAction:'keep_separate'});
  for(let i=0;i<30;i++)jobs.savePrivateJob(user,{...draft,source_url:`https://example.com/weak-${i}`});
  const strong=jobs.savePrivateJob(user,{...draft,source_url:'https://example.com/strong'});
  const matches=jobs.duplicateJobs(user,{...draft,source_url:'https://example.com/strong'});
  assert.equal(matches.length,30);assert.equal(matches[0].id,strong.id);assert.equal(matches[0].strength,'strong');
});

test('secondary source identifiers are scoped to their own URL hosts and stale targeted duplicate actions never create jobs',()=>{
  const user=owner(),first=jobs.savePrivateJob(user,body({company:'配对来源公司',source_url:'https://primary.example.com/a',source_id:'primary-id'}));
  const added=jobs.savePrivateJob(user,body({company:'配对来源公司',source_url:'https://secondary.example.com/b',apply_url:'https://primary.example.com/ats',source_id:'secondary-id',duplicateAction:'add_source',duplicateId:first.id}));assert.equal(added.sources.length,2);
  const candidates=jobs.duplicateJobs(user,body({company:'完全不同公司',title:'完全不同角色',source_url:'https://secondary.example.com/new',source_id:'secondary-id'}));assert.equal(candidates.find(j=>j.id===first.id)?.strength,'strong');
  assert.equal(jobs.duplicateJobs(user,body({company:'无关',title:'无关',source_url:'https://primary.example.com/new',source_id:'secondary-id'})).some(j=>j.id===first.id),false);
  const count=jobs.listPrivateJobs(user).total;
  for(const action of ['reuse','add_source'])assert.throws(()=>jobs.savePrivateJob(user,body({company:'无关',title:'无关',source_url:'https://unrelated.example.com/',duplicateAction:action,duplicateId:first.id})),fail(409));
  assert.equal(jobs.listPrivateJobs(user).total,count);
});

test('confirmed source URL corrections retain the captured preview URL separately',async()=>{
  const user=owner(),preview=await jobs.previewPrivateJob(user,{mode:'url',url:'https://example.com/old'},{lookup:publicLookup,request:async()=>({status:200,text:'<p>岗位：开发</p><p>岗位职责：</p><p>负责 Python API 开发与数据保存。</p>'})});
  const saved=jobs.savePrivateJob(user,{...preview.draft,source_url:'https://corrected.example.com/new',previewId:preview.previewId,confirmed:true});
  assert.equal(saved.sources[0].source_url,'https://corrected.example.com/new');assert.equal(saved.sources[0].captured_url,'https://example.com/old');
});

async function lifecycleFixture(t){
  const user=owner(),other=owner(),resume=fixtureResume(db,user),job=jobs.savePrivateJob(user,body({duplicateAction:'keep_separate'}));
  const imported=profiles.importProfile(user,{resumeId:resume.id,resumeRevision:1,profileRevision:0});
  const profile=profiles.saveProfile(user,{revision:0,preferences:{targetRoles:['后端开发'],preferredCities:['西安'],cityConstraint:'preferred',graduationDate:'2027-06',degree:'本科',major:'软件工程',languages:[]},facts:[
    {id:'education',kind:'education',entityKey:'school',text:'示例大学软件工程本科，2027年6月毕业。',source:{type:'manual'}},
    {...imported.facts.find(f=>f.kind==='project'),id:'project'},
  ],confirmPreferences:true,confirmedFactIds:['education','project']});
  const original=globalThis.fetch;let task='evaluation',requests=[];
  globalThis.fetch=async(_url,options)=>{const envelope=JSON.parse(options.body),input=JSON.parse(envelope.messages[1].content);requests.push(input);let output;
    if(task==='evaluation')output={schema_version:1,units:input.units.map(unit=>({requirement_id:unit.id,group:'skills',importance:'required',relation:'supported',fact_ids:['project'],evidence_quotes:['Python API 开发和 SQLite 数据保存'],reason:'已确认课程项目体现相关实践。'})),eligibility_candidates:[{kind:'minimum_degree',requirement_id:input.units[0].id,source_quote:input.units[0].text,reason:'自动提取条件仍需人工核实。'}],questions:[]};
    if(task==='draft')output={schema_version:1,patches:[{id:'patch-1',path:'projects.0.details',original:resume.data.projects[0].details,revised:'负责课程项目的 Python API 开发，使用 SQLite 实现数据保存。',fact_ids:['project'],fact_quotes:[{fact_id:'project',quote:'Python API 开发和 SQLite 数据保存'}],reason:'突出开发职责'}],form_fields:[{id:'field-1',type:'self_introduction',max_length:150,count_mode:'codepoints',text:'我有 Python API 开发和 SQLite 数据保存的课程项目实践。',fact_ids:['project'],fact_quotes:[{fact_id:'project',quote:'Python API 开发和 SQLite 数据保存'}]}],questions:[],warnings:[]};
    if(task==='review')output={schema_version:1,verdict:'passed',findings:[],checked_patch_ids:['patch-1'],checked_field_ids:['field-1']};
    if(task==='polish')output={revised:'负责课程项目的 Python API 开发，使用 SQLite 保存数据。',changes:[],questions:[],match:null};
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:10,completion_tokens:20}});
  };t.after(()=>{globalThis.fetch=original;});
  const evaluation=await evaluations.evaluateJob(user,{jobId:job.id,profileRevision:profile.revision,consent:true});
  return {user,other,resume,job,profile,evaluation,requests,setTask(value){task=value;}};
}

test('private job lists read URL query strings for search, archive and pages',()=>{
  const user=owner();
  const first=jobs.savePrivateJob(user,body({title:'搜索甲岗位',company:'甲公司',duplicateAction:'keep_separate',requestId:crypto.randomUUID()}));
  jobs.savePrivateJob(user,body({title:'搜索乙岗位',company:'乙公司',duplicateAction:'keep_separate',requestId:crypto.randomUUID()}));
  jobs.archivePrivateJob(user,first.id,{revision:first.revision,archived:true});
  const params=query=>jobs.listPrivateJobs(user,new URLSearchParams(query));
  assert.equal(params({archived:'archived'}).total,1);assert.equal(params({archived:'archived'}).items[0].id,first.id);
  assert.equal(params({archived:'active',q:'乙公司'}).total,1);assert.equal(params({archived:'active',q:'乙公司'}).items[0].title,'搜索乙岗位');
  assert.equal(params({archived:'all',q:'不存在'}).total,0);
  assert.equal(params({archived:'all',limit:'1',offset:'1'}).total,2);assert.equal(params({archived:'all',limit:'1',offset:'1'}).items.length,1);
  assert.equal(jobs.listPrivateJobs(user,{archived:'archived'}).total,1);
});

test('private evaluation → materials → independent review → resume adoption → immutable submission survives edits/archive',async t=>{
  const f=await lifecycleFixture(t),{user,job,resume,evaluation}=f;
  assert.equal(evaluations.latestEvaluationSummaries(user,[job.id]).items[0]?.id,evaluation.id);
  const other=jobs.savePrivateJob(user,body({title:'另一个私人岗位',company:'另一家公司',duplicateAction:'keep_separate',requestId:crypto.randomUUID()}));
  const source=db.prepare('SELECT * FROM job_evaluations WHERE id=?').get(evaluation.id);
  const copyId='eval-copy-'+sequence;
  db.prepare(`INSERT INTO job_evaluations(id,user_id,job_id,private_job_id,profile_revision,profile_hash,job_hash,rule_version,prompt_version,provider,model,endpoint_fingerprint,cache_key,gate_state,total_score,coverage,inputs_json,result_json,usage_json,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(copyId,source.user_id,null,other.id,source.profile_revision,source.profile_hash,source.job_hash,source.rule_version,source.prompt_version,source.provider,source.model,source.endpoint_fingerprint,source.cache_key+'-copy',source.gate_state,source.total_score,source.coverage,source.inputs_json,source.result_json,source.usage_json,source.created_at);
  const both=evaluations.latestEvaluationSummaries(user,[job.id,other.id]);
  assert.equal(both.items.length,2);assert.deepEqual(both.items.map(item=>item.jobId).sort(),[job.id,other.id].sort());
  db.prepare('DELETE FROM job_evaluations WHERE id=?').run(copyId);
  db.prepare('DELETE FROM private_jobs WHERE id=? AND user_id=?').run(other.id,user);
  assert.equal(evaluation.jobType,'private');assert.equal(evaluation.gateState,'needs_review');assert.ok(evaluation.inputs.units.every(u=>u.sourceType==='private_job'));assert.equal(evaluation.inputs.job.sourceType,'private');
  const again=await evaluations.evaluateJob(user,{jobId:job.id,profileRevision:1,consent:true});assert.equal(again.id,evaluation.id);assert.equal(again.cached,true);
  const app='lifecycle-'+sequence,time=new Date().toISOString();db.prepare('INSERT INTO applications(id,user_id,job_id,private_job_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(app,user,...targetColumns(job.id),time,time);
  f.setTask('draft');const draft=await materials.generateMaterials(user,app,{evaluationId:evaluation.id,resumeId:resume.id,resumeRevision:1,profileRevision:1,requestId:crypto.randomUUID(),acknowledgePendingConditions:true,fields:[{type:'self_introduction',maxLength:150,countMode:'codepoints'}],consent:true});
  f.setTask('review');const reviewed=await materials.reviewMaterial(user,draft.id,{version:1,consent:true});assert.equal(reviewed.reviewState,'passed');
  const adopted=materials.createMaterialResume(user,draft.id,{version:1,sourceResumeRevision:1,selectedPatchIds:['patch-1'],title:'私人岗位定制简历'});
  const adoptedId=adopted.resume.id;
  const preview=submissions.getSubmissionJobPreview(user,app);
  const archive=submissions.createSubmission(user,app,{requestId:crypto.randomUUID(),resumeId:adoptedId,resumeRevision:1,materialId:draft.id,jdSnapshotFrom:'current_catalog',expectedJobHash:preview.jobHash,submittedFields:[{sourceFieldId:'field-1',text:reviewed.content.form_fields[0].text}],submittedAt:'2026-11-09T09:00:00+08:00',channel:'private_channel',confirmedSubmitted:true});
  assert.equal(archive.snapshot.job.id,job.id);assert.equal(archive.snapshot.job.source_type,'private');assert.equal(archive.snapshot.submittedFields[0].reviewed,true);
  const serialized=JSON.stringify(archive.snapshot),edited=jobs.savePrivateJob(user,{...job,requirements:'熟悉其他数据库。',confirmed:true,revision:1},job.id);
  assert.equal(evaluations.getEvaluation(user,evaluation.id).stale,true);
  assert.throws(()=>jobs.savePrivateJob(user,{...edited,revision:1,confirmed:true},job.id),fail(409,'REVISION_CONFLICT'));
  jobs.archivePrivateJob(user,job.id,{revision:edited.revision,archived:true});
  assert.equal(JSON.stringify(submissions.getSubmission(user,archive.id).snapshot),serialized);assert.equal(jobs.listPrivateJobs(user).total,0);assert.equal(jobs.listPrivateJobs(user,{archived:'archived'}).total,1);
  await assert.rejects(evaluations.evaluateJob(user,{jobId:job.id,profileRevision:1,consent:true}),fail(409,'JOB_ARCHIVED'));
  f.setTask('polish');await assert.rejects(polishResume(user,{resumeId:resume.id,revision:1,field:'projects.0.details',jobId:job.id,consent:true}),fail(409,'JOB_ARCHIVED'));
  assert.equal(materials.getMaterial(user,draft.id).id,draft.id);assert.equal(jobs.privateJobHistory(user,job.id).length,3);
  const archived=resolveJob(user,job.id);jobs.archivePrivateJob(user,job.id,{revision:archived.revision,archived:false});
  const polished=await polishResume(user,{resumeId:resume.id,revision:1,field:'projects.0.details',jobId:job.id,consent:true});assert.equal(polished.target_job_id,job.id);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('private references enforce account ownership in operations and composite FKs',async t=>{
  const f=await lifecycleFixture(t);const {user,other,job,evaluation}=f;
  assert.equal(jobs.listPrivateJobs(other).total,0);assert.throws(()=>resolveJob(other,job.id),fail(404));assert.throws(()=>jobs.privateJobHistory(other,job.id),fail(404));
  assert.throws(()=>jobs.savePrivateJob(other,{...job,confirmed:true,revision:1},job.id),fail(404));assert.throws(()=>jobs.archivePrivateJob(other,job.id,{revision:1,archived:true}),fail(404));
  assert.throws(()=>evaluations.getEvaluation(other,evaluation.id),fail(404));assert.throws(()=>evaluations.currentJobInput(other,job.id),fail(404));assert.equal(evaluations.listEvaluations(other,{jobId:job.id}).total,0);
  const time=new Date().toISOString();assert.throws(()=>db.prepare('INSERT INTO applications(id,user_id,job_id,private_job_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('bad-private-owner',other,...targetColumns(job.id),time,time),/FOREIGN KEY/);
  assert.throws(()=>db.prepare('INSERT INTO applications(id,user_id,created_at,updated_at) VALUES(?,?,?,?)').run('bad-null-target',user,time,time),/CHECK/);
  assert.throws(()=>db.prepare('UPDATE job_evaluations SET user_id=? WHERE id=?').run(other,evaluation.id),/FOREIGN KEY/);
  assert.throws(()=>submissions.createSubmission(other,'not-owned',{}),fail(404));
});

test('private dates and locations never become verified hard failures or availability evidence',async t=>{
  const f=await lifecycleFixture(t);
  const changed=jobs.savePrivateJob(f.user,{...f.job,revision:1,deadline:'2000-01-01',cities:['深圳'],confirmed:true},f.job.id);
  const profile=profiles.getProfile(f.user);
  const updated=profiles.saveProfile(f.user,{revision:profile.revision,preferences:{...profile.preferences,cityConstraint:'required'},facts:profile.facts,confirmPreferences:true,confirmedFactIds:profile.facts.map(f=>f.id)});
  const result=await evaluations.evaluateJob(f.user,{jobId:changed.id,profileRevision:updated.revision,consent:true});
  assert.equal(result.availability,'unknown');assert.equal(result.gateState,'needs_review');assert.match(result.availabilityDetails.reason,/私人记录截止时间已过/);
  for(const kind of ['deadline','city'])assert.equal(result.result.gates.find(g=>g.kind===kind).state,'needs_review');
});

test('private HTTP routes isolate users, preserve canonical app IDs, archive restrictions and v3 export',async t=>{
  const {handleRequest}=await import('../server/routes.mjs'),{createSession}=await import('../server/security.mjs');
  const user=owner(),other=owner(),server=http.createServer(handleRequest);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>new Promise(r=>server.close(r)));const base='http://127.0.0.1:'+server.address().port;
  const sessions=new Map([user,other].map(who=>{let cookie;const csrf=createSession(who,{setHeader(_key,value){cookie=value.split(';')[0];}});return [who,{cookie,csrf}];}));
  const request=async(who,path,method='GET',data)=>{const session=sessions.get(who);const response=await fetch(base+'/api'+path,{method,headers:{Cookie:session.cookie,'X-CSRF-Token':session.csrf,'Content-Type':'application/json'},...(data?{body:JSON.stringify(data)}:{})});return {status:response.status,data:await response.json()};};
  const created=await request(user,'/private-jobs','POST',body({requestId:crypto.randomUUID(),duplicateAction:'keep_separate'}));assert.equal(created.status,201);const key=created.data.id;
  for(const [path,method,data] of [[`/private-jobs/${key}`,'GET'],[`/private-jobs/${key}/history`,'GET'],[`/private-jobs/${key}`,'PUT',body({revision:1})],[`/private-jobs/${key}/archive`,'POST',{revision:1,archived:true}],['/applications','POST',{jobId:key}]])assert.equal((await request(other,path,method,data)).status,404);
  const app=await request(user,'/applications','POST',{jobId:key});assert.equal(app.status,201);const listed=await request(user,'/applications');assert.equal(listed.data[0].job_id,key);assert.equal(listed.data[0].job.job_type,'private');
  const publicList=await request(user,'/jobs');assert.ok(publicList.data.items.every(j=>j.id!==key));
  assert.equal((await request(user,`/private-jobs/${key}/archive`,'POST',{revision:1,archived:true})).status,200);
  assert.equal((await request(user,'/applications','POST',{jobId:key})).status,409);
  assert.equal((await request(user,`/applications/${app.data.id}/submission-preview`)).status,200);
  const exported=await request(user,'/export');assert.equal(exported.data.format,'offerbiu-user-data-v3');assert.equal(exported.data.private_jobs.length,1);assert.equal(exported.data.private_job_revisions.length,2);assert.equal(exported.data.applications[0].job_id,key);
  assert.equal((await request(other,'/export')).data.private_jobs.length,0);
});
