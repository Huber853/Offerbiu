import fs from 'node:fs';
import { db, transaction } from './db.mjs';
import { demand, HttpError, id, now, resumeField, sanitizeResume, sha256 } from './security.mjs';
import { getProfile, profileInput, createProfileRedactor } from './candidate-profile.mjs';
import { getEvaluation } from './job-evaluation.mjs';
import { targetId } from './job-targets.mjs';
import { callJson, getAiTarget } from './ai-client.mjs';
import { canonicalJson, countText, normalizeText, COUNT_MODES } from '../shared/job-workflow.mjs';

const draftPrompt = fs.readFileSync(new URL('./prompts/draft-materials.txt', import.meta.url), 'utf8');
const reviewPrompt = fs.readFileSync(new URL('./prompts/review-materials.txt', import.meta.url), 'utf8');
const promptVersion = sha256(draftPrompt);
const reviewPromptVersion = sha256(reviewPrompt);
const ruleVersion = '1';
const fieldTypes = new Set(['self_introduction', 'project_introduction', 'application_reason', 'opening_message']);
const pathPattern = /^(basics\.summary|skills|awards|(education|experience|projects)\.(0|[1-9]\d?)\.details)$/;
const issueTypes = new Set(['unsupported_fact', 'exaggerated_scope', 'unsupported_number', 'entity_mismatch', 'requirement_as_experience', 'evidence_mismatch', 'length', 'other']);
const limitation = '程序校验与第二次模型复核不能证明全部语义真实，仍须本人逐项核对。';

function object(value, status = 400) { demand(value && typeof value === 'object' && !Array.isArray(value), status, '内容必须是 JSON 对象。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); }
function keys(value, allowed, status = 400) { object(value, status); demand(Object.keys(value).every(key => allowed.includes(key)), status, '包含不允许修改或未知的字段。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); }
function string(value, maximum, status = 400, empty = false) {
  demand(typeof value === 'string', status, '文字字段格式不正确。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  const result = normalizeText(value);
  demand((empty || result.trim().length > 0) && countText(result) <= maximum && !result.includes('\u0000'), status, '文字为空、过长或包含无效字符。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  return result;
}
function identifier(value, status = 400) { demand(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value), status, '记录编号格式不正确。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); return value; }
function integer(value, status = 400) { demand(Number.isInteger(value) && value >= 1, status, '版本必须为正整数。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); return value; }
function requestId(value) { demand(typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value), 400, 'requestId 必须为 UUID。'); return value.toLowerCase(); }
function parsed(value) { return value == null ? null : JSON.parse(value); }
function ownApplication(userId, applicationId) {
  const row = db.prepare('SELECT * FROM applications WHERE id=? AND user_id=?').get(applicationId, userId);
  demand(row, 404, '投递记录不存在或无权访问。'); return { ...row, job_id: targetId(row) };
}
function ownResume(userId, resumeId) {
  const row = db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(resumeId, userId);
  demand(row, 404, '简历不存在或无权访问。'); return { ...row, data: parsed(row.data) };
}
function resumeHash(resume) { return sha256(canonicalJson({ title: resume.title, template: resume.template, data: resume.data })); }
function ownRow(userId, materialId) {
  const row = db.prepare('SELECT * FROM application_materials WHERE id=? AND user_id=?').get(materialId, userId);
  demand(row, 404, '材料不存在或无权访问。');
  const application = ownApplication(userId, row.application_id);
  for (const resumeId of [row.source_resume_id, row.created_resume_id]) if (resumeId) ownResume(userId, resumeId);
  if (row.evaluation_id) {
    const evaluation = db.prepare('SELECT user_id,job_id,private_job_id FROM job_evaluations WHERE id=?').get(row.evaluation_id);
    demand(evaluation?.user_id === userId && targetId(evaluation) === application.job_id, 404, '评估不存在或不属于该岗位。');
  }
  return row;
}
function checkEvaluation(userId, application, evaluationId, profileRevision, acknowledge, fresh = false) {
  const evaluation = getEvaluation(userId, evaluationId);
  demand(evaluation.jobId === application.job_id, 404, '评估不属于该岗位。');
  demand(!evaluation.stale && evaluation.profileRevision === profileRevision, 409, '评估来源已变化，请重新评估。', 'INPUT_CHANGED');
  demand(evaluation.gateState !== 'fail', fresh ? 409 : 400, '岗位条件未通过，不能生成或采纳材料。', fresh ? 'INPUT_CHANGED' : '');
  demand(evaluation.gateState !== 'needs_review' || acknowledge, 400, '请先逐项查看并确认待核实条件。');
  const quality = typeof evaluation.contentQuality === 'string' ? evaluation.contentQuality : evaluation.inputs.job.contentQuality?.level;
  demand(!['reference_only', 'unknown'].includes(quality) || evaluation.inputs.jdSupplement?.trim(), 400, '关键 JD 正文尚不完整，请先补充适用正文。');
  return evaluation;
}
function freshness(userId, row) {
  const application = ownApplication(userId, row.application_id);
  demand(row.source_resume_id && row.evaluation_id, 409, '来源已删除，请重新生成材料。', 'INPUT_CHANGED');
  demand(db.prepare('SELECT id FROM resumes WHERE id=?').get(row.source_resume_id) && db.prepare('SELECT id FROM job_evaluations WHERE id=?').get(row.evaluation_id), 409, '来源在操作期间已删除，请重新生成材料。', 'INPUT_CHANGED');
  const source = ownResume(userId, row.source_resume_id);
  demand(source.revision === row.source_resume_revision && resumeHash(source) === row.source_resume_hash, 409, '源简历已变化，请重新生成材料。', 'INPUT_CHANGED');
  let profile;
  try { profile = profileInput(userId, row.profile_revision); }
  catch (error) { if (error.status === 404 || error.status === 400) throw new HttpError(409, '候选人底稿已删除或不再就绪。', 'INPUT_CHANGED'); throw error; }
  const inputs = parsed(row.inputs_json);
  demand(profile.hash === inputs.references.profileHash, 409, '候选人底稿已变化。', 'INPUT_CHANGED');
  const evaluation = checkEvaluation(userId, application, row.evaluation_id, row.profile_revision, true, true);
  demand(evaluation.jobHash === row.job_hash, 409, '岗位正文已变化，请重新生成材料。', 'INPUT_CHANGED');
  return { source, profile, evaluation };
}
function stale(userId, row) {
  try { freshness(userId, row); return false; }
  catch (error) { if ([400, 404, 409].includes(error.status)) return true; throw error; }
}
function summary(userId, row) {
  const content = parsed(row.content_json);
  return { id: row.id, applicationId: row.application_id, evaluationId: row.evaluation_id, sourceResumeId: row.source_resume_id,
    sourceResumeRevision: row.source_resume_revision, profileRevision: row.profile_revision, jobHash: row.job_hash, version: row.version,
    reviewState: row.review_state, createdResumeId: row.created_resume_id, acceptedAt: row.accepted_at,
    provider: row.provider, model: row.model, promptVersion: row.prompt_version, patchCount: content.patches.length, fieldCount: content.form_fields.length,
    stale: stale(userId, row), createdAt: row.created_at, updatedAt: row.updated_at };
}
export function getMaterial(userId, materialId) {
  const row = ownRow(userId, materialId);
  return { ...summary(userId, row), inputs: parsed(row.inputs_json), content: parsed(row.content_json), review: parsed(row.review_json),
    usage: parsed(row.usage_json), reviewLimitation: limitation };
}
function page(query = {}) {
  const read = name => typeof query.get === 'function' ? query.get(name) : query[name];
  const number = (name, fallback) => read(name) == null || read(name) === '' ? fallback : Number(read(name));
  const limit = number('limit', 20), offset = number('offset', 0);
  demand(Number.isInteger(limit) && limit >= 1 && limit <= 50 && Number.isInteger(offset) && offset >= 0, 400, '分页参数不正确。');
  return { limit, offset, requestKey: read('requestId') ? requestId(read('requestId')) : null };
}
export function listMaterials(userId, applicationId, query) {
  ownApplication(userId, applicationId); const { limit, offset, requestKey } = page(query);
  const where = 'user_id=? AND application_id=?' + (requestKey ? ' AND request_key=?' : '');
  const args = [userId, applicationId, ...(requestKey ? [requestKey] : [])];
  const total = db.prepare('SELECT COUNT(*) AS n FROM application_materials WHERE '+where).get(...args).n;
  const rows = db.prepare('SELECT * FROM application_materials WHERE '+where+' ORDER BY created_at DESC,rowid DESC LIMIT ? OFFSET ?').all(...args, limit, offset);
  return { items: rows.map(row => summary(userId, ownRow(userId, row.id))), total, limit, offset };
}
function normalizeRequest(applicationId, body) {
  keys(body, ['evaluationId', 'resumeId', 'resumeRevision', 'profileRevision', 'requestId', 'acknowledgePendingConditions', 'fields', 'consent']);
  const key = requestId(body.requestId);
  demand(Array.isArray(body.fields) && body.fields.length <= 8, 400, '一次最多生成 8 个网申字段。');
  const fields = body.fields.map(field => {
    keys(field, ['type', 'maxLength', 'countMode']);
    demand(fieldTypes.has(field.type), 400, '不支持的网申字段类型。');
    demand(Number.isInteger(field.maxLength) && field.maxLength >= 1 && field.maxLength <= 1000, 400, '字段上限须在 1 至 1000 之间。');
    demand(COUNT_MODES.includes(field.countMode), 400, '不支持的字数口径。');
    return { type: field.type, maxLength: field.maxLength, countMode: field.countMode };
  });
  demand(body.acknowledgePendingConditions === undefined || typeof body.acknowledgePendingConditions === 'boolean', 400, '待核实条件确认格式不正确。');
  return { key, request: { applicationId, evaluationId: identifier(body.evaluationId), resumeId: identifier(body.resumeId), resumeRevision: integer(body.resumeRevision),
    profileRevision: integer(body.profileRevision), acknowledgePendingConditions: body.acknowledgePendingConditions === true, fields } };
}
function safeInputs(userId, source, evaluation, request, references) {
  const redact = createProfileRedactor(userId);
  const sourceFacts = getProfile(userId).facts;
  const profile = evaluation.inputs.profile;
  const entityKey = key => 'entity_' + sha256(String(key)).slice(0, 24);
  const pointer = fact => fact.source?.type === 'resume' ? fact.source : fact.source?.originalSource?.type === 'resume' ? fact.source.originalSource : null;
  const fieldPath = source => source && /^(education|experience|projects)\.\d+$/.test(source.field) ? source.field + '.details' : source?.field;
  const fields = [];
  for (const path of ['basics.summary', 'skills', 'awards', ...['education', 'experience', 'projects'].flatMap(section => (source.data[section] || []).map((_, index) => `${section}.${index}.details`))]) {
    const original = resumeField(source.data, path).value;
    demand(redact(original) === original, 400, '可改写段落含姓名或联系信息，请先移到简历基本信息后再生成。');
    const [section, index] = path.split('.');
    const kind = { education: 'education', experience: 'experience', projects: 'project' }[section] || 'other';
    const item = source.data[section]?.[Number(index)];
    const entityName = item?.school || item?.company || item?.name || '';
    const entityKeys = sourceFacts.filter(fact => fact.status === 'confirmed' && pointer(fact)?.resumeId === source.id && fieldPath(pointer(fact)) === path).map(fact => entityKey(fact.entityKey));
    fields.push({ path, text: original, kind, entityName: redact(entityName), entityKeys });
  }
  const facts = profile.facts.map(fact => {
    const stored = sourceFacts.find(item => item.id === fact.id), sourcePointer = pointer(stored);
    return { id: fact.id, kind: fact.kind, entityKey: entityKey(stored?.entityKey || fact.entityKey), text: redact(fact.text),
      sourcePath: sourcePointer ? sourcePointer.resumeId === source.id ? fieldPath(sourcePointer) : 'another_resume' : null };
  });
  // These are immutable safe snapshots. Full resume/contact/media data stays in resumes only.
  const preferences = Object.fromEntries(['targetRoles', 'preferredCities', 'cityConstraint', 'graduationDate', 'degree', 'major', 'languages'].filter(key => profile.preferences[key] !== undefined).map(key => [key, profile.preferences[key]]));
  const redactTree = value => typeof value === 'string' ? redact(value) : Array.isArray(value) ? value.map(redactTree) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, part]) => [key, redactTree(part)])) : value;
  const { rawPayload, ...job } = evaluation.inputs.job;
  return { schemaVersion: 1, request, references, profile: { revision: profile.revision, hash: profile.hash, preferences: redactTree(preferences), facts },
    sourceResume: { revision: source.revision, fields, entities: fields.filter(field => field.entityName).map(field => ({ kind: field.kind, path: field.path, name: field.entityName })) },
    job: redactTree(job), jdSupplement: redact(evaluation.inputs.jdSupplement || ''), units: redactTree(evaluation.inputs.units),
    evaluation: { gateState: evaluation.gateState, result: redactTree(evaluation.result) }, fields: request.fields };
}
function modelInput(inputs) {
  const { id: jobId, ...job } = inputs.job;
  const { revision, hash, facts, preferences } = inputs.profile;
  return { profile: { preferences, facts }, job, jdSupplement: inputs.jdSupplement, units: inputs.units,
    sourceResume: inputs.sourceResume, evaluation: inputs.evaluation, fields: inputs.fields };
}
function evidenceFor(value, facts, status) {
  demand(Array.isArray(value.fact_ids) && value.fact_ids.length >= 1 && value.fact_ids.length <= 80 && new Set(value.fact_ids).size === value.fact_ids.length, status, '每段文字必须引用有效且不重复的确认事实。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  const selected = value.fact_ids.map(factId => { identifier(factId, status); const fact = facts.find(item => item.id === factId); demand(fact, status, '引用了未知或未确认的事实。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); return fact; });
  demand(Array.isArray(value.fact_quotes) && value.fact_quotes.length >= selected.length && value.fact_quotes.length <= 160, status, '每项引用都必须包含可定位的事实原文。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  const quotes = value.fact_quotes.map(item => {
    keys(item, ['fact_id', 'quote'], status); const fact = selected.find(part => part.id === item.fact_id); const quote = string(item.quote, 2000, status);
    demand(fact && fact.text.includes(quote), status, '引用原句不在对应确认事实中。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
    return { fact_id: fact.id, quote };
  });
  demand(selected.every(fact => quotes.some(quote => quote.fact_id === fact.id)), status, '事实引用原文覆盖不完整。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  return { selected, quotes };
}
function numericClaims(value) {
  const normalized = value.replace(/\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?月?/g, match => {
    const parts = match.match(/\d+/g);
    return parts[0] + '-' + parts.slice(1).map(part => part.padStart(2, '0')).join('-');
  });
  return new Set([...(normalized.match(/\d{4}-\d{2}(?:-\d{2})?/g) || []),
    ...(normalized.match(/\d+(?:[.,]\d+)*(?:\s*[%％])?/g) || []).map(part => part.replace(/\s/g, '').replace('％', '%')),
    ...(value.match(/(?:第)?[零〇一二两三四五六七八九十百千万亿]+(?:年|月|日|天|人|个|项|次|倍|分|名|周|小时|分钟|元|条|家|所|套|份|万|亿)/g) || [])]);
}
const orgPrefix = /^(?:曾就读于|曾任职于|曾实习于|曾工作于|就读于|毕业于|任职于|实习于|工作于|就职于|服务于|来自|加入|负责|协助|曾在|在|于|为)/u;
const orgSuffix = /(大学|学院|公司|集团|研究院|实验室|学校)$/u;
function takeChars(value, maximum) { return Array.from(value).slice(0, maximum).join(''); }
function clipText(value, maximum) {
  const text = normalizeText(typeof value === 'string' ? value : '').trim();
  const chars = Array.from(text);
  return chars.length <= maximum ? text : chars.slice(0, maximum).join('').trim();
}
function organizationMentions(value) {
  if (typeof value !== 'string' || !value) return [];
  const mentions = [];
  for (const match of value.matchAll(/[\p{Script=Han}A-Za-z0-9·]{2,40}(?:大学|学院|公司|集团|研究院|实验室|学校)/gu)) {
    const raw = match[0];
    const ending = raw.match(orgSuffix)?.[1] || '';
    const names = new Set();
    const chars = Array.from(raw);
    for (let i = 0; i < chars.length; i++) {
      const name = chars.slice(i).join('').replace(orgPrefix, '');
      if (ending && name.endsWith(ending) && Array.from(name).length >= Array.from(ending).length + 2) names.add(name);
    }
    if (names.size) mentions.push({ names: [...names] });
  }
  return mentions;
}
function mentionSupported(mention, basis) { return mention.names.some(name => basis.includes(name)); }
function longestFactSubstring(fact, quote) {
  const source = Array.from(takeChars(typeof fact === 'string' ? fact : '', 2000));
  const query = Array.from(takeChars(typeof quote === 'string' ? quote : '', 2000));
  let bestStart = 0, bestLen = 0;
  const lengths = new Array(query.length + 1).fill(0);
  for (let i = 1; i <= source.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= query.length; j++) {
      const next = source[i - 1] === query[j - 1] ? diagonal + 1 : 0;
      diagonal = lengths[j];
      lengths[j] = next;
      if (next > bestLen) { bestLen = next; bestStart = i - next; }
    }
  }
  return source.slice(bestStart, bestStart + bestLen).join('');
}
function compactSlice(fact, compactQuote) {
  const chars = Array.from(fact);
  const target = Array.from(compactQuote);
  for (let start = 0; start < chars.length; start++) {
    if (/\s/u.test(chars[start])) continue;
    let index = start, matched = 0;
    while (index < chars.length && matched < target.length) {
      if (/\s/u.test(chars[index])) { index++; continue; }
      if (chars[index] !== target[matched]) break;
      index++; matched++;
    }
    if (matched === target.length) return chars.slice(start, index).join('');
  }
  return null;
}
function snapQuote(quote, fact, minimum = 1) {
  const raw = normalizeText(typeof quote === 'string' ? quote : '').trim();
  const basis = typeof fact === 'string' ? fact : '';
  if (!raw || !basis) return null;
  if (basis.includes(raw) && Array.from(raw).length >= minimum) return raw;
  const compactQuote = raw.replace(/\s+/g, '');
  if (compactQuote.length >= Math.max(4, minimum) && basis.replace(/\s+/g, '').includes(compactQuote)) {
    const slice = compactSlice(basis, compactQuote);
    if (slice && Array.from(slice.replace(/\s+/g, '')).length >= minimum) return slice;
  }
  const piece = longestFactSubstring(basis, raw);
  if (Array.from(piece).length >= Math.max(8, minimum) && basis.includes(piece)) return piece;
  return null;
}
function stillGrounded(text, basis) {
  if (Array.from(longestFactSubstring(basis, text)).length >= 4) return true;
  return ((basis.match(/[A-Za-z][A-Za-z\d]*/g) || []).some(token => token.length >= 2 && text.includes(token)));
}
function cleanupProse(value) {
  return normalizeText(value).replace(/[ \t]{2,}/g, ' ').replace(/[（(]\s*[）)]/g, '').replace(/^[，。！？；、：:\s]+/u, '').replace(/([，、；：:]){2,}/gu, '$1').replace(/([。！？])[，、；：:]+/gu, '$1').trim();
}
function removeUngroundedNames(text, basis, names) {
  const original = normalizeText(text).replace(/\u0000/g, '');
  let current = original;
  const strip = name => {
    const label = normalizeText(typeof name === 'string' ? name : '').trim();
    if (Array.from(label).length < 2 || !current.includes(label) || basis.includes(label)) return false;
    if (organizationMentions(current).some(mention => mention.names.some(name => name !== label && name.includes(label) && basis.includes(name)))) return false;
    const next = cleanupProse(current.split(label).join(''));
    if (!next || !stillGrounded(next, basis)) return false;
    current = next;
    return true;
  };
  let removed = false;
  for (const name of names) if (strip(name)) removed = true;
  for (let pass = 0; pass < 6; pass++) {
    const mention = organizationMentions(current).find(item => !mentionSupported(item, basis));
    if (!mention) break;
    const name = mention.names.slice().sort((a, b) => Array.from(a).length - Array.from(b).length)[0];
    if (!strip(name)) break;
    removed = true;
  }
  return { text: removed ? current : original, removed };
}
function trimToLimit(text, maximum, mode) {
  const normalized = normalizeText(text).replace(/\u0000/g, '');
  if (!Number.isInteger(maximum) || maximum < 1 || countText(normalized, mode) <= maximum) return { text: normalized, trimmed: false };
  let used = '', best = '';
  for (const ch of Array.from(normalized)) {
    const next = used + ch;
    if (countText(next, mode) > maximum) break;
    used = next;
    if (/[。！？；，、\n.!?;,]/.test(ch)) best = next;
  }
  const trimmed = best.trim();
  if (!trimmed || countText(trimmed, mode) > maximum) return { text: normalized, trimmed: false };
  return { text: trimmed, trimmed: true };
}
function repairNotes(items) {
  const list = Array.isArray(items) ? items : typeof items === 'string' ? [items] : [];
  return list.map(item => typeof item === 'string' ? clipText(item, 1000) : '').filter(Boolean).slice(0, 30);
}
function addWarning(draft, message) {
  if (!Array.isArray(draft.warnings)) draft.warnings = [];
  if (!draft.warnings.includes(message) && draft.warnings.length < 30) draft.warnings.push(message);
}
function asList(value) { return Array.isArray(value) ? value : typeof value === 'string' && value.trim() ? [value] : []; }
function resolveFact(factId, facts) {
  if (typeof factId !== 'string') return null;
  const id = normalizeText(factId).trim();
  const exact = facts.find(fact => fact.id === id);
  if (exact) return exact;
  const folded = facts.filter(fact => fact.id.toLowerCase() === id.toLowerCase());
  return folded.length === 1 ? folded[0] : null;
}
function improveCitations(item, facts) {
  const rawIds = asList(item.fact_ids ?? item.factIds);
  const rawQuotes = asList(item.fact_quotes ?? item.factQuotes);
  const quotes = [];
  let changed = false;
  for (const entry of rawQuotes) {
    const parsed = typeof entry === 'string' ? { factId: '', quote: entry } : entry && typeof entry === 'object' && !Array.isArray(entry) ? { factId: entry.fact_id ?? entry.factId ?? '', quote: entry.quote ?? entry.text ?? entry.excerpt ?? '' } : null;
    if (!parsed || typeof parsed.quote !== 'string') continue;
    const labeled = resolveFact(parsed.factId, facts);
    const snapped = labeled ? snapQuote(parsed.quote, labeled.text) : null;
    const fact = snapped ? labeled : null;
    const unique = fact ? null : facts.filter(candidate => snapQuote(parsed.quote, candidate.text, 4)).slice(0, 2);
    const rebound = !fact && unique && unique.length === 1 ? unique[0] : null;
    const quote = fact ? snapped : rebound ? snapQuote(parsed.quote, rebound.text, 4) : null;
    const chosen = fact || (quote ? rebound : null);
    if (!chosen || !quote) continue;
    const bounded = Array.from(quote).length > 2000 ? takeChars(quote, 2000) : quote;
    const rawQuote = normalizeText(parsed.quote).trim();
    if (bounded !== rawQuote || chosen.id !== String(parsed.factId || '').trim()) changed = true;
    if (!quotes.some(item => item.fact_id === chosen.id && item.quote === bounded)) quotes.push({ fact_id: chosen.id, quote: bounded });
  }
  const ids = [];
  for (const raw of rawIds) {
    const fact = resolveFact(raw, facts);
    if (fact && !ids.includes(fact.id)) ids.push(fact.id);
    else if (!fact) changed = true;
  }
  for (const quote of quotes) if (!ids.includes(quote.fact_id)) { ids.push(quote.fact_id); changed = true; }
  if (!ids.length || ids.length > 80 || quotes.length > 160 || !ids.every(id => quotes.some(quote => quote.fact_id === id))) return null;
  return { ids, quotes, changed };
}
function sameOriginal(original, source) {
  if (typeof original !== 'string' || typeof source !== 'string') return false;
  if (original === source) return true;
  const norm = value => normalizeText(value).replace(/\s+/g, ' ').trim();
  return norm(original) === norm(source);
}
function ensureId(value, prefix, used) {
  const current = typeof value === 'string' ? value.trim() : '';
  if (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(current) && !used.has(current)) { used.add(current); return current; }
  let n = 1, next = `${prefix}_${n}`;
  while (used.has(next)) next = `${prefix}_${++n}`;
  used.add(next);
  return next;
}
function patchLimit(path) { return path === 'basics.summary' ? 6000 : path === 'skills' || path === 'awards' ? 8000 : 12000; }
function contextualNames(inputs) {
  return [...(inputs.sourceResume?.entities || []).map(entity => entity.name), inputs.job?.company].filter(name => typeof name === 'string' && name.trim());
}
function rewriteCitedText(item, inputs, draft, limit, mode, textKey) {
  const facts = inputs.profile?.facts || [];
  const improved = improveCitations(item, facts);
  if (improved) {
    if (improved.changed) addWarning(draft, '已将事实引用对齐到确认事实中的连续原文。');
    item.fact_ids = improved.ids;
    item.fact_quotes = improved.quotes;
  } else if (Array.isArray(item.fact_quotes)) item.fact_quotes = item.fact_quotes.map(entry => entry && typeof entry === 'object' && !Array.isArray(entry) ? { fact_id: entry.fact_id ?? entry.factId, quote: entry.quote ?? entry.text ?? entry.excerpt } : entry);
  const selected = (Array.isArray(item.fact_ids) ? item.fact_ids : []).map(id => facts.find(fact => fact.id === id)).filter(Boolean);
  if (typeof item[textKey] !== 'string') return;
  let text = normalizeText(item[textKey]).replace(/\u0000/g, '');
  if (selected.length) {
    const basis = selected.map(fact => fact.text).filter(part => typeof part === 'string').join('\n');
    const removed = removeUngroundedNames(text, basis, contextualNames(inputs));
    text = removed.text;
    if (removed.removed) addWarning(draft, '已移除正文中缺少确认事实依据的机构或项目名称。');
  }
  const trimmed = trimToLimit(text, limit, mode);
  item[textKey] = trimmed.text;
  if (trimmed.trimmed) addWarning(draft, '已按字数上限截断过长正文，请核对是否保留完整句意。');
}
function repairPatches(patches, inputs, draft, ids) {
  const kept = [];
  let dropped = false;
  for (const patch of patches) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) { dropped = true; continue; }
    const path = typeof patch.path === 'string' ? patch.path : '';
    const source = (inputs.sourceResume?.fields || []).find(field => field.path === path);
    if (!pathPattern.test(path) || !source) {
      const preserved = { id: patch.id, path: patch.path, original: patch.original, revised: patch.revised, fact_ids: patch.fact_ids ?? patch.factIds, fact_quotes: patch.fact_quotes ?? patch.factQuotes, reason: patch.reason };
      kept.push(preserved);
      continue;
    }
    if (!sameOriginal(patch.original, source.text)) { dropped = true; continue; }
    const clean = { id: ensureId(patch.id, 'patch', ids), path, original: source.text, revised: patch.revised, fact_ids: patch.fact_ids ?? patch.factIds, fact_quotes: patch.fact_quotes ?? patch.factQuotes, reason: typeof patch.reason === 'string' && patch.reason.trim() ? clipText(patch.reason, 1000) : '依据已确认事实整理表述。' };
    rewriteCitedText(clean, inputs, draft, patchLimit(path), 'codepoints', 'revised');
    kept.push(clean);
  }
  if (dropped) addWarning(draft, '已忽略原文与源简历不一致的补丁。');
  return kept;
}
function alignFormFields(fields, requests) {
  const pool = requests.map(item => ({ ...item }));
  const matched = [];
  for (const field of Array.isArray(fields) ? fields : []) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) continue;
    const type = typeof field.type === 'string' ? field.type.trim() : '';
    const mode = typeof (field.count_mode ?? field.countMode) === 'string' ? (field.count_mode ?? field.countMode).trim() : '';
    const max = Number(field.max_length ?? field.maxLength);
    let index = pool.findIndex(item => item.type === type && item.maxLength === max && item.countMode === mode);
    if (index < 0) {
      const typed = pool.flatMap((item, at) => item.type === type ? [at] : []);
      if (typed.length === 1) index = typed[0];
    }
    if (index < 0) continue;
    matched.push({ field, requirement: pool.splice(index, 1)[0] });
  }
  return matched.length === requests.length ? matched : null;
}
function unwrapDraft(value) {
  if ('schema_version' in value || 'patches' in value || 'form_fields' in value || 'formFields' in value) return;
  const names = Object.keys(value);
  if (names.length !== 1) return;
  const inner = value[names[0]];
  if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return;
  if (!('patches' in inner || 'form_fields' in inner || 'formFields' in inner || 'schema_version' in inner)) return;
  delete value[names[0]];
  Object.assign(value, inner);
}
// Real models often add keys, miss the exact quote, overrun the selected limit, or mention an unconfirmed organization.
// Repair only rewrites those mechanical mismatches. Invented numbers, technologies, and stronger experience claims still fail closed.
function repairDraft(value, inputs) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  unwrapDraft(value);
  if (Array.isArray(value.formFields) && !Array.isArray(value.form_fields)) value.form_fields = value.formFields;
  if (value.patches == null) value.patches = [];
  if (value.questions == null) value.questions = [];
  if (value.warnings == null) value.warnings = [];
  if (value.schema_version == null || value.schema_version === '1') value.schema_version = 1;
  value.questions = repairNotes(value.questions);
  value.warnings = repairNotes(value.warnings).slice(0, 26);
  const ids = new Set();
  if (Array.isArray(value.patches)) value.patches = repairPatches(value.patches, inputs, value, ids);
  const aligned = alignFormFields(value.form_fields, inputs?.fields || []);
  if (aligned) value.form_fields = aligned.map(({ field, requirement }) => {
    const clean = { id: ensureId(field.id, 'field', ids), type: requirement.type, max_length: requirement.maxLength, count_mode: requirement.countMode, text: field.text, fact_ids: field.fact_ids ?? field.factIds, fact_quotes: field.fact_quotes ?? field.factQuotes };
    rewriteCitedText(clean, inputs, value, requirement.maxLength, requirement.countMode, 'text');
    return clean;
  });
  const clean = {};
  for (const key of ['schema_version', 'patches', 'form_fields', 'questions', 'warnings']) if (value[key] !== undefined) clean[key] = value[key];
  for (const key of Object.keys(value)) delete value[key];
  Object.assign(value, clean);
}
function checkClaims(value, selected, inputs, status, sourceField) {
  const basis = selected.map(fact => fact.text).join('\n'); const reject = message => demand(false, status, message, status === 502 ? 'AI_OUTPUT_INVALID' : '');
  const numbers = numericClaims(basis);
  for (const claim of numericClaims(value)) if (!numbers.has(claim)) reject('正文包含没有确认事实依据的新数字或日期。');
  const technologies = new Set((basis.match(/[A-Za-z][A-Za-z\d]*(?:[.+#/-][A-Za-z\d+#]+)*/g) || []).map(token => token.toLowerCase()));
  for (const token of value.match(/[A-Za-z][A-Za-z\d]*(?:[.+#/-][A-Za-z\d+#]+)*/g) || []) if (!technologies.has(token.toLowerCase())) reject('正文包含没有确认事实依据的新技术或英文实体。');
  const knownEntities = inputs.sourceResume.entities.map(entity => entity.name);
  for (const entity of knownEntities) if (entity && value.includes(entity) && !basis.includes(entity)) reject('正文包含未被引用事实支持的机构或项目名称。');
  for (const mention of organizationMentions(value)) if (!mentionSupported(mention, basis)) reject('正文包含没有确认事实依据的公司或学校名称。');
  for (const phrase of ['精通', '专家', '主导', '独立负责', '全面负责', '领导', '带领', '从零到一', '架构设计', '显著', '大幅', '成功上线', '生产环境', '商业化', '百万', '千万', '亿级', '高并发', '高可用', '分布式', '熟练掌握']) if (value.includes(phrase) && !basis.includes(phrase)) reject('正文包含缺少确认依据的职责或成果表述。');
  if (sourceField && ['education', 'experience', 'project'].includes(sourceField.kind)) {
    for (const fact of selected.filter(fact => ['education', 'experience', 'project'].includes(fact.kind))) {
      if (fact.sourcePath && fact.sourcePath !== sourceField.path) reject('不能把另一段经历或项目的事实用于当前段落。');
      if (sourceField.entityKeys.length && !sourceField.entityKeys.includes(fact.entityKey)) reject('引用事实与当前项目或经历实体不一致。');
    }
  }
}
function validateContent(value, inputs, status = 502) {
  if (status === 502) repairDraft(value, inputs);
  keys(value, ['schema_version', 'patches', 'form_fields', 'questions', 'warnings'], status);
  demand(value.schema_version === 1 && Array.isArray(value.patches) && value.patches.length <= inputs.sourceResume.fields.length && Array.isArray(value.form_fields) && value.form_fields.length === inputs.fields.length, status, '材料结构或字段数量不正确。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
  const ids = new Set(), paths = new Set();
  const unique = value => { identifier(value, status); demand(!ids.has(value), status, '材料编号不能重复。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); ids.add(value); };
  const patches = value.patches.map(patch => {
    keys(patch, ['id', 'path', 'original', 'revised', 'fact_ids', 'fact_quotes', 'reason'], status); unique(patch.id);
    const sourceField = inputs.sourceResume.fields.find(field => field.path === patch.path);
    demand(pathPattern.test(patch.path) && sourceField && !paths.has(patch.path) && typeof patch.original === 'string' && patch.original === sourceField.text, status, '补丁路径、原文或重复字段未通过校验。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); paths.add(patch.path);
    const revised = string(patch.revised, patch.path === 'basics.summary' ? 6000 : ['skills', 'awards'].includes(patch.path) ? 8000 : 12000, status, true);
    const { selected, quotes } = evidenceFor(patch, inputs.profile.facts, status); checkClaims(revised, selected, inputs, status, sourceField);
    return { id: patch.id, path: patch.path, original: patch.original, revised, fact_ids: selected.map(fact => fact.id), fact_quotes: quotes, reason: string(patch.reason, 1000, status) };
  });
  const remaining = inputs.fields.map(field => canonicalJson(field));
  const form_fields = value.form_fields.map(field => {
    keys(field, ['id', 'type', 'max_length', 'count_mode', 'text', 'fact_ids', 'fact_quotes', 'usedLength'], status); unique(field.id);
    const requirement = { type: field.type, maxLength: field.max_length, countMode: field.count_mode }, at = remaining.indexOf(canonicalJson(requirement));
    demand(at >= 0, status, '网申字段与用户所选类型、长度或口径不一致。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); remaining.splice(at, 1);
    const text = string(field.text, 1000, status); const usedLength = countText(text, field.count_mode);
    demand(usedLength <= field.max_length, status, '网申文字超过用户选定的长度上限。', status === 502 ? 'AI_OUTPUT_INVALID' : '');
    const { selected, quotes } = evidenceFor(field, inputs.profile.facts, status); checkClaims(text, selected, inputs, status);
    return { id: field.id, ...Object.fromEntries(['type', 'max_length', 'count_mode'].map(key => [key, field[key]])), text, fact_ids: selected.map(fact => fact.id), fact_quotes: quotes, usedLength };
  });
  const notes = items => { demand(Array.isArray(items) && items.length <= 30, status, '问题或提醒列表不正确。', status === 502 ? 'AI_OUTPUT_INVALID' : ''); return items.map(item => string(item, 1000, status)); };
  return { schema_version: 1, patches, form_fields, questions: notes(value.questions), warnings: notes(value.warnings) };
}
function resultTarget(result, target) { demand(['provider', 'model', 'endpointFingerprint'].every(key => result[key] === target[key]), 409, '模型设置在调用期间变化，请重新操作。', 'INPUT_CHANGED'); }
function callUsage(result, version) { return { version, provider: result.provider, model: result.model, endpointFingerprint: result.endpointFingerprint, usage: result.usage ?? null, at: now() }; }
function replay(userId, request, row) {
  const inputs = parsed(row.inputs_json);
  demand(sha256(canonicalJson({ request, references: inputs.references })) === row.request_hash, 409, '同一 requestId 已用于不同内容。', 'IDEMPOTENCY_CONFLICT');
  return { ...getMaterial(userId, row.id), replayed: true };
}
export async function generateMaterials(userId, applicationId, body, { signal } = {}) {
  const application = ownApplication(userId, applicationId); const { key, request } = normalizeRequest(applicationId, body);
  const existing = db.prepare('SELECT * FROM application_materials WHERE user_id=? AND request_key=?').get(userId, key);
  if (existing) return replay(userId, request, existing);
  demand(body.consent === true, 400, '请确认同意发送已确认事实、岗位正文和可改写简历段落。');
  const source = ownResume(userId, request.resumeId);
  demand(source.revision === request.resumeRevision, 409, '源简历版本已变化。', 'REVISION_CONFLICT');
  const profile = profileInput(userId, request.profileRevision);
  const evaluation = checkEvaluation(userId, application, request.evaluationId, request.profileRevision, request.acknowledgePendingConditions);
  demand(evaluation.inputs.profile.hash === profile.hash, 409, '底稿版本已变化。', 'PROFILE_REVISION_CONFLICT');
  const target = await getAiTarget(userId);
  const references = { sourceHash: resumeHash(source), profileHash: profile.hash, jobHash: evaluation.jobHash, ruleVersion, promptVersion, provider: target.provider, model: target.model, endpointFingerprint: target.endpointFingerprint };
  const inputs = safeInputs(userId, source, evaluation, request, references);
  const result = await callJson(userId, { task: 'draft-materials', system: draftPrompt, input: modelInput(inputs), signal, validate: value => validateContent(value, inputs) });
  resultTarget(result, target); const content = validateContent(result.data, inputs);
  const rowId = transaction(() => {
    const duplicate = db.prepare('SELECT * FROM application_materials WHERE user_id=? AND request_key=?').get(userId, key);
    if (duplicate) { replay(userId, request, duplicate); return duplicate.id; }
    const probe = { application_id: applicationId, source_resume_id: source.id, source_resume_revision: source.revision, source_resume_hash: references.sourceHash, profile_revision: profile.revision, evaluation_id: evaluation.id, job_hash: evaluation.jobHash, inputs_json: JSON.stringify(inputs) };
    freshness(userId, probe);
    const materialId = id(), time = now();
    db.prepare(`INSERT INTO application_materials(id,user_id,application_id,evaluation_id,source_resume_id,source_resume_revision,source_resume_hash,profile_revision,job_hash,request_key,request_hash,inputs_json,content_json,provider,model,prompt_version,usage_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(materialId, userId, applicationId, evaluation.id, source.id, source.revision, references.sourceHash, profile.revision, evaluation.jobHash, key, sha256(canonicalJson({ request, references })), JSON.stringify(inputs), JSON.stringify(content), result.provider, result.model, promptVersion, JSON.stringify({ draft: callUsage(result, 1), review: [] }), time, time);
    return materialId;
  });
  return { ...getMaterial(userId, rowId), replayed: false };
}
export function updateMaterial(userId, materialId, body) {
  keys(body, ['version', 'patches', 'formFields']); const row = ownRow(userId, materialId);
  demand(integer(body.version) === row.version, 409, '材料版本已变化，请重新加载。', 'MATERIAL_VERSION_CONFLICT');
  demand(!row.accepted_at, 409, '已采纳材料不可原地修改，请重新生成。', 'MATERIAL_VERSION_CONFLICT'); freshness(userId, row);
  const content = parsed(row.content_json), inputs = parsed(row.inputs_json); let edits = 0;
  for (const [requestKey, listKey, textKey] of [['patches', 'patches', 'revised'], ['formFields', 'form_fields', 'text']]) if (body[requestKey] !== undefined) {
    demand(Array.isArray(body[requestKey]) && body[requestKey].length <= content[listKey].length, 400, '正文修改列表不正确。'); const ids = new Set();
    for (const edit of body[requestKey]) {
      keys(edit, ['id', textKey]); const item = content[listKey].find(item => item.id === edit.id);
      demand(item && !ids.has(edit.id), 400, '修改目标不存在或重复。'); ids.add(edit.id);
      item[textKey] = string(edit[textKey], listKey === 'patches' ? 12000 : 1000, 400, listKey === 'patches'); edits++;
    }
  }
  demand(edits > 0, 400, '请提供要修改的正文。'); const valid = validateContent(content, inputs, 400);
  transaction(() => {
    freshness(userId, ownRow(userId, materialId));
    const change = db.prepare("UPDATE application_materials SET content_json=?,version=version+1,review_state='pending',review_json=NULL,updated_at=? WHERE id=? AND user_id=? AND version=? AND accepted_at IS NULL").run(JSON.stringify(valid), now(), materialId, userId, row.version);
    demand(change.changes === 1, 409, '材料版本已变化。', 'MATERIAL_VERSION_CONFLICT');
  });
  return getMaterial(userId, materialId);
}
function validateReview(value, content, inputs) {
  const status = 502; keys(value, ['schema_version', 'verdict', 'findings', 'checked_patch_ids', 'checked_field_ids'], status);
  demand(value.schema_version === 1 && ['passed', 'needs_revision'].includes(value.verdict) && Array.isArray(value.findings) && value.findings.length <= 100, status, '复核格式不正确。', 'AI_OUTPUT_INVALID');
  for (const [key, targets] of [['checked_patch_ids', content.patches], ['checked_field_ids', content.form_fields]]) demand(Array.isArray(value[key]) && value[key].length === targets.length && new Set(value[key]).size === targets.length && targets.every(target => value[key].includes(target.id)), status, '复核必须完整覆盖当前版全部段落及网申字段。', 'AI_OUTPUT_INVALID');
  const targetIds = new Set([...content.patches, ...content.form_fields].map(item => item.id));
  const evidence = new Map([...inputs.profile.facts.map(fact => [fact.id, fact.text]), ...inputs.units.map(unit => [unit.id, unit.text])]);
  const findings = value.findings.map(finding => {
    keys(finding, ['target_id', 'type', 'explanation', 'evidence_ids', 'evidence_quotes'], status);
    demand(targetIds.has(finding.target_id) && issueTypes.has(finding.type) && Array.isArray(finding.evidence_ids) && new Set(finding.evidence_ids).size === finding.evidence_ids.length && finding.evidence_ids.every(id => evidence.has(id)), status, '复核问题引用了未知位置或证据。', 'AI_OUTPUT_INVALID');
    const result = { target_id: finding.target_id, type: finding.type, explanation: string(finding.explanation, 2000, status), evidence_ids: finding.evidence_ids };
    if (finding.evidence_quotes !== undefined) {
      demand(Array.isArray(finding.evidence_quotes) && finding.evidence_quotes.length <= 80, status, '复核证据格式不正确。', 'AI_OUTPUT_INVALID');
      result.evidence_quotes = finding.evidence_quotes.map(quote => {
        keys(quote, ['evidence_id', 'quote'], status); const text = string(quote.quote, 2000, status);
        demand(finding.evidence_ids.includes(quote.evidence_id) && evidence.get(quote.evidence_id)?.includes(text), status, '复核引用原文不在对应证据中。', 'AI_OUTPUT_INVALID'); return { evidence_id: quote.evidence_id, quote: text };
      });
    }
    return result;
  });
  demand((value.verdict === 'passed') === (findings.length === 0), status, '复核结论与问题列表不一致。', 'AI_OUTPUT_INVALID');
  return { schema_version: 1, verdict: value.verdict, findings, checked_patch_ids: value.checked_patch_ids, checked_field_ids: value.checked_field_ids };
}
export async function reviewMaterial(userId, materialId, body, { signal } = {}) {
  keys(body, ['version', 'consent']); const row = ownRow(userId, materialId);
  demand(integer(body.version) === row.version, 409, '材料版本已变化。', 'MATERIAL_VERSION_CONFLICT');
  demand(!row.accepted_at, 409, '已采纳材料不可再次复核。', 'MATERIAL_VERSION_CONFLICT'); freshness(userId, row);
  if (row.review_json && parsed(row.review_json).version === row.version) return { ...getMaterial(userId, materialId), cached: true };
  demand(body.consent === true, 400, '请确认同意发送事实底稿、岗位正文、源段落和当前草稿进行复核。');
  const inputs = parsed(row.inputs_json), content = validateContent(parsed(row.content_json), inputs, 400), target = await getAiTarget(userId);
  const result = await callJson(userId, { task: 'review-materials', system: reviewPrompt, input: { ...modelInput(inputs), draft: content }, signal, validate: value => validateReview(value, content, inputs) });
  resultTarget(result, target); const review = { ...validateReview(result.data, content, inputs), version: row.version, promptVersion: reviewPromptVersion,
    provider: result.provider, model: result.model, endpointFingerprint: result.endpointFingerprint, limitation, reviewedAt: now() };
  transaction(() => {
    const current = ownRow(userId, materialId); freshness(userId, current);
    demand(current.version === row.version && !current.accepted_at, 409, '材料在复核期间已变化。', 'MATERIAL_VERSION_CONFLICT');
    validateContent(parsed(current.content_json), inputs, 400);
    const usage = parsed(current.usage_json) || { draft: null, review: [] }; usage.review ||= []; usage.review.push(callUsage(result, row.version));
    const change = db.prepare('UPDATE application_materials SET review_state=?,review_json=?,usage_json=?,updated_at=? WHERE id=? AND user_id=? AND version=? AND accepted_at IS NULL')
      .run(review.verdict, JSON.stringify(review), JSON.stringify(usage), now(), materialId, userId, row.version);
    demand(change.changes === 1, 409, '材料版本已变化。', 'MATERIAL_VERSION_CONFLICT');
  });
  return { ...getMaterial(userId, materialId), cached: false };
}
function publicResume(resume) { return { id: resume.id, title: resume.title, template: resume.template, data: resume.data, revision: resume.revision, createdAt: resume.created_at, updatedAt: resume.updated_at }; }
export function createMaterialResume(userId, materialId, body) {
  keys(body, ['version', 'sourceResumeRevision', 'selectedPatchIds', 'title']);
  const row = ownRow(userId, materialId), version = integer(body.version), sourceResumeRevision = integer(body.sourceResumeRevision);
  demand(version === row.version && sourceResumeRevision === row.source_resume_revision, 409, '材料或源简历版本已变化。', 'MATERIAL_VERSION_CONFLICT');
  demand(Array.isArray(body.selectedPatchIds) && body.selectedPatchIds.length <= 63 && new Set(body.selectedPatchIds).size === body.selectedPatchIds.length, 400, '请选择有效且不重复的段落。');
  const title = body.title == null ? null : string(body.title, 100); const acceptedRequest = { version, sourceResumeRevision, selectedPatchIds: [...body.selectedPatchIds].sort(), title };
  const acceptedHash = sha256(canonicalJson(acceptedRequest));
  if (row.accepted_at) {
    demand(parsed(row.review_json)?.acceptance?.requestHash === acceptedHash, 409, '这份材料已按另一组选择采纳。', 'IDEMPOTENCY_CONFLICT');
    demand(row.created_resume_id, 410, '已采纳的新简历已被删除。', 'CREATED_RESUME_DELETED');
    return { material: getMaterial(userId, materialId), resume: publicResume(ownResume(userId, row.created_resume_id)), replayed: true };
  }
  const resumeId = transaction(() => {
    const current = ownRow(userId, materialId); const { source } = freshness(userId, current);
    demand(current.version === version && !current.accepted_at && current.review_state === 'passed', 409, '当前版材料尚未全部复核通过。', 'MATERIAL_VERSION_CONFLICT');
    const review = parsed(current.review_json); demand(review?.version === version && review.verdict === 'passed', 409, '复核版本与材料不一致。', 'MATERIAL_VERSION_CONFLICT');
    const content = validateContent(parsed(current.content_json), parsed(current.inputs_json), 400);
    demand(body.selectedPatchIds.every(id => content.patches.some(patch => patch.id === id)), 400, '选中补丁不存在。');
    demand(db.prepare('SELECT COUNT(*) AS n FROM resumes WHERE user_id=?').get(userId).n < 100, 400, '最多保存 100 份简历。');
    const data = structuredClone(source.data);
    for (const patch of content.patches.filter(patch => body.selectedPatchIds.includes(patch.id))) {
      const field = resumeField(data, patch.path); demand(field.value === patch.original, 409, '源段落已变化，请重新生成材料。', 'INPUT_CHANGED'); field.parent[field.key] = patch.revised;
    }
    const clean = sanitizeResume(data), nextId = id(), time = now(), nextTitle = title || (source.title.slice(0, 95) + ' 定制版');
    db.prepare('INSERT INTO resumes(id,user_id,title,template,data,revision,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?)').run(nextId, userId, nextTitle, source.template, JSON.stringify(clean), time, time);
    db.prepare('INSERT INTO resume_versions(id,resume_id,revision,title,template,data,reason,created_at) VALUES(?,?,1,?,?,?,?,?)').run(id(), nextId, nextTitle, source.template, JSON.stringify(clean), '采纳已复核定制材料', time);
    review.acceptance = { requestHash: acceptedHash, selectedPatchIds: acceptedRequest.selectedPatchIds, title, acceptedAt: time };
    const change = db.prepare('UPDATE application_materials SET created_resume_id=?,accepted_at=?,review_json=?,updated_at=? WHERE id=? AND user_id=? AND version=? AND accepted_at IS NULL').run(nextId, time, JSON.stringify(review), time, materialId, userId, version);
    demand(change.changes === 1, 409, '材料已在其他页面采纳。', 'MATERIAL_VERSION_CONFLICT'); return nextId;
  });
  return { material: getMaterial(userId, materialId), resume: publicResume(ownResume(userId, resumeId)), replayed: false };
}
export function deleteMaterial(userId, materialId) { const row = ownRow(userId, materialId); db.prepare('DELETE FROM application_materials WHERE id=? AND user_id=?').run(row.id, userId); return { ok: true }; }
