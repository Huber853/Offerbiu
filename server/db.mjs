import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptsJob } from './job-policy.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STORAGE = path.join(ROOT, 'storage');
fs.mkdirSync(STORAGE, { recursive: true });
export const db = new DatabaseSync(path.join(STORAGE, 'offerbiu.sqlite'));
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
    model TEXT NOT NULL DEFAULT 'deepseek-flash', updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ai_reports (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL, resume_revision INTEGER NOT NULL,
    field_path TEXT NOT NULL, original TEXT NOT NULL, revised TEXT NOT NULL, changes TEXT NOT NULL,
    questions TEXT NOT NULL, target_job_id TEXT, snapshot TEXT NOT NULL, model TEXT NOT NULL,
    usage TEXT, applied_at TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS jobs_company_idx ON jobs(company);
  CREATE INDEX IF NOT EXISTS applications_user_idx ON applications(user_id, status);
  CREATE INDEX IF NOT EXISTS tasks_user_date_idx ON tasks(user_id, due_at);
  CREATE INDEX IF NOT EXISTS resumes_user_idx ON resumes(user_id);
  CREATE INDEX IF NOT EXISTS ai_reports_user_idx ON ai_reports(user_id, created_at);
`);

if (!db.prepare('PRAGMA table_info(jobs)').all().some(column => column.name === 'catalog_active')) {
  db.exec('ALTER TABLE jobs ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 0');
}

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = fn(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

const sourcePath = path.join(ROOT, 'data', 'jobs-2027.json');
if (fs.existsSync(sourcePath)) {
  const bundle = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const imported = db.prepare('SELECT value FROM metadata WHERE key=?').get('jobs_imported_at');
  if (imported?.value !== bundle.collected_at) {
    const upsert = db.prepare(`INSERT INTO jobs(id,company,title,cities,category,cohort,payload,collected_at) VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET company=excluded.company,title=excluded.title,cities=excluded.cities,category=excluded.category,cohort=excluded.cohort,payload=excluded.payload,collected_at=excluded.collected_at`);
    transaction(() => {
      for (const job of bundle.jobs) if (acceptsJob(job)) upsert.run(job.id, job.company, job.title, (job.cities || []).join(' / '), job.category || '综合', Number(job.cohort), JSON.stringify(job), job.collected_at);
      const { jobs, ...meta } = bundle;
      db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('jobs_metadata', JSON.stringify(meta));
      db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('jobs_imported_at', bundle.collected_at);
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

export function jobMetadata() {
  const row = db.prepare('SELECT value FROM metadata WHERE key=?').get('jobs_metadata');
  return row ? JSON.parse(row.value) : { count: 0, collected_at: null, companies: {}, limitations: '尚未导入岗位数据' };
}

export function unpackResume(row) { return row ? { ...row, data: JSON.parse(row.data) } : null; }
