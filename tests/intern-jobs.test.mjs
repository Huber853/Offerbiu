import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import { setupTestEnv, fixtureJob } from './test-env.mjs';

setupTestEnv();
const { db } = await import('../server/db.mjs');
const { acceptsJob } = await import('../server/job-policy.mjs');
const { handleRequest } = await import('../server/routes.mjs');

const bundle = JSON.parse(fs.readFileSync(new URL('../data/jobs-2027.json', import.meta.url), 'utf8'));
const campus = structuredClone(bundle.jobs.find(job => job.company === '腾讯' && acceptsJob(job)));

test('internship titles stay out of the full-time catalog unless recruit type is explicit', () => {
  assert.ok(campus);
  assert.equal(acceptsJob(campus), true);
  const intern = structuredClone(campus);
  intern.title = '后端开发实习生';
  intern.recruit_type = '实习';
  intern.employment_type = '实习';
  intern.batch = '日常实习';
  intern.cohort_evidence = '官方实习项目：日常实习；面向在校生。';
  assert.equal(acceptsJob(intern), true);
  intern.recruit_type = '校招';
  assert.equal(acceptsJob(intern), false);
  delete intern.recruit_type;
  assert.equal(acceptsJob(intern), false);
  intern.recruit_type = '实习';
  intern.title = '兼职设计师';
  assert.equal(acceptsJob(intern), false);
  intern.title = '2027校园招聘公告';
  assert.equal(acceptsJob(intern), false);
  intern.title = '校园大使';
  assert.equal(acceptsJob(intern), false);
});

fixtureJob(db, { id: 'campus-1', title: '后端开发', recruit_type: '校招' });
fixtureJob(db, { id: 'legacy-1', title: '算法工程师' });
fixtureJob(db, { id: 'intern-1', title: '后端开发实习生', recruit_type: '实习' });
const server = http.createServer(handleRequest);
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
test.after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

async function titles(query) {
  const response = await fetch(base + '/api/jobs?' + query);
  assert.equal(response.status, 200);
  const body = await response.json();
  return body.items.map(job => job.id).sort();
}

test('recruit type filter separates internships from campus jobs and legacy rows', async () => {
  assert.deepEqual(await titles('record_type=job'), ['campus-1', 'intern-1', 'legacy-1']);
  assert.deepEqual(await titles('record_type=job&recruit_type=' + encodeURIComponent('实习')), ['intern-1']);
  assert.deepEqual(await titles('record_type=job&recruit_type=' + encodeURIComponent('校招')), ['campus-1', 'legacy-1']);
});
