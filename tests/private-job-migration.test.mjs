import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {migratePrivateJobTargets} from '../server/migrations/private-job-targets.mjs';

function legacy(){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY);
    CREATE TABLE jobs(id TEXT PRIMARY KEY);
    CREATE TABLE resumes(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));
    CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE applications (
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      job_id TEXT NOT NULL REFERENCES jobs(id),status TEXT NOT NULL DEFAULT 'saved',
      resume_id TEXT REFERENCES resumes(id) ON DELETE SET NULL,resume_revision INTEGER,
      resume_snapshot TEXT,notes TEXT NOT NULL DEFAULT '',applied_at TEXT,next_date TEXT,
      created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,job_id)
    );
    CREATE TABLE tasks(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),application_id TEXT REFERENCES applications(id) ON DELETE SET NULL);
    CREATE TABLE application_events(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),application_id TEXT REFERENCES applications(id) ON DELETE CASCADE,payload TEXT);
    CREATE INDEX applications_user_idx ON applications(user_id,status);
    CREATE INDEX custom_application_notes_idx ON applications(notes);
    CREATE TRIGGER retained_application_trigger AFTER UPDATE OF notes ON applications BEGIN UPDATE applications SET updated_at='triggered' WHERE id=NEW.id; END;`);
  db.exec(fs.readFileSync(new URL('../server/migrations/001-job-workflow.sql',import.meta.url),'utf8'));
  return db;
}
function insert(db,table,values){
  const data={...values};
  for(const column of db.prepare(`PRAGMA table_info(${table})`).all())if(column.notnull&&column.dflt_value===null&&!Object.hasOwn(data,column.name))data[column.name]=column.name.endsWith('_json')?'{}':/INT|REAL/.test(column.type)?1:'fixture';
  const columns=Object.keys(data);db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`).run(...Object.values(data));
}
test('populated legacy migration preserves every parent, child, FK, custom index and trigger; repeats safely',()=>{
  const db=legacy();
  insert(db,'users',{id:'alice'});insert(db,'users',{id:'bob'});insert(db,'jobs',{id:'public-job'});insert(db,'resumes',{id:'resume',user_id:'alice'});
  insert(db,'applications',{id:'application',user_id:'alice',job_id:'public-job',resume_id:'resume',resume_revision:1,resume_snapshot:'{"original":"resume"}'});
  insert(db,'job_evaluations',{id:'evaluation',user_id:'alice',job_id:'public-job',gate_state:'needs_review',inputs_json:'{"original":"jd"}'});
  insert(db,'application_materials',{id:'material',user_id:'alice',application_id:'application',evaluation_id:'evaluation',source_resume_id:'resume'});
  insert(db,'application_submissions',{id:'submission',user_id:'alice',application_id:'application',resume_id:'resume',material_id:'material',snapshot_json:'{"original":"submission"}'});
  insert(db,'tasks',{id:'task',user_id:'alice',application_id:'application'});
  insert(db,'application_events',{id:'event',user_id:'alice',application_id:'application',payload:'{"original":"event"}'});
  const tables=['applications','job_evaluations','application_materials','application_submissions','tasks','application_events','resumes'];
  const before=new Map(tables.map(table=>[table,db.prepare(`SELECT * FROM ${table}`).all().map(r=>({...r}))]));
  const foreignKeys=new Map(tables.map(table=>[table,db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(r=>({...r}))]));
  migratePrivateJobTargets(db);
  for(const table of tables){const rows=db.prepare(`SELECT * FROM ${table}`).all().map(({private_job_id,...r})=>r);assert.deepEqual(rows,before.get(table),table);}
  for(const table of tables.filter(t=>!['applications','job_evaluations'].includes(t)))assert.deepEqual(db.prepare(`PRAGMA foreign_key_list(${table})`).all().map(r=>({...r})),foreignKeys.get(table),table);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='custom_application_notes_idx'").get());
  db.prepare("UPDATE applications SET notes='changed' WHERE id='application'").run();assert.equal(db.prepare("SELECT updated_at FROM applications WHERE id='application'").get().updated_at,'triggered');
  const schema=db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();migratePrivateJobTargets(db);assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(),schema);
  insert(db,'private_jobs',{id:'private:one',user_id:'alice',payload:'{}'});
  insert(db,'applications',{id:'private-application',user_id:'alice',job_id:null,private_job_id:'private:one'});
  assert.throws(()=>insert(db,'applications',{id:'wrong-owner',user_id:'bob',job_id:null,private_job_id:'private:one'}),/FOREIGN KEY/);
  assert.throws(()=>insert(db,'applications',{id:'two-targets',user_id:'alice',job_id:'public-job',private_job_id:'private:one'}),/CHECK/);
  assert.throws(()=>insert(db,'job_evaluations',{id:'wrong-owner-eval',user_id:'bob',job_id:null,private_job_id:'private:one',gate_state:'needs_review'}),/FOREIGN KEY/);
  db.prepare("DELETE FROM job_evaluations WHERE id='evaluation'").run();assert.equal(db.prepare("SELECT evaluation_id FROM application_materials WHERE id='material'").get().evaluation_id,null);
  db.prepare("DELETE FROM applications WHERE id='application'").run();for(const table of ['application_materials','application_submissions','application_events'])assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n,0);assert.equal(db.prepare("SELECT application_id FROM tasks WHERE id='task'").get().application_id,null);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.close();
});

test('migration failures roll back all schema changes and always restore FK enforcement',()=>{
  const db=legacy();db.exec('PRAGMA foreign_keys=OFF; DROP TABLE applications; CREATE TABLE applications(id TEXT PRIMARY KEY,job_id TEXT); PRAGMA foreign_keys=ON;');
  const before=db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all();
  assert.throws(()=>migratePrivateJobTargets(db),/Unknown job reference schema/);
  assert.deepEqual(db.prepare("SELECT name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(),before);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);assert.equal(db.prepare("SELECT value FROM metadata WHERE key='private_jobs_schema_version'").get(),undefined);db.close();
});
