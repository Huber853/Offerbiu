// Never rename the old parent: that would rewrite dependent history FKs.
export function migratePrivateJobTargets(db) {
  const version = Number(db.prepare('SELECT value FROM metadata WHERE key=?').get('private_jobs_schema_version')?.value || 0);
  if (version >= 2) return;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    db.exec('BEGIN IMMEDIATE');
    if (version < 1) {
    db.exec(`CREATE TABLE private_jobs (
      id TEXT PRIMARY KEY CHECK(id LIKE 'private:%'), user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL CHECK(revision >= 1), payload TEXT NOT NULL CHECK(json_valid(payload)),
      archived_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,id)
    );
    CREATE TABLE private_job_revisions (
      job_id TEXT NOT NULL, user_id TEXT NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
      reason TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(job_id,revision),
      FOREIGN KEY(user_id,job_id) REFERENCES private_jobs(user_id,id) ON DELETE CASCADE
    );
    CREATE INDEX private_jobs_user_idx ON private_jobs(user_id,archived_at,updated_at);`);
    for (const table of ['applications', 'job_evaluations']) {
      const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
      const indexes = db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL").all(table);
      const triggers = db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table);
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(c => '"' + c.name + '"').join(',');
      const replacement = schema.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`]?\w+["`]?/i, `CREATE TABLE ${table}_private_migration`)
        .replace(/job_id TEXT NOT NULL REFERENCES jobs\(id\)/i, 'job_id TEXT REFERENCES jobs(id), private_job_id TEXT')
        .replace(/\)\s*$/, `, CHECK ((job_id IS NULL) <> (private_job_id IS NULL)),
          FOREIGN KEY(user_id,private_job_id) REFERENCES private_jobs(user_id,id)
          ${table === 'applications' ? ', UNIQUE(user_id,private_job_id)' : ''})`);
      if (!replacement.includes('private_job_id TEXT')) throw new Error('Unknown job reference schema: ' + table);
      db.exec(replacement);
      db.exec(`INSERT INTO ${table}_private_migration(${columns}) SELECT ${columns} FROM ${table};
        DROP TABLE ${table}; ALTER TABLE ${table}_private_migration RENAME TO ${table};`);
      for (const item of [...indexes, ...triggers]) db.exec(item.sql);
      db.exec(`CREATE INDEX ${table}_private_job_idx ON ${table}(user_id,private_job_id)`);
    }
    }
    db.exec(`CREATE TABLE private_job_requests (
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      request_key TEXT NOT NULL, request_hash TEXT NOT NULL, job_id TEXT NOT NULL,
      PRIMARY KEY(user_id,request_key)
    )`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Private job migration failed foreign key validation');
    db.prepare('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)').run('private_jobs_schema_version', '2');
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  finally { db.exec('PRAGMA foreign_keys=ON'); }
}
