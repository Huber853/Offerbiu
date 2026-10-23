import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptsJob, catalogDate } from './job-policy.mjs';
import { applyReviewedJob } from './catalog-reviews.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE = process.env.OFFERBIU_STORAGE ? path.resolve(process.env.OFFERBIU_STORAGE) : path.join(ROOT, 'storage');
fs.mkdirSync(STORAGE, { recursive: true });
// Tests and throwaway runs can point at a copy so the real database is never touched.
export const db = new DatabaseSync(process.env.OFFERBIU_DB || path.join(STORAGE, 'offerbiu.sqlite'));
db.exec(`
  PRAGMA journal_mode=WAL;
  PRAGMA foreign_keys=ON;
  PRAGMA busy_timeout=5000;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY, company TEXT NOT NULL, title TEXT NOT NULL, cities TEXT NOT NULL,
    category TEXT NOT NULL, cohort INTEGER NOT NULL, payload TEXT NOT NULL, collected_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resumes (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL, template TEXT NOT NULL, data TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS resume_versions (
    id TEXT PRIMARY KEY, resume_id TEXT NOT NULL REFERENCES resumes(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL, title TEXT NOT NULL, template TEXT NOT NULL, data TEXT NOT NULL,
    reason TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(resume_id, revision)
  );
  CREATE TABLE IF NOT EXISTS applications (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    job_id TEXT NOT NULL REFERENCES jobs(id), status TEXT NOT NULL DEFAULT 'saved',
    resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL, resume_revision INTEGER,
    resume_snapshot TEXT, notes TEXT NOT NULL DEFAULT '', applied_at TEXT, next_date TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id, job_id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT REFERENCES applications(id) ON DELETE SET NULL, title TEXT NOT NULL,
    kind TEXT NOT NULL, due_at TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, key_encrypted TEXT,
    model TEXT NOT NULL DEFAULT 'deepseek-flash', provider TEXT, base_url TEXT, updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_reports (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL, resume_revision INTEGER NOT NULL,
    field_path TEXT NOT NULL, original TEXT NOT NULL, revised TEXT NOT NULL, changes TEXT NOT NULL,
    questions TEXT NOT NULL, match_analysis TEXT, target_job_id TEXT, snapshot TEXT NOT NULL, model TEXT NOT NULL,
    usage TEXT, applied_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS application_events (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    application_id TEXT NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
    kind TEXT NOT NULL, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company);
  CREATE INDEX IF NOT EXISTS application_events_app_idx ON application_events(application_id, created_at);
  CREATE INDEX IF NOT EXISTS application_events_user_idx ON application_events(user_id, created_at);
  CREATE INDEX IF NOT EXISTS applications_user_idx ON applications(user_id, status);
  CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id, due_at);
  CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id);
  CREATE INDEX IF NOT EXISTS ai_reports_user_idx ON ai_reports(user_id, created_at);
`);

if (!db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'catalog_active')) {
  db.exec('ALTER TABLE jobs ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 0');
}

// Brought in when the AI layer gained multiple providers and match analysis.
for (const [table, column, ddl] of [
  ['ai_settings', 'provider', 'ALTER TABLE ai_settings ADD COLUMN provider TEXT'],
  ['ai_settings', 'base_url', 'ALTER TABLE ai_settings ADD COLUMN base_url TEXT'],
  ['ai_reports', 'match_analysis', 'ALTER TABLE ai_reports ADD COLUMN match_analysis TEXT'],
]) {
  if (!db.prepare(`PRAGMA table_info(${table})`).all().some(item => item.name === column)) db.exec(ddl);
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

const workflowSchema = Number(db.prepare('SELECT value FROM metadata WHERE key=?').get('workflow_schema_version')?.value || 0);
if (workflowSchema < 1) transaction(() => {
  db.exec(fs.readFileSync(new URL('./migrations/001-job-workflow.sql', import.meta.url), 'utf8'));
  db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('workflow_schema_version', '1');
});

const sourcePath = process.env.OFFERBIU_JOB_SOURCE ? path.resolve(process.env.OFFERBIU_JOB_SOURCE) : path.join(ROOT, 'data', 'jobs-2027.json');
if (fs.existsSync(sourcePath)) {
  const bundle = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const reviewsPath = path.join(ROOT, 'data', 'job-workflow-reviews.json');
  const reviews = !process.env.OFFERBIU_JOB_SOURCE && fs.existsSync(reviewsPath) ? JSON.parse(fs.readFileSync(reviewsPath, 'utf8')) : null;
  const reviewsById = new Map((reviews?.reviews || []).map(review => [review.job_id, review]));
  bundle.jobs = bundle.jobs.map(job => applyReviewedJob(job, reviewsById.get(job.id)));
  const importStamp = reviews ? `${bundle.collected_at}|${reviews.reviewed_at}` : bundle.collected_at;
  const imported = db.prepare('SELECT value FROM metadata WHERE key=?').get('jobs_imported_at');
  if (imported?.value !== importStamp) {
    const upsert = db.prepare(`INSERT INTO jobs(id,company,title,cities,category,cohort,payload,collected_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET company=excluded.company,title=excluded.title,cities=excluded.cities,category=excluded.category,cohort=excluded.cohort,payload=excluded.payload,collected_at=excluded.collected_at`);
    const existingJob = db.prepare('SELECT id FROM jobs WHERE id=?');
    transaction(() => {
      for (const job of bundle.jobs) {
        // Existing saved applications need the latest closure/deadline evidence.
        // Ignore only lifecycle fields here; retain every official source check.
        const accepted = acceptsJob(job);
        const validHistory = !accepted && ['active', 'withdrawn'].includes(job.catalog_status)
          && existingJob.get(job.id) && acceptsJob({ ...job, catalog_status: 'active', deadline: null });
        if (accepted || validHistory) upsert.run(job.id, job.company, job.title, (job.cities || []).join(' / '), job.category || '综合', Number(job.cohort), JSON.stringify(job), job.collected_at);
      }
      const { jobs, ...meta } = bundle;
      db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('jobs_metadata', JSON.stringify({ ...meta, workflow_reviewed_at: reviews?.reviewed_at || null, workflow_review_count: reviewsById.size }));
      db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('jobs_imported_at', importStamp);
    });
  }
  // Retain historical rows for saved applications, but never expose them in the live catalog.
  const activeIds = new Set(bundle.jobs.filter(acceptsJob).map(job => job.id));
  const update = db.prepare('UPDATE jobs SET catalog_active=? WHERE id=?');
  transaction(() => {
    for (const row of db.prepare('SELECT id,payload FROM jobs').all()) {
      const job = JSON.parse(row.payload);
      update.run(activeIds.has(row.id) && acceptsJob(job) ? 1 : 0, row.id);
    }
  });
}

let checkedDay = '';
export function refreshCatalog() {
  const day = catalogDate();
  if (day === checkedDay) return;
  db.prepare(`UPDATE jobs SET catalog_active=0 WHERE catalog_active=1
    AND json_extract(payload,'$.deadline') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
    AND substr(json_extract(payload,'$.deadline'),1,10) < ?`).run(day);
  checkedDay = day;
}

export function jobMetadata() {
  const row = db.prepare('SELECT value FROM metadata WHERE key=?').get('jobs_metadata');
  return row ? JSON.parse(row.value) : { count: 0, collected_at: null, companies: {}, limitations: '尚未导入岗位数据' };
}

let facetCache = null;
/** Facets for /api/meta — rebuilt only when the job import stamp changes. */
export function catalogFacets() {
  const stamp = db.prepare('SELECT value FROM metadata WHERE key=?').get('jobs_imported_at')?.value || '';
  const active = db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE cohort=2027 AND catalog_active=1').get().n;
  if (facetCache && facetCache.stamp === stamp && facetCache.active === active) return facetCache.payload;
  const rows = db.prepare('SELECT payload FROM jobs WHERE cohort=2027 AND catalog_active=1').all().map(row => JSON.parse(row.payload));
  const sorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const companies = sorted(rows.map(j => j.company)).map(company => ({ company, count: rows.filter(j => j.company === company).length }));
  const industries = sorted(rows.map(j => j.industry)).map(name => ({ name, count: rows.filter(j => j.industry === name).length }));
  const payload = {
    jobs: {
      ...jobMetadata(),
      count: rows.length,
      company_count: companies.length,
      industry_count: industries.length,
      job_count: rows.filter(j => j.record_type !== 'campaign').length,
      campaign_count: rows.filter(j => j.record_type === 'campaign').length,
      official_post_count: rows.filter(j => j.listing_kind === 'official_post').length,
      notice_role_count: 0,
      nwu_count: rows.filter(j => j.source_type === 'nwu_official').length,
      employer_count: rows.filter(j => j.source_type === 'employer_official').length,
    },
    companies,
    industries,
    companyNatures: sorted(rows.map(j => j.company_nature)),
    cities: sorted(rows.flatMap(j => j.cities || [])),
    categories: sorted(rows.flatMap(j => j.directions?.length ? j.directions : [j.category])),
    batches: sorted(rows.map(j => j.batch)),
  };
  facetCache = { stamp, active, payload };
  return payload;
}

export function unpackResume(row) { return row ? { ...row, data: JSON.parse(row.data) } : null; }
