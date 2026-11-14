import { PROVIDERS, guardBaseUrl, resolveTarget } from './ai-provider.mjs';
import { callJson } from './ai-client.mjs';
export { PROVIDERS, guardBaseUrl, isPrivateIp } from './ai-provider.mjs';
import { db, unpackResume } from './db.mjs';
import { resolveJob } from './job-targets.mjs';
import { apiKey, decrypt, demand, HttpError, id, now, resumeField, text, rateLimit } from './security.mjs';
import { serverDeepSeekKeyFor, serverKeyPolicy } from './ai-access.mjs';
import { confirmedFactSnippets, hrResumeSkillPrompt, screenPolishRevision } from './hr-resume-skill.mjs';

function stringList(value, limit = 12) {
  return (Array.isArray(value) ? value : []).slice(0, limit).map(item => text(item, 800)).filter(Boolean);
}

function diagnosisFrom(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const impression = text(value.impression, 400);
  const issues = stringList(value.issues, 8).map(item => item.slice(0, 400));
  const risks = stringList(value.risks, 8).map(item => item.slice(0, 400));
  if (!impression && !issues.length && !risks.length) return null;
  return { impression, issues, risks };
}

export function aiSettings(userId) {
  const row = db.prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId);
  const provider = PROVIDERS[row?.provider] ? row.provider : 'deepseek';
  const meta = PROVIDERS[provider];
  const envKey = serverKey(provider, userId);
  return {
    configured: Boolean(row?.key_encrypted || envKey),
    source: row?.key_encrypted ? 'personal' : envKey ? 'server' : 'none',
    serverKeyPolicy: serverKeyPolicy(),
    provider,
    providers: Object.entries(PROVIDERS).map(([key, item]) => ({ key, label: item.label, models: item.models, keyUrl: item.keyUrl })),
    baseUrl: text(row?.base_url, 300),
    model: row?.model || (provider === 'deepseek' ? process.env.DEEPSEEK_MODEL : '') || meta.defaultModel,
    models: meta.models,
  };
}

function serverKey(provider, userId) {
  return provider === 'deepseek' ? serverDeepSeekKeyFor(userId) : '';
}

/** Lightweight connectivity check — models list first, then a 1-token chat fallback. */
export async function testAiConnection(userId, body = {}) {
  rateLimit('ai-test:' + userId, 8, 3600000);
  const row = db.prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId);
  const provider = PROVIDERS[body.provider] ? body.provider : (PROVIDERS[row?.provider] ? row.provider : 'deepseek');
  const meta = PROVIDERS[provider];
  const model = text(body.model, 80) || text(row?.model, 80) || (provider === 'deepseek' ? process.env.DEEPSEEK_MODEL : '') || meta.defaultModel;
  const target = await resolveTarget({
    provider,
    model,
    base_url: provider === 'custom' ? (body.baseUrl || row?.base_url || '') : '',
  });
  const sameTarget = provider === (row?.provider || 'deepseek')
    && (provider !== 'custom' || target.baseUrl === row?.base_url);
  let key = apiKey(body.apiKey);
  if (!key) key = sameTarget && row?.key_encrypted ? decrypt(row.key_encrypted) : serverKey(provider, userId);
  demand(key, 400, '请为当前服务商和接口地址填写 API 密钥。');
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  try {
    const modelsRes = await fetch(target.url.replace(/\/chat\/completions$/, '/models'), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000), headers: { Authorization: `Bearer ${key}` },
    });
    if (modelsRes.ok) return { ok: true, provider: target.provider, model: target.model, method: 'models' };
    if (modelsRes.status === 401 || modelsRes.status === 403) {
      throw new HttpError(502, `${target.label} 密钥无效或权限不足，请核对后重试。`);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
  }
  let response;
  try {
    response = await fetch(target.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers,
      body: JSON.stringify({
        model: target.model, stream: false, max_tokens: 1, ...target.extra,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
  } catch (error) {
    throw new HttpError(502, error.name === 'TimeoutError' ? `${target.label} 响应超时，请稍后重试。` : `暂时无法连接 ${target.label}。`);
  }
  if (response.ok) return { ok: true, provider: target.provider, model: target.model, method: 'chat' };
  const messages = {
    401: `${target.label} 密钥无效，请重新填写。`,
    403: `${target.label} 拒绝了请求，请检查密钥权限。`,
    402: `${target.label} 账户余额不足。`,
    429: `${target.label} 请求限流，请稍后重试。`,
  };
  throw new HttpError(502, messages[response.status] || `${target.label} 测试失败（${response.status}）。`);
}

export async function polishResume(userId, body, { signal } = {}) {
  demand(body.consent === true, 400, '请同意将所选段落和岗位描述发送至所选 AI 服务商。');
  const resume = unpackResume(db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(text(body.resumeId, 80), userId));
  demand(resume, 404, '简历不存在。');
  demand(Number(body.revision) === resume.revision, 409, '简历版本已变化，请先保存后重新润色。', 'REVISION_CONFLICT');
  const fieldPath = text(body.field, 80);
  const field = resumeField(resume.data, fieldPath);
  demand(field.value.length >= 8, 400, '先在所选模块填写至少 8 个字的真实经历。');
  let targetJob = null;
  if (body.jobId) {
    targetJob = resolveJob(userId, text(body.jobId, 160), { active: true });
  }
  const job = targetJob;
  const facts = confirmedFactSnippets(userId);
  const cohort = Number.isInteger(job?.cohort) ? job.cohort : null;
  const prompt = { selected_text: field.value, confirmed_facts: facts, target_role: job?.title || text(body.targetRole, 150),
    job_requirements: job ? text(job.requirements, 6500) : '', job_responsibilities: job ? text(job.description, 6500) : '',
    recruit_type: text(job?.recruit_type, 40), cohort,
    tone: ['concise', 'professional', 'star'].includes(body.tone) ? body.tone : 'professional' };
  const hasTarget = Boolean(job || prompt.target_role);
  const result = await callJson(userId, { task: 'polish', system: hrResumeSkillPrompt, input: prompt, maxTokens: 2400, signal,
    validate(payload) { demand(typeof payload.revised === 'string' && payload.revised.trim(), 502, 'AI 未生成有效润色文本。', 'AI_OUTPUT_INVALID'); } });
  const payload = result.data;
  const revised = text(payload.revised, 16000);
  demand(revised, 502, 'AI 未生成有效润色文本。', 'AI_OUTPUT_INVALID');
  screenPolishRevision(field.value, revised, facts.map(fact => fact.text));
  const match = hasTarget && payload.match && typeof payload.match === 'object' ? {
    score: Math.max(0, Math.min(100, Number(payload.match.score) || 0)),
    matched: (Array.isArray(payload.match.matched) ? payload.match.matched : []).slice(0, 12).map(x => text(x, 400)),
    missing: (Array.isArray(payload.match.missing) ? payload.match.missing : []).slice(0, 12).map(x => text(x, 400)),
    advice: text(payload.match.advice, 800),
  } : null;
  const diagnosis = diagnosisFrom(payload.diagnosis);
  const report = { id: id(), user_id: userId, resume_id: resume.id, resume_revision: resume.revision,
    field_path: fieldPath, original: field.value, revised,
    changes: stringList(payload.changes),
    questions: stringList(payload.questions),
    diagnosis, match_analysis: match, target_job_id: job?.id || null, snapshot: JSON.stringify(resume.data), model: result.model,
    usage: result.usage || null, created_at: now(), applied_at: null };
  db.prepare(`INSERT INTO ai_reports(id,user_id,resume_id,resume_revision,field_path,original,revised,changes,questions,diagnosis,match_analysis,target_job_id,snapshot,model,usage,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(report.id, userId, resume.id, resume.revision, fieldPath, report.original, report.revised, JSON.stringify(report.changes), JSON.stringify(report.questions), diagnosis ? JSON.stringify(diagnosis) : null, match ? JSON.stringify(match) : null, report.target_job_id, report.snapshot, result.model, JSON.stringify(report.usage), report.created_at);
  // Both the create and the list endpoints expose this as `match`, so the
  // editor and the report page read the same field name.
  const { snapshot, user_id, match_analysis, ...safe } = report;
  return { ...safe, match, diagnosis };
}
