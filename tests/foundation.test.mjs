import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { setupTestEnv } from './test-env.mjs';
const folder = setupTestEnv();
const { db, STORAGE } = await import('../server/db.mjs');

test('workflow migration adds all four tables to an existing compatible database', () => {
  const names = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  for (const table of ['candidate_profiles','job_evaluations','application_materials','application_submissions'])
    assert.ok(names.has(table), 'missing workflow table: '+table);
  assert.equal(db.prepare('SELECT value FROM metadata WHERE key=?').get('workflow_schema_version')?.value,'1');
});
test('test overrides keep storage and public catalog isolated', () => {
  assert.equal(STORAGE,folder);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM jobs').get().n,0);
});
test('reopening migration preserves existing records and does not repeat DDL',async()=>{
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run('kept','kept@example.test','kept','fixture',new Date().toISOString());
  const second=await import('../server/db.mjs?migration-reopen=1');
  assert.equal(second.db.prepare('SELECT name FROM users WHERE id=?').get('kept').name,'kept');
  assert.equal(second.db.prepare('SELECT value FROM metadata WHERE key=?').get('workflow_schema_version').value,'1');
  second.db.close();
});
