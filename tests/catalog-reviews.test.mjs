import test from 'node:test';
import assert from 'node:assert/strict';
import { jobReviewHash,applyReviewedJob } from '../server/catalog-reviews.mjs';
const job={id:'demo',company:'演示',title:'开发',description:'接口开发。',requirements:'掌握 Python。',catalog_status:'active',source_url:'https://example.com/jobs/demo'};
const review={job_id:'demo',content_quality:{level:'complete',reason:'人工核对快照正文'},availability:{state:'unknown'},eligibility_constraints:[]};
test('quality annotations only apply to the exact reviewed public text snapshot',()=>{
  const annotated=applyReviewedJob(job,{...review,source_hash:jobReviewHash(job)});
  assert.equal(annotated.content_quality.level,'complete');
  assert.equal(annotated.catalog_status,'active');
  assert.equal(job.content_quality,undefined);
  const changed={...job,requirements:'掌握 Rust。'};
  assert.equal(applyReviewedJob(changed,{...review,source_hash:jobReviewHash(job)}).content_quality,undefined);
});
test('only positive closed evidence changes catalog eligibility, never unknown',()=>{
  const annotated=applyReviewedJob(job,{...review,source_hash:jobReviewHash(job),availability:{state:'closed',evidence_quote:'该岗位停止招聘',evidence_url:job.source_url,checked_at:new Date().toISOString(),method:'manual_official_text',http_status:200}});
  assert.equal(annotated.catalog_status,'withdrawn');
  const unverified=applyReviewedJob(job,{...review,source_hash:jobReviewHash(job),availability:{state:'closed',evidence_quote:'该岗位停止招聘'}});
  assert.equal(unverified.catalog_status,'active');
  assert.equal(applyReviewedJob(job,{...review,job_id:'other',source_hash:jobReviewHash(job)}).catalog_status,'active');
});
