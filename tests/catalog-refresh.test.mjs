import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { acceptsJob } from '../server/job-policy.mjs';
import { applyReviewedJob, jobReviewHash } from '../server/catalog-reviews.mjs';

test('closed reviews update owned historical jobs without admitting withdrawn or untrusted rows', t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'offerbiu-catalog-refresh-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(folder).startsWith('offerbiu-catalog-refresh-'));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const catalog = path.join(folder, 'catalog.json');
  const bundle = JSON.parse(fs.readFileSync(new URL('../data/jobs-2027.json', import.meta.url), 'utf8'));
  const job = structuredClone(bundle.jobs.find(item => acceptsJob(item)));
  assert.ok(job, 'the public catalog must contain a source-policy-valid fixture');
  const checkedAt = new Date().toISOString();
  job.availability = { state: 'available', checked_at: checkedAt, method: 'manual_official_text', http_status: 200,
    evidence_url: job.source_url, evidence_quote: '同岗位目前可申请' };
  const env = { ...process.env, OFFERBIU_STORAGE: folder, OFFERBIU_DB: path.join(folder, 'test.sqlite'), OFFERBIU_JOB_SOURCE: catalog };
  const dbUrl = new URL('../server/db.mjs', import.meta.url).href;
  const evaluationUrl = new URL('../server/job-evaluation.mjs', import.meta.url).href;
  const run = body => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', `import {db} from ${JSON.stringify(dbUrl)};${body};db.close();`], { env, encoding: 'utf8', timeout: 30000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout.trim();
  };
  const publish = (jobs, revision) => fs.writeFileSync(catalog, JSON.stringify({ ...bundle, collected_at: 'catalog-refresh-' + revision, jobs }));
  publish([job], 1);
  run(`db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('owner','owner@example.test','测试称呼','unused','now');
    db.prepare('INSERT INTO applications(id,user_id,job_id,created_at,updated_at) VALUES(?,?,?,?,?)').run('app','owner',${JSON.stringify(job.id)},'now','now');`);
  const closed = applyReviewedJob(job, { job_id: job.id, source_hash: jobReviewHash(job),
    availability: { ...job.availability, state: 'closed', evidence_quote: '该岗位停止招聘' } });
  assert.equal(closed.catalog_status, 'withdrawn');
  const neverImported = { ...closed, id: job.id + '-never-imported' };
  publish([closed, neverImported], 2);
  const read = () => JSON.parse(run(`import {currentJobInput} from ${JSON.stringify(evaluationUrl)};
    const row=db.prepare('SELECT * FROM jobs WHERE id=?').get(${JSON.stringify(job.id)});
    console.log(JSON.stringify({active:row.catalog_active,payload:JSON.parse(row.payload),availability:currentJobInput('owner',row.id).job.availability.state,count:db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n}));`));
  const updated = read();
  assert.equal(updated.active, 0);
  assert.equal(updated.payload.availability.state, 'closed');
  assert.equal(updated.availability, 'closed');
  assert.equal(updated.count, 1, 'a newly seen withdrawn record must not enter jobs');
  publish([{ ...closed, source_url: 'https://untrusted.example.test/jobs/fake', description: '未验证来源的替换正文' }], 3);
  const unchanged = read();
  assert.deepEqual(unchanged.payload, closed, 'an existing ID cannot bypass official source validation');
  assert.equal(unchanged.active, 0);
});
