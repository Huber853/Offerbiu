import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function setupTestEnv() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'offerbiu-workflow-'));
  const catalog = path.join(folder, 'catalog.json');
  fs.writeFileSync(catalog, JSON.stringify({ collected_at: 'test-fixture-v1', jobs: [] }));
  process.env.OFFERBIU_STORAGE = folder;
  process.env.OFFERBIU_DB = path.join(folder, 'test.sqlite');
  process.env.OFFERBIU_JOB_SOURCE = catalog;
  process.env.DEEPSEEK_API_KEY = 'test-fixture-key-never-send-to-network';
  process.env.NODE_ENV = 'test';
  return folder;
}
export function fixtureUser(db, name = 'alice') {
  db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)')
    .run(name, name+'@example.test', name, 'not-a-real-password-hash', new Date().toISOString());
  return name;
}
export function fixtureJob(db, changes = {}) {
  const row = { id:'job-demo', company:'示例公司', title:'后端开发', cities:['西安'], category:'软件研发',
    cohort:2027, description:'负责 Python API 开发。', requirements:'熟悉 Python 和 SQLite。',
    education:'本科及以上', deadline:null, source_url:'https://example.test/job/demo',
    apply_url:'https://example.test/job/demo', content_quality:{level:'complete',reason:'人工验收夹具'},
    availability:{state:'unknown',checked_at:null}, ...changes };
  db.prepare('INSERT INTO jobs(id,company,title,cities,category,cohort,payload,collected_at,catalog_active) VALUES(?,?,?,?,?,?,?,?,1)')
    .run(row.id,row.company,row.title,row.cities.join('/'),row.category,row.cohort,JSON.stringify(row),new Date().toISOString());
  return row;
}
export function fixtureResume(db, userId, resumeId = 'resume-'+userId) {
  const data = { basics:{name:'合成测试姓名',email:'private@example.test',phone:'13800000000',headline:'后端开发',city:'西安',website:'',summary:'课程项目开发实践。'},
    education:[{school:'示例大学',degree:'本科',major:'软件工程',start:'2023-09',end:'2027-06',details:'软件工程课程学习。'}],
    experience:[],projects:[{name:'课程项目',role:'开发',start:'2026-01',end:'2026-06',details:'在课程项目中负责 Python API 开发和 SQLite 数据保存。'}],
    skills:'Python\nSQLite',awards:'' };
  const time=new Date().toISOString();
  db.prepare('INSERT INTO resumes(id,user_id,title,template,data,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)')
    .run(resumeId,userId,'测试简历','technical',JSON.stringify(data),time,time);
  db.prepare('INSERT INTO resume_versions(id,resume_id,revision,title,template,data,reason,created_at) VALUES(?,?,1,?,?,?,?,?)')
    .run('version-'+resumeId,resumeId,'测试简历','technical',JSON.stringify(data),'测试夹具',time);
  return {id:resumeId,user_id:userId,title:'测试简历',template:'technical',data,revision:1,created_at:time,updated_at:time};
}
export function fixtureApplication(db,userId,jobId='job-demo',applicationId='app-'+userId) {
  const time=new Date().toISOString();
  db.prepare('INSERT INTO applications(id,user_id,job_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(applicationId,userId,jobId,time,time);
  return applicationId;
}
