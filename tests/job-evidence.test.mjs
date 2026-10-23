import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyEvidence, selectExamples } from '../scripts/check-job-evidence.mjs';
const job={id:'demo',external_id:'123',title:'后端开发',company:'示例公司',source_url:'https://example.test/job/123',category:'软件研发'};
test('a successful response with no exact role evidence is still unknown',()=>{
  assert.equal(classifyEvidence(job,{status:200,url:job.source_url,text:'欢迎访问公司招聘首页。'}).state,'unknown');
});
test('unreachable or access controlled pages do not retire jobs',()=>{
  for(const status of [401,403,404,500]) assert.equal(classifyEvidence(job,{status,url:job.source_url,text:'职位已关闭'}).state,'unknown');
});
test('closed evidence must refer to the exact role or an explicit gone response',()=>{
  assert.equal(classifyEvidence(job,{status:200,url:job.source_url,text:'后端开发 职位已关闭'}).state,'closed');
  assert.equal(classifyEvidence(job,{status:410,url:job.source_url,text:''}).state,'closed');
  assert.equal(classifyEvidence(job,{status:200,url:'https://example.test/jobs',text:'后端开发 职位已关闭'}).state,'unknown');
});
test('available requires exact role and actual application wording',()=>{
  assert.equal(classifyEvidence(job,{status:200,url:job.source_url,text:'后端开发 岗位职责 立即申请'}).state,'available');
});
test('examples are deterministic and diversified rather than duplicate jobs',()=>{
  const jobs=Array.from({length:30},(_,i)=>({...job,id:'j'+i,company:'c'+(i%5),category:'g'+(i%3)}));
  const selected=selectExamples(jobs,20);
  assert.equal(selected.length,20);
  assert.equal(new Set(selected.map(j=>j.id)).size,20);
  assert.deepEqual(selected.map(j=>j.id),selectExamples(jobs,20).map(j=>j.id));
});
