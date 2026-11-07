import test from 'node:test';
import assert from 'node:assert/strict';
import { jobReviewHash,applyReviewedJob,mergeEvidenceReview,mergeCatalogJobs } from '../server/catalog-reviews.mjs';
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
test('evidence merge keeps reviewed text when a new probe is unknown and rejects weak available claims',()=>{
  const hash=jobReviewHash(job);
  const checked=new Date().toISOString();
  const current={job_id:job.id,source_hash:hash,reviewed_at:checked,review_basis:'人工',content_quality:{level:'complete',reason:'正文已核对'},availability:{state:'unknown',reason:'之前未知',evidence_quote:null,checked_at:checked,method:'public_page_text',http_status:200,evidence_url:job.source_url,last_available_at:null},eligibility_constraints:[{id:'degree'}]};
  const unknown=mergeEvidenceReview(job,current,{job_id:job.id,source_hash:hash,checked_at:checked,content_quality:{level:'unknown',reason:'页面没有正文'},availability:{state:'unknown',checked_at:checked,method:'public_page_text',http_status:200,evidence_url:job.source_url,evidence_quote:null,reason:'没有在招用语'}});
  assert.equal(unknown.review.content_quality.level,'complete');
  assert.equal(unknown.review.eligibility_constraints.length,1);
  assert.equal(unknown.review.availability.state,'unknown');
  const weak=mergeEvidenceReview(job,current,{job_id:job.id,source_hash:hash,content_quality:{level:'unknown',reason:'无'},availability:{state:'available',checked_at:checked,method:'public_page_text',http_status:200,evidence_quote:'立即申请',evidence_url:'https://evil.example/job'}});
  assert.equal(weak.review.availability.state,'unknown');
  const strong=mergeEvidenceReview(job,current,{job_id:job.id,source_hash:hash,content_quality:{level:'complete',reason:'公开页面包含采集正文开头片段',reference_urls:[job.source_url]},availability:{state:'available',checked_at:checked,method:'public_page_text',http_status:200,evidence_quote:'立即申请',evidence_url:job.source_url}});
  assert.equal(strong.review.availability.state,'available');
  assert.equal(strong.review.content_quality.level,'complete');
  assert.equal(mergeEvidenceReview(job,current,{job_id:job.id,source_hash:'ab'.repeat(32)}).action,'skipped');
});
test('supplement jobs never replace an existing catalog id',()=>{
  const merged=mergeCatalogJobs([{id:'keep',title:'旧'}],[{id:'keep',title:'新'},{id:'fresh',title:'补充'}]);
  assert.equal(merged.added,1);
  assert.equal(merged.jobs.find(item=>item.id==='keep').title,'旧');
  assert.equal(merged.jobs.find(item=>item.id==='fresh').title,'补充');
});
