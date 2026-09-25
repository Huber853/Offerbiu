import fs from 'node:fs';
import path from 'node:path';
import { db, ROOT, transaction, jobMetadata, unpackResume } from './db.mjs';
import { HttpError, demand, text, now, id, getSession, createSession, clearSession, passwordHash, passwordMatches, rateLimit, sanitizeResume, encrypt, resumeField } from './security.mjs';
import { aiSettings, guardBaseUrl, polishResume, PROVIDERS } from './ai.mjs';
import { blankResume, templates, statuses } from '../shared/templates.mjs';
import { RESUME_FILE_LIMIT } from '../shared/resume-media.mjs';

const statusIds = new Set(statuses.map(s => s.id));
const templateIds = new Set(templates.map(t => t.id));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.webp':'image/webp', '.json': 'application/json; charset=utf-8' };
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function readBody(req, limit = 300000) {
  demand((req.headers['content-type'] || '').startsWith('application/json'), 415, '请使用 JSON 提交数据。');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) { size += chunk.length; demand(size <= limit, 413, '提交内容过大，请减少图片或文字。'); chunks.push(chunk); }
  try { const data = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); demand(data && typeof data === 'object' && !Array.isArray(data), 400, '提交格式不正确。'); return data; }
  catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'JSON 格式不正确。'); }
}
function dateValue(value, optional = true) {
  if (!value && optional) return null;
  demand(typeof value === 'string' && value.length < 50 && !Number.isNaN(Date.parse(value)), 400, '日期格式不正确。');
  return new Date(value).toISOString();
}
function ownResume(userId, resumeId) {
  const row = unpackResume(db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(resumeId, userId));
  demand(row, 404, '简历不存在或无权访问。');
  return row;
}
function ownApplication(userId, applicationId) {
  const row = db.prepare('SELECT * FROM applications WHERE id=? AND user_id=?').get(applicationId, userId);
  demand(row, 404, '投递记录不存在或无权访问。');
  return row;
}
function snapshotResume(row, reason) {
  db.prepare('INSERT INTO resume_versions(id,resume_id,revision,title,template,data,reason,created_at) VALUES(?,?,?,?,?,?,?,?)')
    .run(id(), row.id, row.revision, row.title, row.template, JSON.stringify(row.data), reason, row.updated_at);
}
function saveResume(current, data, title, template, reason) {
  const updated = { ...current, data, title, template, revision: current.revision + 1, updated_at: now() };
  transaction(() => {
    db.prepare('UPDATE resumes SET data=?,title=?,template=?,revision=?,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(data), title, template, updated.revision, updated.updated_at, current.id, current.user_id);
    snapshotResume(updated, reason);
  });
  return updated;
}
function publicUser(session) { return session ? { id: session.user_id, name: session.name, email: session.email } : null; }
function unpackApplication(row) {
  const { job_payload, job_catalog_active, resume_snapshot, ...rest } = row;
  return { ...rest, job: job_payload ? { ...JSON.parse(job_payload), catalog_active: Boolean(job_catalog_active) } : null, has_resume_snapshot: Boolean(resume_snapshot) };
}
function applicationRows(userId) {
  return db.prepare(`SELECT a.*,j.payload AS job_payload,j.catalog_active AS job_catalog_active,r.title AS resume_title FROM applications a JOIN jobs j ON j.id=a.job_id
    LEFT JOIN resumes r ON r.id=a.resume_id WHERE a.user_id=? ORDER BY a.updated_at DESC`).all(userId).map(unpackApplication);
}

async function api(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;
  const session = getSession(req);
  if (!['GET', 'HEAD'].includes(method)) {
    const origin = req.headers.origin;
    const expected = process.env.APP_ORIGIN || `http://${req.headers.host}`;
    demand(!origin || origin === expected, 403, '跨来源请求被拒绝。');
    demand(req.headers['sec-fetch-site'] !== 'cross-site', 403, '跨站请求被拒绝。');
    if (session) demand(req.headers['x-csrf-token'] === session.csrf, 403, '会话校验失败，请刷新页面。');
  }
  const resumeWrite = session && ((method === 'POST' && pathname === '/api/resumes') || (method === 'PUT' && /^\/api\/resumes\/[^/]+$/.test(pathname)));
  const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ? await readBody(req, resumeWrite ? RESUME_FILE_LIMIT : 300000) : {};
  if (pathname === '/api/session' && method === 'GET') return json(res, { user: publicUser(session), csrf: session?.csrf || null });
  if (pathname === '/api/meta' && method === 'GET') {
    const rows = db.prepare('SELECT payload FROM jobs WHERE cohort=2027 AND catalog_active=1').all().map(row => JSON.parse(row.payload));
    const sorted = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const companies = sorted(rows.map(j => j.company)).map(company => ({ company, count: rows.filter(j => j.company === company).length }));
    const industries = sorted(rows.map(j => j.industry)).map(name => ({ name, count: rows.filter(j => j.industry === name).length }));
    const jobs = { ...jobMetadata(), count: rows.length, company_count: companies.length, industry_count: industries.length,
      job_count: rows.filter(j => j.record_type !== 'campaign').length, campaign_count: rows.filter(j => j.record_type === 'campaign').length,
      official_post_count: rows.filter(j => j.listing_kind === 'official_post').length,
      notice_role_count: 0, nwu_count: rows.filter(j => j.source_type === 'nwu_official').length,
      employer_count: rows.filter(j => j.source_type === 'employer_official').length };
    return json(res, { jobs, companies, industries, companyNatures: sorted(rows.map(j => j.company_nature)), cities: sorted(rows.flatMap(j => j.cities || [])),
      categories: sorted(rows.flatMap(j => j.directions?.length ? j.directions : [j.category])), batches: sorted(rows.map(j => j.batch)), templates, statuses });
  }
  if (pathname === '/api/auth/register' && method === 'POST') {
    rateLimit('register:' + req.socket.remoteAddress, 8, 3600000);
    const email = text(body.email, 254).toLowerCase();
    const name = text(body.name, 50);
    const password = body.password;
    demand(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 400, '请输入有效邮箱。');
    demand(name.length > 0, 400, '请填写称呼。');
    demand(typeof password === 'string' && password.length >= 8 && password.length <= 128, 400, '密码需要 8–128 个字符。');
    demand(!db.prepare('SELECT id FROM users WHERE email=?').get(email), 409, '该邮箱已注册，请登录。');
    const hash = await passwordHash(password);
    const userId = id();
    try { db.prepare('INSERT INTO users(id,email,name,password_hash,created_at) VALUES(?,?,?,?,?)').run(userId, email, name, hash, now()); }
    catch (error) { if (String(error.code).includes('CONSTRAINT')) throw new HttpError(409, '该邮箱已注册，请登录。'); throw error; }
    if (session) clearSession(session, res);
    const csrf = createSession(userId, res);
    return json(res, { user: { id: userId, name, email }, csrf }, 201);
  }
  if (pathname === '/api/auth/login' && method === 'POST') {
    rateLimit('login:' + req.socket.remoteAddress, 30, 900000);
    const email = text(body.email, 254).toLowerCase();
    demand(typeof body.password === 'string' && body.password.length <= 128, 400, '请输入密码。');
    const user = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    const valid = user && await passwordMatches(body.password, user.password_hash);
    demand(valid, 401, '邮箱或密码不正确。');
    if (session) clearSession(session, res);
    return json(res, { user: { id: user.id, name: user.name, email: user.email }, csrf: createSession(user.id, res) });
  }
  if (pathname === '/api/jobs' && method === 'GET') {
    const clauses = ['cohort=?', 'catalog_active=1'];
    const values = [2027];
    if (url.searchParams.get('company')) { clauses.push('company=?'); values.push(text(url.searchParams.get('company'), 100)); }
    for (const key of ['industry', 'batch', 'base_scope', 'source_type', 'company_nature']) if (url.searchParams.get(key)) {
      clauses.push(`json_extract(payload,'$.${key}')=?`); values.push(text(url.searchParams.get(key), 100));
    }
    if (url.searchParams.get('record_type')) { clauses.push("COALESCE(json_extract(payload,'$.record_type'),'job')=?"); values.push(text(url.searchParams.get('record_type'), 30)); }
    if (url.searchParams.get('category')) {
      clauses.push("(category=? OR EXISTS (SELECT 1 FROM json_each(jobs.payload,'$.directions') d WHERE d.value=?))");
      const direction = text(url.searchParams.get('category'), 100); values.push(direction, direction);
    }
    if (url.searchParams.get('city')) {
      clauses.push("EXISTS (SELECT 1 FROM json_each(jobs.payload,'$.cities') c WHERE c.value=?)"); values.push(text(url.searchParams.get('city'), 100));
    }
    const q = text(url.searchParams.get('q'), 100);
    if (q) { clauses.push('(title LIKE ? OR company LIKE ? OR cities LIKE ? OR payload LIKE ?)'); for (let i = 0; i < 4; i++) values.push('%' + q + '%'); }
    const where = clauses.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE ${where}`).get(...values).n;
    const limit = 15;
    const page = Math.max(1, Math.min(Math.max(1, Math.ceil(total / limit)), Number.parseInt(url.searchParams.get('page') || '1', 10) || 1));
    const orders = {
      recent: "COALESCE(json_extract(payload,'$.updated_at'),json_extract(payload,'$.published_at'),'') DESC,id",
      company: 'company,title,id',
      deadline: "CASE WHEN json_extract(payload,'$.deadline') IS NULL THEN 1 ELSE 0 END,json_extract(payload,'$.deadline'),id",
    };
    const sort = url.searchParams.get('sort');
    const order = Object.hasOwn(orders, sort) ? orders[sort] : orders.recent;
    const rows = db.prepare(`SELECT payload FROM jobs WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...values, limit, (page - 1) * limit);
    const saved = session ? new Map(db.prepare('SELECT job_id,id,status FROM applications WHERE user_id=?').all(session.user_id).map(r => [r.job_id, r])) : new Map();
    return json(res, { items: rows.map(r => { const j = JSON.parse(r.payload); return { ...j, application: saved.get(j.id) || null }; }), total, page, pageSize: limit, pages: Math.ceil(total / limit) });
  }
  const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
  if (jobMatch && method === 'GET') {
    const row = db.prepare('SELECT payload FROM jobs WHERE id=? AND catalog_active=1').get(decodeURIComponent(jobMatch[1]));
    demand(row, 404, '岗位不存在。'); return json(res, JSON.parse(row.payload));
  }
  demand(session, 401, '请先登录，数据会保存到你的独立账号。', 'LOGIN_REQUIRED');
  const userId = session.user_id;
  if (pathname === '/api/auth/logout' && method === 'POST') { clearSession(session, res); return json(res, { ok: true }); }
  if (pathname === '/api/dashboard' && method === 'GET') {
    const applications = applicationRows(userId);
    const tasks = db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY completed,due_at LIMIT 100').all(userId);
    const counts = Object.fromEntries(statuses.map(s => [s.id, applications.filter(a => a.status === s.id).length]));
    const resumeCount = db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE user_id=?').get(userId).n;
    return json(res, { applications, tasks, counts, resumeCount, total: applications.length, pendingTasks: tasks.filter(t => !t.completed).length });
  }
  if (pathname === '/api/applications' && method === 'GET') return json(res, applicationRows(userId));
  if (pathname === '/api/applications' && method === 'POST') {
    const jobId = text(body.jobId, 160);
    demand(db.prepare('SELECT id FROM jobs WHERE id=? AND catalog_active=1').get(jobId), 404, '岗位已下架或不符合当前来源规则。');
    const old = db.prepare('SELECT id FROM applications WHERE user_id=? AND job_id=?').get(userId, jobId);
    if (old) return json(res, { id: old.id, existing: true });
    const applicationId = id();
    db.prepare('INSERT INTO applications(id,user_id,job_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(applicationId, userId, jobId, now(), now());
    return json(res, { id: applicationId }, 201);
  }
  const snapshotMatch = pathname.match(/^\/api\/applications\/([^/]+)\/resume$/);
  if (snapshotMatch && method === 'GET') {
    const application = ownApplication(userId, snapshotMatch[1]);
    demand(application.resume_snapshot, 404, '这条投递尚未绑定简历快照。');
    return json(res, { revision: application.resume_revision, data: JSON.parse(application.resume_snapshot), application_id: application.id });
  }
  const appMatch = pathname.match(/^\/api\/applications\/([^/]+)$/);
  if (appMatch) {
    const current = ownApplication(userId, appMatch[1]);
    if (method === 'DELETE') { db.prepare('DELETE FROM applications WHERE id=? AND user_id=?').run(current.id, userId); return json(res, { ok: true }); }
    if (method === 'PUT') {
      const status = text(body.status, 30);
      demand(statusIds.has(status), 400, '投递状态不正确。');
      let resumeId = null, revision = null, snapshot = null;
      if (body.resumeId) {
        const resume = ownResume(userId, text(body.resumeId, 80));
        resumeId = resume.id;
        if (resumeId === current.resume_id && !body.refreshResumeSnapshot) { revision = current.resume_revision; snapshot = current.resume_snapshot; }
        else { revision = resume.revision; snapshot = JSON.stringify(resume.data); }
      }
      db.prepare('UPDATE applications SET status=?,resume_id=?,resume_revision=?,resume_snapshot=?,notes=?,applied_at=?,next_date=?,updated_at=? WHERE id=? AND user_id=?')
        .run(status, resumeId, revision, snapshot, text(body.notes, 10000), dateValue(body.appliedAt), dateValue(body.nextDate), now(), current.id, userId);
      return json(res, { ok: true });
    }
  }
  if (pathname === '/api/tasks' && method === 'GET') return json(res, db.prepare('SELECT * FROM tasks WHERE user_id=? ORDER BY completed,due_at').all(userId));
  if (pathname === '/api/tasks' && method === 'POST') {
    const title = text(body.title, 200);
    demand(title, 400, '请填写待办标题。');
    const applicationId = body.applicationId ? ownApplication(userId, text(body.applicationId, 80)).id : null;
    const taskId = id();
    const kind = ['笔试', '面试', '截止', '跟进', '其他'].includes(body.kind) ? body.kind : '其他';
    db.prepare('INSERT INTO tasks(id,user_id,application_id,title,kind,due_at,notes,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(taskId, userId, applicationId, title, kind, dateValue(body.dueAt, false), text(body.notes, 3000), now(), now());
    return json(res, { id: taskId }, 201);
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (taskMatch) {
    const task = db.prepare('SELECT * FROM tasks WHERE id=? AND user_id=?').get(taskMatch[1], userId);
    demand(task, 404, '待办不存在。');
    if (method === 'DELETE') { db.prepare('DELETE FROM tasks WHERE id=? AND user_id=?').run(task.id, userId); return json(res, { ok: true }); }
    if (method === 'PUT') {
      const title = 'title' in body ? text(body.title, 200) : task.title;
      demand(title, 400, '请填写待办标题。');
      db.prepare('UPDATE tasks SET title=?,due_at=?,notes=?,completed=?,updated_at=? WHERE id=? AND user_id=?')
        .run(title, 'dueAt' in body ? dateValue(body.dueAt, false) : task.due_at, 'notes' in body ? text(body.notes, 3000) : task.notes, typeof body.completed === 'boolean' ? Number(body.completed) : task.completed, now(), task.id, userId);
      return json(res, { ok: true });
    }
  }
  if (pathname === '/api/resumes' && method === 'GET') return json(res, db.prepare('SELECT id,title,template,revision,created_at,updated_at FROM resumes WHERE user_id=? ORDER BY updated_at DESC').all(userId));
  if (pathname === '/api/resumes' && method === 'POST') {
    demand(db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE user_id=?').get(userId).n < 100, 400, '最多保存 100 份简历。');
    const template = templateIds.has(body.template) ? body.template : 'classic';
    const row = { id: id(), user_id: userId, title: text(body.title, 100) || '我的校招简历', template, data: sanitizeResume(body.data || blankResume()), revision: 1, created_at: now(), updated_at: now() };
    transaction(() => { db.prepare('INSERT INTO resumes(id,user_id,title,template,data,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').run(row.id, userId, row.title, template, JSON.stringify(row.data), 1, row.created_at, row.updated_at); snapshotResume(row, '创建简历'); });
    return json(res, row, 201);
  }
  const resumeMatch = pathname.match(/^\/api\/resumes\/([^/]+)$/);
  if (resumeMatch) {
    const current = ownResume(userId, resumeMatch[1]);
    if (method === 'GET') return json(res, current);
    if (method === 'DELETE') { db.prepare('DELETE FROM resumes WHERE id=? AND user_id=?').run(current.id, userId); return json(res, { ok: true }); }
    if (method === 'PUT') {
      demand(Number(body.revision) === current.revision, 409, '这份简历已在其他页面更新。请先保留当前内容并重新加载。', 'REVISION_CONFLICT');
      demand(templateIds.has(body.template), 400, '简历模板不存在。');
      const title = text(body.title, 100);
      demand(title, 400, '请填写简历名称。');
      return json(res, saveResume(current, sanitizeResume(body.data), title, body.template, '手动保存'));
    }
  }
  const versionsMatch = pathname.match(/^\/api\/resumes\/([^/]+)\/versions$/);
  if (versionsMatch && method === 'GET') {
    const current = ownResume(userId, versionsMatch[1]);
    return json(res, db.prepare('SELECT id,revision,title,template,reason,created_at FROM resume_versions WHERE resume_id=? ORDER BY revision DESC LIMIT 100').all(current.id));
  }
  const restoreMatch = pathname.match(/^\/api\/resumes\/([^/]+)\/restore$/);
  if (restoreMatch && method === 'POST') {
    const current = ownResume(userId, restoreMatch[1]);
    demand(Number(body.currentRevision) === current.revision, 409, '当前版本已变化，请重新加载后恢复。');
    const previous = db.prepare('SELECT * FROM resume_versions WHERE resume_id=? AND revision=?').get(current.id, Number(body.revision));
    demand(previous, 404, '该历史版本不存在。');
    return json(res, saveResume(current, JSON.parse(previous.data), previous.title, previous.template, `恢复自 V${previous.revision}`));
  }
  if (pathname === '/api/settings/ai' && method === 'GET') return json(res, aiSettings(userId));
  if (pathname === '/api/settings/ai' && method === 'PUT') {
    const old = db.prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId);
    const previous = PROVIDERS[old?.provider] ? old.provider : 'deepseek';
    const provider = PROVIDERS[body.provider] ? body.provider : previous;
    const meta = PROVIDERS[provider];
    const model = text(body.model, 80) || (provider === previous ? text(old?.model, 80) : '') || meta.defaultModel;
    if (provider === 'deepseek') demand(meta.models.includes(model), 400, '模型不支持。');
    else demand(model, 400, '请填写模型名称。');
    const baseUrl = provider === 'custom'
      ? guardBaseUrl(body.baseUrl || (previous === 'custom' ? old?.base_url : '')) : '';
    let stored = old?.key_encrypted || null;
    if (body.removeKey === true) stored = null;
    else if (body.apiKey) {
      const key = text(body.apiKey, 500);
      demand(key.length >= 16 && !/\s/.test(key), 400, '密钥格式不正确。');
      stored = encrypt(key);
    }
    db.prepare('INSERT INTO ai_settings(user_id,key_encrypted,model,provider,base_url,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET key_encrypted=excluded.key_encrypted,model=excluded.model,provider=excluded.provider,base_url=excluded.base_url,updated_at=excluded.updated_at').run(userId, stored, model, provider, baseUrl, now());
    return json(res, aiSettings(userId));
  }
  if (pathname === '/api/ai/polish' && method === 'POST') return json(res, await polishResume(userId, body), 201);
  if (pathname === '/api/ai/reports' && method === 'GET') {
    const reportRows = db.prepare('SELECT id,resume_id,resume_revision,field_path,original,revised,changes,questions,match_analysis,model,created_at,applied_at FROM ai_reports WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(userId);
    return json(res, reportRows.map(row => { const { match_analysis, ...rest } = row; return { ...rest, changes: JSON.parse(row.changes), questions: JSON.parse(row.questions), match: match_analysis ? JSON.parse(match_analysis) : null }; }));
  }
  const applyReport = pathname.match(/^\/api\/ai\/reports\/([^/]+)\/apply$/);
  if (applyReport && method === 'POST') {
    const report = db.prepare('SELECT * FROM ai_reports WHERE id=? AND user_id=?').get(applyReport[1], userId);
    demand(report, 404, '润色记录不存在。');
    const current = ownResume(userId, report.resume_id);
    demand(Number(body.revision) === current.revision, 409, '简历已更新，请保存后重新比较。');
    const field = resumeField(current.data, report.field_path);
    demand(field.value === report.original, 409, '原段落已修改，为避免覆盖，请复制建议后手动合并。');
    field.parent[field.key] = report.revised;
    const saved = saveResume(current, sanitizeResume(current.data), current.title, current.template, '采纳 DeepSeek 润色');
    db.prepare('UPDATE ai_reports SET applied_at=? WHERE id=? AND user_id=?').run(now(), report.id, userId);
    return json(res, saved);
  }
  if (pathname === '/api/export' && method === 'GET') {
    const data = { exported_at: now(), format: 'offerbiu-user-data-v1', user: publicUser(session),
      applications: applicationRows(userId), tasks: db.prepare('SELECT * FROM tasks WHERE user_id=?').all(userId),
      resumes: db.prepare('SELECT * FROM resumes WHERE user_id=?').all(userId).map(unpackResume) };
    res.setHeader('Content-Disposition', 'attachment; filename="offerbiu-backup.json"');
    return json(res, data);
  }
  throw new HttpError(404, '接口不存在。');
}

export async function handleRequest(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'");
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    demand(req.method === 'GET' || req.method === 'HEAD', 405, '该请求方法不支持。');
    let name = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!name) name = 'index.html';
    if (name === 'workspace' || name === 'workspace/') name = 'workspace/index.html';
    const rootFiles = ['index.html', 'styles.css', 'motion.css', 'app.js', 'favicon.svg'];
    demand(rootFiles.includes(name) || /^(assets|workspace|shared)\//.test(name), 404, '页面不存在。');
    demand(!name.includes('\0') && !name.split(/[\\/]/).includes('..'), 404, '页面不存在。');
    const file = path.resolve(ROOT, name);
    demand(file.startsWith(ROOT + path.sep), 404, '页面不存在。');
    demand(fs.existsSync(file) && fs.statSync(file).isFile(), 404, '文件不存在。');
    const realFile = fs.realpathSync(file);
    demand(realFile.startsWith(ROOT + path.sep), 404, '文件不存在。');
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  } catch (error) {
    if (res.headersSent) return res.destroy();
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error('请求处理失败：', error.code || error.name); // No body, content, key or personal data.
    json(res, { error: status === 500 ? '服务暂时无法处理请求，请稍后再试。' : error.message, code: error.code || '' }, status);
  }
}
