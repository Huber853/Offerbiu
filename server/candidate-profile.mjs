import { db, transaction } from './db.mjs';
import { demand, id, sha256 } from './security.mjs';
import { FACT_KINDS, PROFILE_SCHEMA_VERSION, canonicalJson, countText, isCalendarDate, normalizeText } from '../shared/job-workflow.mjs';

const emptyPreferences = () => ({ targetRoles: [], preferredCities: [], cityConstraint: 'preferred', graduationDate: '', degree: '', major: '', languages: [], confirmedAt: null });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const detailedAddress = value => /(?:详细地址|街道|小区|单元|\d+\s*(?:号|栋|楼|室)|[路街巷]\s*\d)/u.test(value);

function string(value, max, label, required = false) {
  demand(typeof value === 'string', 400, `${label}必须是文字。`);
  const result = normalizeText(value);
  demand(countText(result) <= max && (!required || result.trim()), 400, `${label}为空或超过${max}个码点。`);
  return result;
}

function identifier(value, label) {
  demand(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(value), 400, `${label}格式不正确。`);
  return value;
}

// Contact details sometimes appear inside copied prose. Strip both known values
// and recognizable contact forms before saving excerpts or constructing AI input.
export function createProfileRedactor(userId) {
  const user = db.prepare('SELECT name,email FROM users WHERE id=?').get(userId);
  const privateValues = new Set([user?.name, user?.email].filter(value => typeof value === 'string' && value.length > 1));
  for (const row of db.prepare('SELECT data FROM resumes WHERE user_id=?').all(userId)) {
    const basics = JSON.parse(row.data).basics || {};
    for (const key of ['name', 'email', 'phone', 'website', 'address', 'detailedAddress']) {
      if (typeof basics[key] === 'string' && basics[key].trim().length > 1) privateValues.add(normalizeText(basics[key].trim()));
    }
    if (typeof basics.city === 'string' && detailedAddress(basics.city)) privateValues.add(basics.city);
  }
  const values = [...privateValues].sort((a, b) => b.length - a.length);
  return value => {
    let safe = normalizeText(value);
    for (const secret of values) safe = safe.split(secret).join('');
    return safe.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
      .replace(/(?<!\d)(?:\+?86[- ]?)?1[3-9]\d{9}(?!\d)/g, '')
      .replace(/(?<!\d)(?:\+?\d{1,3}[- ])?0\d{2,3}[- ]\d{7,8}(?!\d)/g, '')
      .replace(/(?:详细地址|联系地址|家庭住址|住址)\s*[:：]?[^\n；;]*/gu, '')
      .replace(/[^\n；;，,]+/gu, segment => /(?:街道|小区)[^\n]{0,30}\d+\s*(?:号|栋|单元|室)|\d+\s*(?:号楼|栋|单元|室)|[路街巷]\s*\d+号/u.test(segment) ? '' : segment);
  };
}

function preferencesFrom(value, redact) {
  demand(isObject(value), 400, '求职偏好格式不正确。');
  function list(items, label, max = 120) {
    demand(Array.isArray(items) && items.length <= 20, 400, `${label}须为最多20项的列表。`);
    return [...new Set(items.map(item => redact(string(item, max, label, true))).filter(item => item.trim()))];
  }
  const result = emptyPreferences();
  result.targetRoles = list(value.targetRoles ?? [], '目标方向');
  result.preferredCities = list(value.preferredCities ?? [], '意向城市', 80).filter(item => !detailedAddress(item));
  demand(value.cityConstraint === undefined || ['preferred', 'required'].includes(value.cityConstraint), 400, '城市偏好只能是 preferred 或 required。');
  result.cityConstraint = value.cityConstraint || 'preferred';
  result.graduationDate = string(value.graduationDate ?? '', 10, '毕业日期');
  demand(!result.graduationDate || /^\d{4}-\d{2}$/.test(result.graduationDate) && isCalendarDate(`${result.graduationDate}-01`) || isCalendarDate(result.graduationDate), 400, '毕业日期须为有效 YYYY-MM 或 YYYY-MM-DD。');
  result.degree = redact(string(value.degree ?? '', 80, '学历'));
  result.major = redact(string(value.major ?? '', 120, '专业'));
  demand(value.languages === undefined || Array.isArray(value.languages) && value.languages.length <= 20, 400, '语言证书须为最多20项的列表。');
  result.languages = (value.languages || []).map(item => {
    demand(isObject(item), 400, '语言证书格式不正确。');
    demand(item.value === undefined || item.value === null || typeof item.value === 'number' && Number.isFinite(item.value) && item.value >= 0, 400, '证书数值格式不正确。');
    return { name: redact(string(item.name ?? '', 80, '语言名称', true)), qualification: redact(string(item.qualification ?? '', 120, '证书名称')), value: item.value ?? null, confirmedAt: null };
  });
  return result;
}

function readiness(profile) {
  const missing = [];
  if (!profile.preferences.confirmedAt || !profile.preferences.targetRoles.length) missing.push('请确认至少一个目标方向及求职偏好。');
  if (!profile.facts.some(fact => fact.kind === 'education' && fact.status === 'confirmed')) missing.push('请确认至少一项教育信息。');
  if (!profile.facts.some(fact => ['experience', 'project', 'skill'].includes(fact.kind) && fact.status === 'confirmed')) missing.push('请确认至少一项项目、实习或技能事实。');
  return { ready: missing.length === 0, missing };
}

function profileRow(userId) { return db.prepare('SELECT * FROM candidate_profiles WHERE user_id=?').get(userId); }

export function getProfile(userId) {
  const row = profileRow(userId);
  const stored = row ? JSON.parse(row.data_json) : { preferences: emptyPreferences(), facts: [] };
  const result = { schemaVersion: PROFILE_SCHEMA_VERSION, revision: row?.revision || 0, preferences: stored.preferences, facts: stored.facts, createdAt: row?.created_at || null, updatedAt: row?.updated_at || null };
  return { ...result, ...readiness(result) };
}

function resumeVersion(userId, resumeId, revision, status = 404) {
  const current = db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(resumeId, userId);
  demand(current, status, '找不到本人指定的源简历。');
  if (current.revision === revision) return JSON.parse(current.data);
  const version = db.prepare('SELECT data FROM resume_versions WHERE resume_id=? AND revision=?').get(resumeId, revision);
  demand(version, status === 404 ? 409 : status, '指定的源简历版本已不存在，请重新导入。');
  return JSON.parse(version.data);
}

function mappedFacts(resumeId, revision, data, redact) {
  const facts = [];
  for (const [section, kind] of [['education', 'education'], ['experience', 'experience'], ['projects', 'project']]) {
    for (const [index, item] of (Array.isArray(data[section]) ? data[section] : []).entries()) {
      const fields = section === 'education' ? ['school', 'degree', 'major', 'start', 'end', 'details'] : section === 'experience' ? ['company', 'role', 'start', 'end', 'details'] : ['name', 'role', 'start', 'end', 'details'];
      const value = fields.map(key => typeof item?.[key] === 'string' ? item[key] : '').filter(Boolean).join('\n');
      const safe = redact(value);
      if (safe.trim()) facts.push({ kind, entityKey: `resume_${resumeId}_${section}_${index}`, text: safe, field: `${section}.${index}` });
    }
  }
  for (const [field, kind] of [['skills', 'skill'], ['awards', 'award']]) {
    for (const [index, line] of normalizeText(data[field]).split('\n').entries()) {
      const safe = redact(line);
      if (safe.trim()) facts.push({ kind, entityKey: `resume_${resumeId}_${field}_${index}`, text: safe, field: `${field}.${index}` });
    }
  }
  return facts.map(fact => ({ ...fact, source: { type: 'resume', resumeId, resumeRevision: revision, field: fact.field, excerpt: fact.text } }));
}

export function importProfile(userId, body) {
  demand(isObject(body), 400, '导入请求格式不正确。');
  const resumeId = identifier(body.resumeId, '源简历');
  demand(Number.isSafeInteger(body.resumeRevision) && body.resumeRevision >= 1, 400, '请指定源简历版本。');
  const data = resumeVersion(userId, resumeId, body.resumeRevision);
  const redact = createProfileRedactor(userId);
  const education = Array.isArray(data.education) ? data.education.find(item => item && (item.degree || item.end || item.major)) : null;
  const date = normalizeText(education?.end);
  const preferences = preferencesFrom({ targetRoles: data.basics?.headline ? [data.basics.headline] : [], preferredCities: data.basics?.city ? [data.basics.city] : [],
    graduationDate: /^\d{4}-\d{2}(?:-\d{2})?$/.test(date) ? date : '', degree: education?.degree || '', major: education?.major || '' }, redact);
  const facts = mappedFacts(resumeId, body.resumeRevision, data, redact).map(({ field, ...fact }) => ({ id: `fact_${id()}`, ...fact, status: 'draft', confirmedAt: null }));
  demand(facts.length <= 80 && facts.every(fact => countText(fact.text) <= 1200), 400, '源简历条目过多或单项超过1200个码点，请先精简后导入。');
  const result = { schemaVersion: PROFILE_SCHEMA_VERSION, revision: getProfile(userId).revision, sourceResumeId: resumeId, sourceResumeRevision: body.resumeRevision, preferences, facts };
  return { ...result, ...readiness(result) };
}

function validatedSource(userId, submitted, previous, fact, redact, timestamp) {
  const source = submitted ?? { type: 'manual' };
  demand(isObject(source) && ['resume', 'manual'].includes(source.type), 400, '事实来源格式不正确。');
  if (previous) {
    demand(canonicalJson(source) === canonicalJson(previous.source), 400, '不能改写已保存事实的来源指针。');
    if (fact.text === previous.text && fact.kind === previous.kind && fact.entityKey === previous.entityKey) return previous.source.type === 'manual' ? { ...previous.source, confirmedAt: timestamp } : previous.source;
    return { type: 'manual', confirmedAt: timestamp, originalSource: previous.source.type === 'resume' ? previous.source : previous.source.originalSource || undefined };
  }
  if (source.type === 'manual') {
    demand(Object.keys(source).every(key => ['type', 'confirmedAt', 'originalSource'].includes(key)), 400, '手工事实不能附带未经验证的来源指针。');
    let originalSource;
    if (source.originalSource !== undefined) {
      const original = source.originalSource;
      demand(isObject(original) && original.type === 'resume', 400, '原始来源必须是本人简历的导入来源。');
      identifier(original.resumeId, '源简历');
      demand(Number.isSafeInteger(original.resumeRevision) && original.resumeRevision >= 1, 400, '源简历版本不正确。');
      const originalData = resumeVersion(userId, original.resumeId, original.resumeRevision, 400);
      const actual = mappedFacts(original.resumeId, original.resumeRevision, originalData, redact).find(item => item.field === original.field);
      demand(actual && original.excerpt === actual.source.excerpt, 400, '原始来源与本人源简历不一致。');
      originalSource = actual.source;
    }
    return { type: 'manual', confirmedAt: timestamp, ...(originalSource ? { originalSource } : {}) };
  }
  identifier(source.resumeId, '源简历');
  demand(Number.isSafeInteger(source.resumeRevision) && source.resumeRevision >= 1, 400, '源简历版本不正确。');
  const data = resumeVersion(userId, source.resumeId, source.resumeRevision, 400);
  const actual = mappedFacts(source.resumeId, source.resumeRevision, data, redact).find(item => item.field === source.field);
  demand(actual && source.excerpt === actual.source.excerpt && fact.text === actual.text && fact.kind === actual.kind && fact.entityKey === actual.entityKey, 400, '导入事实与本人源简历不一致，请重新导入或添加手工事实。');
  return actual.source;
}

export function saveProfile(userId, body) {
  demand(isObject(body), 400, '底稿格式不正确。');
  demand(Buffer.byteLength(JSON.stringify(body), 'utf8') <= 200000, 413, '底稿请求超过200000字节。');
  demand(Number.isSafeInteger(body.revision) && body.revision >= 0, 400, '请携带底稿版本。');
  demand(typeof body.confirmPreferences === 'boolean' && Array.isArray(body.confirmedFactIds), 400, '请明确提交偏好确认及已确认事实列表。');
  demand(Array.isArray(body.facts) && body.facts.length <= 80, 400, '底稿最多保存80条事实。');
  const oldRow = profileRow(userId);
  demand((oldRow?.revision || 0) === body.revision, 409, '底稿已更新，请刷新后再保存。', 'PROFILE_CHANGED');
  const old = oldRow ? JSON.parse(oldRow.data_json) : { facts: [], retiredFactIds: [] };
  const oldById = new Map(old.facts.map(fact => [fact.id, fact]));
  const retired = new Set(old.retiredFactIds || []);
  const confirmed = new Set(body.confirmedFactIds.map(value => identifier(value, '确认条目')));
  demand(confirmed.size === body.confirmedFactIds.length, 400, '确认条目不能重复。');
  const redact = createProfileRedactor(userId);
  // Confirmation is server-owned and must advance even for two saves within one
  // clock tick; otherwise a newer revision could collide with a stale cache key.
  const timestamp = new Date(Math.max(Date.now(), oldRow ? Date.parse(oldRow.updated_at) + 1 : 0)).toISOString();
  const preferences = preferencesFrom(body.preferences, redact);
  preferences.confirmedAt = body.confirmPreferences ? timestamp : null;
  preferences.languages.forEach(item => { item.confirmedAt = preferences.confirmedAt; });
  const seen = new Set();
  const facts = body.facts.map(item => {
    demand(isObject(item), 400, '事实条目格式不正确。');
    const factId = identifier(item.id, '事实ID');
    demand(!seen.has(factId) && !retired.has(factId), 400, '事实ID不能重复或复用已删除的ID。');
    seen.add(factId);
    demand(FACT_KINDS.includes(item.kind), 400, '事实类型不正确。');
    demand(item.status === undefined || ['draft', 'confirmed'].includes(item.status), 400, '事实状态不正确。');
    const fact = { id: factId, kind: item.kind, entityKey: identifier(item.entityKey, '经历实体ID'), text: redact(string(item.text, 1200, '事实正文', true)) };
    demand(fact.text.trim(), 400, '事实正文去除联系方式后为空。');
    const confirmedAt = confirmed.has(factId) ? timestamp : null;
    return { ...fact, status: confirmedAt ? 'confirmed' : 'draft', confirmedAt, source: validatedSource(userId, item.source, oldById.get(factId), fact, redact, confirmedAt) };
  });
  demand([...confirmed].every(factId => seen.has(factId)), 400, '确认列表包含不存在的事实。');
  for (const oldFact of old.facts) if (!seen.has(oldFact.id)) retired.add(oldFact.id);
  const data = { schemaVersion: PROFILE_SCHEMA_VERSION, preferences, facts, retiredFactIds: [...retired] };
  transaction(() => {
    if (oldRow) {
      const changed = db.prepare('UPDATE candidate_profiles SET revision=revision+1,data_json=?,updated_at=? WHERE user_id=? AND revision=?')
        .run(JSON.stringify(data), timestamp, userId, body.revision).changes;
      demand(changed === 1, 409, '底稿已更新，请刷新后再保存。', 'PROFILE_CHANGED');
    } else {
      demand(!profileRow(userId), 409, '底稿已创建，请刷新。', 'PROFILE_CHANGED');
      db.prepare('INSERT INTO candidate_profiles(user_id,revision,schema_version,data_json,created_at,updated_at) VALUES(?,1,?,?,?,?)')
        .run(userId, PROFILE_SCHEMA_VERSION, JSON.stringify(data), timestamp, timestamp);
    }
  });
  return getProfile(userId);
}

export function deleteProfile(userId) {
  db.prepare('DELETE FROM candidate_profiles WHERE user_id=?').run(userId);
  return { deleted: true, retainedHistory: true };
}

export function profileInput(userId, revision) {
  const profile = getProfile(userId);
  demand(profile.revision > 0 && Number.isSafeInteger(revision) && profile.revision === revision, 409, '底稿不存在或版本已变化，请刷新。', 'PROFILE_CHANGED');
  demand(profile.ready, 400, profile.missing.join(' '), 'PROFILE_INCOMPLETE');
  const redact = createProfileRedactor(userId);
  const facts = profile.facts.filter(fact => fact.status === 'confirmed').map(fact => ({ id: fact.id, kind: fact.kind, entityKey: `entity_${sha256(fact.entityKey).slice(0, 24)}`, text: redact(fact.text), confirmedAt: fact.confirmedAt }));
  demand(facts.reduce((total, fact) => total + countText(fact.text), 0) <= 16000, 400, '已确认底稿超过16000个码点，请精简后评估。', 'PROFILE_TOO_LARGE');
  const preferences = preferencesFrom(profile.preferences, redact);
  preferences.confirmedAt = profile.preferences.confirmedAt;
  preferences.languages.forEach((item, index) => { item.confirmedAt = profile.preferences.languages[index].confirmedAt; });
  const safe = { preferences, facts };
  return { revision: profile.revision, hash: sha256(canonicalJson(safe)), ...safe };
}
