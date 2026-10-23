import fs from 'node:fs';
import { db, transaction } from './db.mjs';
import { HttpError, demand, id, now, sha256 } from './security.mjs';
import { profileInput, createProfileRedactor } from './candidate-profile.mjs';
import { callJson, getAiTarget } from './ai-client.mjs';
import { EVALUATION_RULE_VERSION, EVALUATION_PROMPT_VERSION, availabilityForJob, canonicalJson, countText, deadlineInfo, isCalendarDate, isZonedTimestamp, normalizeText, qualityForJob } from '../shared/job-workflow.mjs';

const SYSTEM = fs.readFileSync(new URL('./prompts/evaluate-job.txt', import.meta.url), 'utf8');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = value => JSON.parse(canonicalJson(value));
const safeString = value => typeof value === 'string' ? normalizeText(value) : '';
const degreeRanks = new Map([['小学', 1], ['初中', 2], ['高中', 3], ['中专', 3], ['大专', 4], ['专科', 4], ['本科', 5], ['学士', 5], ['硕士', 6], ['硕士研究生', 6], ['博士', 7], ['博士研究生', 7]]);
const rank = value => degreeRanks.get(safeString(value).replace(/(?:及以上|以上|学历|学位|全日制)/g, '').trim());
const round = value => Math.round(value * 10) / 10;
const provinces = new Set(['河北','山西','辽宁','吉林','黑龙江','江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南','四川','贵州','云南','陕西','甘肃','青海','台湾','内蒙古','广西','西藏','宁夏','新疆']);
function cityKey(value) {
  let city = safeString(value).trim();
  if (!city || /全国|待分配|未公布|待定|不限|各地|另行|海外|远程|中国|国内|总部|一线|多地/u.test(city)) return null;
  city = city.replace(/^.*?(?:省|自治区|特别行政区)[·\s-]*/u, '');
  city = city.split(/[·/|｜>、，,\s]+/u).find(part => part && !provinces.has(part)) || '';
  if (!city || provinces.has(city) || /省|自治区|地区|自治州|盟|县|镇|旗/u.test(city)) return null;
  if (city.includes('市')) return city.slice(0, city.indexOf('市')) || null;
  return /区/u.test(city) ? null : city;
}

function storedJob(userId, jobId) {
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  demand(row && (row.catalog_active === 1 || db.prepare('SELECT id FROM applications WHERE user_id=? AND job_id=?').get(userId, jobId)), 404, '岗位不存在或不在本人可访问范围。');
  const job = JSON.parse(row.payload);
  demand(job.record_type === 'job' && job.cohort === 2027 && ['employer_official', 'nwu_official'].includes(job.source_type) && job.direct_apply_verified === true, 400, '首版仅评估现有官方具体岗位。', 'JOB_SOURCE_UNSUPPORTED');
  return job;
}

function snapshot(raw, supplement) {
  const job = {
    id: safeString(raw.id), company: safeString(raw.company), title: safeString(raw.title),
    description: safeString(raw.description), requirements: safeString(raw.requirements), degree: safeString(raw.education ?? raw.degree),
    cohort: raw.cohort ?? null, cohortEvidence: safeString(raw.cohort_evidence),
    cities: Array.isArray(raw.cities) ? raw.cities.map(safeString).filter(Boolean) : [], deadline: raw.deadline ?? null,
    contentQuality: { ...qualityForJob(raw), referenceUrls: Array.isArray(raw.content_quality?.reference_urls) ? raw.content_quality.reference_urls.map(safeString) : [] },
    eligibilityConstraints: Array.isArray(raw.eligibility_constraints) ? normalized(raw.eligibility_constraints) : [],
    sourceUrl: safeString(raw.source_url), applyUrl: safeString(raw.apply_url), cohortEvidenceUrl: safeString(raw.cohort_evidence_url), sourceType: safeString(raw.source_type),
    availability: availabilityForJob(raw), rawPayload: normalized(raw),
  };
  const total = [job.description, job.requirements, job.degree, job.cohortEvidence, supplement].join('\n');
  demand(countText(total) <= 24000, 400, 'JD 全部输入超过24000个码点，请明确整理适用的具体岗位正文。', 'JD_TOO_LARGE');
  const units = [];
  for (const [field, text, sourceType] of [['description', job.description, 'official_job'], ['requirements', job.requirements, 'official_job'], ['jdSupplement', supplement, 'user_supplement']]) {
    // Keep compound sentences intact unless the next semicolon clause has an
    // explicit list number. Never invent atomic hard rules by splitting prose.
    for (const part of text.split(/\n+|[；;](?=\s*(?:\d+[.、．)）]|[一二三四五六七八九十]+[、.．]))/u)) {
      if (!part.trim()) continue;
      units.push({ id: `J${String(units.length + 1).padStart(2, '0')}`, text: part, sourceField: field, sourceUrl: sourceType === 'user_supplement' ? null : job.sourceUrl, sourceType });
    }
  }
  demand(units.length > 0, 400, '尚无可评估的具体岗位正文，请先补充。', 'JD_INSUFFICIENT');
  demand(units.length <= 40, 400, 'JD 超过40个单元，请整理适用的具体岗位正文后重试。', 'JD_TOO_MANY_UNITS');
  const { availability, rawPayload, ...content } = job;
  const jobHash = sha256(canonicalJson({ ...content, jdSupplement: supplement }));
  return { job, jdSupplement: supplement, units, jobHash };
}

export function currentJobInput(userId, jobId, jdSupplement = '') {
  demand(typeof jobId === 'string' && jobId.length > 0 && jobId.length <= 160, 400, '岗位ID格式不正确。');
  demand(typeof jdSupplement === 'string', 400, '补充正文必须是文字。');
  const supplement = normalizeText(jdSupplement);
  demand(countText(supplement) <= 24000, 400, '补充正文超过24000个码点。', 'JD_TOO_LARGE');
  return snapshot(storedJob(userId, jobId), supplement);
}

function dateInterval(value) {
  if (typeof value !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(value) && isCalendarDate(`${value}-01`)) {
    const [year, month] = value.split('-').map(Number);
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    return { start: `${value}-01`, end: last };
  }
  return isCalendarDate(value) ? { start: value, end: value } : null;
}

function trustedConstraint(rule, job) {
  if (!object(rule) || !isZonedTimestamp(rule.reviewed_at) || typeof rule.id !== 'string' || !rule.id.trim()) return false;
  if (!['description', 'requirements', 'education', 'degree', 'cohort_evidence'].includes(rule.source_field)) return false;
  const quote = safeString(rule.source_quote);
  const source = safeString(job.rawPayload?.[rule.source_field]);
  const urls = [job.sourceUrl, job.applyUrl, job.cohortEvidenceUrl, ...job.contentQuality.referenceUrls].filter(Boolean);
  if (!quote || !source.includes(quote) || !urls.includes(rule.source_url) || !/^https:\/\//i.test(rule.source_url)) return false;
  if (/优先|可放宽|酌情|相关专业|另见|参照|冲突|不一致|待确认|不强制|不要求|无需|不限|可选|非必需/u.test(quote)) return false;
  if (rule.kind === 'minimum_degree') return rule.operator === 'at_least' && typeof rule.value === 'string' && Boolean(rank(rule.value)) && quote.includes(rule.value);
  if (rule.kind === 'graduation_window') {
    const start = Array.isArray(rule.value) ? rule.value[0] : rule.value?.start;
    const end = Array.isArray(rule.value) ? rule.value[1] : rule.value?.end;
    const lower = dateInterval(start), upper = dateInterval(end);
    return rule.operator === 'between' && Boolean(lower && upper && lower.start <= upper.end);
  }
  if (rule.kind === 'explicit_certificate') {
    const certificate = typeof rule.value === 'string' ? rule.value : rule.value?.qualification || rule.value?.name;
    return rule.operator === 'equals' && typeof certificate === 'string' && certificate.trim() && quote.includes(certificate);
  }
  return false;
}

function compareConstraint(rule, preferences) {
  if (rule.kind === 'minimum_degree') {
    const actual = rank(preferences.degree), required = rank(rule.value);
    if (!actual || !required) return { state: 'needs_review', reason: '本人学历或岗位最低学历尚不能确定比较。' };
    return { state: actual >= required ? 'pass' : 'fail', reason: `本人已确认学历为${preferences.degree}，岗位明确最低学历为${rule.value}。` };
  }
  if (rule.kind === 'graduation_window') {
    const current = dateInterval(preferences.graduationDate);
    const lower = dateInterval(Array.isArray(rule.value) ? rule.value[0] : rule.value.start);
    const upper = dateInterval(Array.isArray(rule.value) ? rule.value[1] : rule.value.end);
    if (!current || !lower || !upper) return { state: 'needs_review', reason: '缺少已确认且精度明确的毕业时间。' };
    if (current.end < lower.start || current.start > upper.end) return { state: 'fail', reason: '本人已确认毕业时间与明确毕业窗口不相交。' };
    if (current.start >= lower.start && current.end <= upper.end) return { state: 'pass', reason: '本人已确认毕业时间位于明确毕业窗口内。' };
    return { state: 'needs_review', reason: '本人毕业月份与岗位精确日期边界相交，需要确认具体日期。' };
  }
  const certificate = typeof rule.value === 'string' ? rule.value : rule.value.qualification || rule.value.name;
  const canon = value => safeString(value).replace(/\s+/g, '').toUpperCase();
  const matching = preferences.languages.find(language => language.confirmedAt && [language.name, language.qualification].some(value => canon(value) === canon(certificate)));
  if (!matching) return { state: 'needs_review', reason: '已确认底稿尚未体现该明确证书，不能据此判定未持有。' };
  if (object(rule.value) && rule.value.value !== undefined && rule.value.value !== null && matching.value !== rule.value.value) return { state: 'needs_review', reason: '证书数值需要进一步核对。' };
  return { state: 'pass', reason: '本人已确认的证书与岗位明确要求一致。' };
}

function gatesFor(profile, job, candidates = [], liveAvailability = job.availability) {
  const gates = [{ id: 'availability', kind: 'availability', state: liveAvailability.state === 'closed' ? 'fail' : liveAvailability.state === 'available' ? 'pass' : 'needs_review', reason: liveAvailability.reason,
    sourceQuote: liveAvailability.evidence_quote, sourceUrl: liveAvailability.evidence_url }];
  const deadline = deadlineInfo(job.deadline);
  if (deadline.known) gates.push({ id: 'deadline', kind: 'deadline', state: deadline.expired ? 'fail' : 'pass', reason: deadline.expired ? '已过明确截止日期。' : '尚未到明确截止日期。', sourceQuote: job.deadline, sourceUrl: job.sourceUrl });
  const rules = job.eligibilityConstraints;
  if (!rules.length) gates.push({ id: 'eligibility', kind: 'eligibility', state: 'needs_review', reason: '尚无经采集审核的结构化资格条件，请人工核对原文。' });
  for (const [index, rule] of rules.entries()) {
    const base = { id: safeString(rule?.id) || `eligibility_${index}`, kind: safeString(rule?.kind) || 'eligibility', sourceQuote: safeString(rule?.source_quote), sourceUrl: safeString(rule?.source_url) };
    const conflict = rules.some(other => other !== rule && other?.kind === rule?.kind && canonicalJson(other?.value ?? null) !== canonicalJson(rule?.value ?? null));
    const summaryConflict = rule?.kind === 'minimum_degree' && (rank(job.degree) && rank(rule.value) && rank(job.degree) !== rank(rule.value)
      || /冲突|另标|不一致|矛盾|或|可放宽|不限/u.test(job.degree) || new Set((job.degree.match(/本科|学士|硕士|博士|大专|专科|高中|中专/g) || []).map(rank)).size > 1);
    if (!trustedConstraint(rule, job) || conflict || summaryConflict) gates.push({ ...base, state: 'needs_review', reason: conflict || summaryConflict ? '适用条件存在冲突，需人工核实。' : '资格条件缺少可比较的明确值、审核记录或精确原文。' });
    else gates.push({ ...base, ...compareConstraint(rule, profile.preferences) });
  }
  if (profile.preferences.cityConstraint === 'required') {
    const cities = job.cities;
    const preferred = profile.preferences.preferredCities;
    const actual = cities.map(cityKey), targets = preferred.map(cityKey);
    const uncertain = !actual.length || !targets.length || actual.includes(null) || targets.includes(null);
    const compatible = actual.some(city => city && targets.includes(city));
    gates.push({ id: 'city', kind: 'city', state: compatible ? 'pass' : uncertain ? 'needs_review' : 'fail', reason: compatible ? '岗位明确城市符合本人城市硬偏好。' : uncertain ? '岗位地点或本人城市硬偏好尚不能确定比较。' : '岗位明确列出的城市与本人城市硬偏好不相容。', sourceQuote: cities.join(' / '), sourceUrl: job.sourceUrl });
  }
  for (const [index, candidate] of candidates.entries()) gates.push({ id: `model_candidate_${index + 1}`, kind: 'model_candidate', state: 'needs_review', reason: candidate.reason, sourceQuote: candidate.source_quote, requirementId: candidate.requirement_id || null, sourceUrl: job.sourceUrl });
  return gates;
}

function checkedOutput(data, inputs) {
  const invalid = (condition, reason) => demand(condition, 502, `评估输出校验失败：${reason}`, 'AI_OUTPUT_INVALID');
  const string = (value, max, required = true) => typeof value === 'string' && countText(value) <= max && (!required || value.trim().length > 0);
  invalid(object(data) && data.schema_version === 1 && Object.keys(data).every(key => ['schema_version', 'units', 'eligibility_candidates', 'questions'].includes(key)), 'JSON字段不正确。');
  invalid(Array.isArray(data.units) && data.units.length === inputs.units.length, '必须覆盖全部JD单元。');
  const facts = new Map(inputs.profile.facts.map(fact => [fact.id, fact]));
  const units = new Map(inputs.units.map(unit => [unit.id, unit]));
  const seen = new Set();
  for (const unit of data.units) {
    invalid(object(unit) && Object.keys(unit).every(key => ['requirement_id', 'group', 'importance', 'relation', 'fact_ids', 'evidence_quotes', 'reason'].includes(key)), '单元字段不正确。');
    invalid(units.has(unit.requirement_id) && !seen.has(unit.requirement_id), '单元ID未知或重复。');
    seen.add(unit.requirement_id);
    invalid(['skills', 'experience', 'other'].includes(unit.group) && ['required', 'preferred'].includes(unit.importance) && ['supported', 'partial', 'not_shown', 'unknown'].includes(unit.relation), '关系、分组或权重枚举不正确。');
    invalid(string(unit.reason, 1200), '缺少单元理由或排除理由。');
    invalid(Array.isArray(unit.fact_ids) && Array.isArray(unit.evidence_quotes) && unit.fact_ids.length <= 80 && unit.fact_ids.length === unit.evidence_quotes.length && new Set(unit.fact_ids).size === unit.fact_ids.length, '事实和原文引用须一一对应且不能重复。');
    if (['supported', 'partial'].includes(unit.relation)) invalid(unit.fact_ids.length > 0, '有支持关系必须提供事实依据。');
    else invalid(unit.fact_ids.length === 0, '未体现或未知关系不能声称引用已支持事实。');
    for (const [index, factId] of unit.fact_ids.entries()) invalid(facts.has(factId) && string(unit.evidence_quotes[index], 1200) && facts.get(factId).text.includes(unit.evidence_quotes[index]), '引用不属于对应的已确认事实原文。');
  }
  invalid(Array.isArray(data.questions) && data.questions.length <= 40 && data.questions.every(question => string(question, 500)), '问题列表不正确。');
  invalid(Array.isArray(data.eligibility_candidates) && data.eligibility_candidates.length <= 40, '资格候选列表不正确。');
  for (const candidate of data.eligibility_candidates) {
    invalid(object(candidate) && Object.keys(candidate).every(key => ['id', 'kind', 'operator', 'value', 'requirement_id', 'source_quote', 'reason'].includes(key)) && string(candidate.kind, 80) && string(candidate.reason, 1200) && string(candidate.source_quote, 1200), '资格候选字段不正确。');
    const source = candidate.requirement_id ? units.get(candidate.requirement_id)?.text : inputs.units.map(unit => unit.text).join('\n');
    invalid(typeof source === 'string' && source.includes(candidate.source_quote), '资格候选必须引用本次JD原文。');
  }
  return normalized(data);
}

function calculateResult(relations, profile, job, liveAvailability) {
  const gates = gatesFor(profile, job, relations.eligibility_candidates, liveAvailability);
  const gateState = gates.some(gate => gate.state === 'fail') ? 'fail' : gates.some(gate => gate.state === 'needs_review') ? 'needs_review' : 'pass';
  const groups = {};
  let totalWeight = 0, judgedWeight = 0;
  for (const group of ['skills', 'experience']) {
    let weight = 0, judged = 0, supported = 0;
    for (const unit of relations.units.filter(unit => unit.group === group)) {
      const currentWeight = unit.importance === 'required' ? 2 : 1;
      weight += currentWeight;
      if (unit.relation === 'unknown') continue;
      judged += currentWeight;
      supported += currentWeight * (unit.relation === 'supported' ? 1 : unit.relation === 'partial' ? 0.5 : 0);
    }
    groups[group] = { score: judged ? round(100 * supported / judged) : null, coverage: weight ? judged / weight : 0, totalWeight: weight, judgedWeight: judged };
    totalWeight += weight; judgedWeight += judged;
  }
  const coverage = totalWeight ? judgedWeight / totalWeight : 0;
  const applicable = Object.entries(groups).filter(([, group]) => group.totalWeight > 0);
  let totalScore = null;
  if (job.contentQuality.level === 'complete' && applicable.length && coverage >= 0.8 && gateState !== 'fail' && applicable.every(([, group]) => group.score !== null)) {
    const sum = applicable.reduce((value, [name, group]) => value + group.score * (name === 'skills' ? 0.6 : 0.4), 0);
    const denominator = applicable.reduce((value, [name]) => value + (name === 'skills' ? 0.6 : 0.4), 0);
    totalScore = round(sum / denominator);
  }
  const scoreLabel = totalScore === null ? '资料不足，暂无可比较总分' : gateState === 'needs_review' ? '待核实的材料匹配分' : '材料匹配分';
  const rankingGroup = gateState === 'fail' ? 'ineligible' : totalScore === null ? 'insufficient' : gateState === 'needs_review' ? 'needs_review' : 'comparable';
  const questions = [...new Set([...relations.questions, ...gates.filter(gate => gate.state === 'needs_review').map(gate => gate.reason)])];
  return { units: relations.units, eligibilityCandidates: relations.eligibility_candidates, questions, gates, groups, gateState, totalScore, coverage, scoreLabel, rankingGroup };
}

function presentEvaluation(userId, row, cached = false) {
  const inputs = JSON.parse(row.inputs_json);
  const stored = JSON.parse(row.result_json);
  const relations = { units: stored.units, eligibility_candidates: stored.eligibilityCandidates || [], questions: stored.modelQuestions || [] };
  let stale = row.rule_version !== EVALUATION_RULE_VERSION || row.prompt_version !== EVALUATION_PROMPT_VERSION;
  try {
    const profile = profileInput(userId, row.profile_revision);
    stale ||= profile.hash !== row.profile_hash;
  } catch { stale = true; }
  const currentRow = db.prepare('SELECT payload FROM jobs WHERE id=?').get(row.job_id);
  const currentRaw = currentRow ? JSON.parse(currentRow.payload) : null;
  let current = null;
  try { current = currentRaw ? snapshot(currentRaw, inputs.jdSupplement || '') : null; } catch { stale = true; }
  stale ||= !current || current.jobHash !== row.job_hash;
  const availability = currentRaw ? availabilityForJob(currentRaw) : { state: 'unknown', reason: '岗位当前来源已不存在。', checked_at: null };
  const quality = currentRaw ? qualityForJob(currentRaw).level : 'unknown';
  const effectiveJob = { ...inputs.job, deadline: currentRaw?.deadline ?? inputs.job.deadline, contentQuality: { ...inputs.job.contentQuality, level: quality } };
  const result = calculateResult(relations, inputs.profile, effectiveJob, availability);
  const preferenceMatch = inputs.profile.preferences.preferredCities.some(city => (current?.job.cities || inputs.job.cities).includes(city));
  return {
    id: row.id, jobId: row.job_id, profileRevision: row.profile_revision, profileHash: row.profile_hash, jobHash: row.job_hash,
    ruleVersion: row.rule_version, promptVersion: row.prompt_version, provider: row.provider, model: row.model,
    gateState: result.gateState, totalScore: result.totalScore, coverage: result.coverage, scoreLabel: result.scoreLabel,
    contentQuality: quality, availability: availability.state, availabilityDetails: availability,
    stale, cached, rankingGroup: result.rankingGroup, preferenceMatch, urgent: deadlineInfo(effectiveJob.deadline).urgent,
    questions: result.questions, pendingConditions: result.gates.filter(gate => gate.state === 'needs_review'), result,
    inputs, usage: row.usage_json ? JSON.parse(row.usage_json) : null, createdAt: row.created_at,
    company: inputs.job.company, title: inputs.job.title, deadline: effectiveJob.deadline,
  };
}

export function getEvaluation(userId, evaluationId) {
  const row = db.prepare('SELECT * FROM job_evaluations WHERE id=? AND user_id=?').get(evaluationId, userId);
  demand(row, 404, '评估不存在。');
  return presentEvaluation(userId, row);
}

export async function evaluateJob(userId, body, { signal } = {}) {
  demand(object(body), 400, '评估请求格式不正确。');
  demand(body.consent === true, 400, '请先同意将本次已确认底稿和JD发送给所选模型服务。', 'AI_CONSENT_REQUIRED');
  const profile = profileInput(userId, body.profileRevision);
  const redact = createProfileRedactor(userId);
  demand(body.jdSupplement === undefined || typeof body.jdSupplement === 'string', 400, '补充正文必须是文字。');
  demand(countText(body.jdSupplement || '') <= 24000, 400, '补充正文超过24000个码点。', 'JD_TOO_LARGE');
  // A supplement can itself contain pasted personal contacts; never persist or send them.
  const supplement = redact(body.jdSupplement || '');
  const jobInput = currentJobInput(userId, body.jobId, supplement);
  const inputs = { profile, ...jobInput };
  const target = await getAiTarget(userId);
  const cacheKey = sha256(canonicalJson({ userId, jobId: body.jobId, jobHash: jobInput.jobHash, profileHash: profile.hash,
    ruleVersion: EVALUATION_RULE_VERSION, promptVersion: EVALUATION_PROMPT_VERSION, provider: target.provider, model: target.model, endpointFingerprint: target.endpointFingerprint }));
  const cached = db.prepare('SELECT * FROM job_evaluations WHERE user_id=? AND cache_key=?').get(userId, cacheKey);
  if (cached) return presentEvaluation(userId, cached, true);
  const { rawPayload, ...modelJob } = jobInput.job;
  const response = await callJson(userId, { task: 'evaluate_job', system: SYSTEM, input: { schemaVersion: 1, profile, job: modelJob, units: inputs.units, unitContract: { count: inputs.units.length, requirementIds: inputs.units.map(unit => unit.id) }, jdSupplement: supplement }, signal,
    validate: data => checkedOutput(data, inputs) });
  demand(response.provider === target.provider && response.model === target.model && response.endpointFingerprint === target.endpointFingerprint, 409, '模型设置已变化，请重新评估。', 'AI_SETTINGS_CHANGED');
  const relations = checkedOutput(response.data, inputs);
  const result = { ...calculateResult(relations, profile, jobInput.job), modelQuestions: relations.questions };
  let evaluationId;
  transaction(() => {
    let latestProfile, latestJob;
    try { latestProfile = profileInput(userId, profile.revision); latestJob = currentJobInput(userId, body.jobId, supplement); }
    catch { throw new HttpError(409, '底稿或岗位已变化，请重新评估。', 'EVALUATION_INPUT_CHANGED'); }
    demand(latestProfile.hash === profile.hash && latestJob.jobHash === jobInput.jobHash, 409, '底稿或岗位已变化，请重新评估。', 'EVALUATION_INPUT_CHANGED');
    const existing = db.prepare('SELECT id FROM job_evaluations WHERE user_id=? AND cache_key=?').get(userId, cacheKey);
    if (existing) { evaluationId = existing.id; return; }
    evaluationId = id();
    db.prepare(`INSERT INTO job_evaluations(id,user_id,job_id,profile_revision,profile_hash,job_hash,rule_version,prompt_version,provider,model,endpoint_fingerprint,cache_key,gate_state,total_score,coverage,inputs_json,result_json,usage_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(evaluationId, userId, body.jobId, profile.revision, profile.hash, jobInput.jobHash, EVALUATION_RULE_VERSION, EVALUATION_PROMPT_VERSION,
      response.provider, response.model, response.endpointFingerprint, cacheKey, result.gateState, result.totalScore, result.coverage, JSON.stringify(inputs), JSON.stringify(result), JSON.stringify(response.usage ?? null), now());
  });
  return getEvaluation(userId, evaluationId);
}

export function listEvaluations(userId, query = {}) {
  const read = key => typeof query.get === 'function' ? query.get(key) : query[key];
  const page = (value, fallback, min, max) => {
    if (value === undefined || value === null || value === '') return fallback;
    demand(/^(?:0|[1-9]\d*)$/.test(String(value)), 400, '分页参数格式不正确。');
    const result = Number(value);
    demand(Number.isSafeInteger(result) && result >= min && result <= max, 400, '分页参数超出范围。');
    return result;
  };
  const limit = page(read('limit'), 20, 1, 50), offset = page(read('offset'), 0, 0, Number.MAX_SAFE_INTEGER);
  const jobId = read('jobId');
  demand(jobId === undefined || jobId === null || typeof jobId === 'string' && jobId.length > 0 && jobId.length <= 160, 400, '岗位ID格式不正确。');
  const rows = jobId ? db.prepare('SELECT * FROM job_evaluations WHERE user_id=? AND job_id=? ORDER BY created_at DESC,id').all(userId, jobId)
    : db.prepare('SELECT * FROM job_evaluations WHERE user_id=? ORDER BY created_at DESC,id').all(userId);
  const rankOrder = { comparable: 0, needs_review: 1, insufficient: 2, ineligible: 3 };
  const items = rows.map(row => presentEvaluation(userId, row)).filter(item => read('includeStale') === '1' || read('includeStale') === 1 || !item.stale);
  items.sort((a, b) => rankOrder[a.rankingGroup] - rankOrder[b.rankingGroup] || (b.totalScore ?? -1) - (a.totalScore ?? -1)
    || Number(b.preferenceMatch) - Number(a.preferenceMatch) || (deadlineInfo(a.deadline).known ? a.deadline : '9999').localeCompare(deadlineInfo(b.deadline).known ? b.deadline : '9999') || a.jobId.localeCompare(b.jobId) || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  if (read('sort') === 'recent') items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const total = items.length;
  return { items: items.slice(offset, offset + limit).map(({ inputs, result, ...summary }) => summary), total, limit, offset };
}

export function deleteEvaluation(userId, evaluationId) {
  demand(db.prepare('DELETE FROM job_evaluations WHERE id=? AND user_id=?').run(evaluationId, userId).changes === 1, 404, '评估不存在。');
  return { deleted: true };
}
