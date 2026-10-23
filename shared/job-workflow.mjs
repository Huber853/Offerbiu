// This module is also imported directly by the browser; keep Node APIs out.
export const PROFILE_SCHEMA_VERSION = 1;
export const EVALUATION_RULE_VERSION = '1';
export const EVALUATION_PROMPT_VERSION = '2';
export const FACT_KINDS = ['education', 'experience', 'project', 'skill', 'award', 'other'];
export const COUNT_MODES = ['codepoints', 'utf16', 'utf8_bytes'];
export const GATE_STATES = ['pass', 'fail', 'needs_review'];
export const CONTENT_QUALITY_LEVELS = ['complete', 'partial', 'reference_only', 'unknown'];

export function normalizeText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFC').replace(/\r\n?/g, '\n');
}

export function countText(value, mode = 'codepoints') {
  const normalized = normalizeText(value);
  if (mode === 'codepoints') return Array.from(normalized).length;
  if (mode === 'utf16') return normalized.length;
  if (mode === 'utf8_bytes') return new TextEncoder().encode(normalized).length;
  throw new TypeError('不支持的字数口径。');
}

export function canonicalJson(value) {
  function canonical(item) {
    if (typeof item === 'string') return normalizeText(item);
    if (item === null || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return item;
    if (Array.isArray(item)) return item.map(canonical);
    if (item && typeof item === 'object') {
      const normalized = Object.entries(item).filter(([, part]) => part !== undefined)
        .map(([key, part]) => [normalizeText(key), canonical(part)]);
      normalized.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
      if (new Set(normalized.map(([key]) => key)).size !== normalized.length) throw new TypeError('归一化后的对象字段重复。');
      return Object.fromEntries(normalized);
    }
    throw new TypeError('内容必须是有效的 JSON 数据。');
  }
  return JSON.stringify(canonical(value));
}

export function qualityForJob(job = {}) {
  const quality = job.content_quality || job.contentQuality;
  const level = CONTENT_QUALITY_LEVELS.includes(quality?.level) ? quality.level : 'unknown';
  return { level, reason: normalizeText(quality?.reason) || (level === 'unknown' ? '尚未检查该岗位正文完整度。' : '') };
}

export function isZonedTimestamp(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?(?:Z|[+-](\d{2}):(\d{2}))$/);
  return Boolean(match && isCalendarDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59
    && Number(match[4] || 0) <= 59 && Number(match[5] || 0) <= 23 && Number(match[6] || 0) <= 59 && Number.isFinite(Date.parse(value)));
}

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function deadlineInfo(value, time = new Date()) {
  const now = time instanceof Date ? time : new Date(time);
  if (isCalendarDate(value)) {
    const today = new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
    const remaining = (Date.parse(`${value}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    return { known: true, expired: value < today, urgent: remaining >= 0 && remaining <= 7, value };
  }
  if (isZonedTimestamp(value)) {
    const remaining = Date.parse(value) - now.getTime();
    return { known: true, expired: remaining < 0, urgent: remaining >= 0 && remaining <= 7 * 86400000, value };
  }
  return { known: false, expired: false, urgent: false, value: null };
}

export function availabilityForJob(job = {}, time = new Date()) {
  const raw = job.availability && typeof job.availability === 'object' ? job.availability : {};
  const timestamp = value => isZonedTimestamp(value) ? new Date(value).toISOString() : null;
  const checked = timestamp(raw.checked_at);
  const quote = normalizeText(raw.evidence_quote);
  const evidenceUrl = typeof raw.evidence_url === 'string' && /^https:\/\//i.test(raw.evidence_url) ? raw.evidence_url : null;
  const method = typeof raw.method === 'string' && raw.method ? raw.method : null;
  // HTTP status and old link checks cannot establish whether an application is open.
  const applicableUrls = [job.source_url, job.sourceUrl, job.apply_url, job.applyUrl, job.cohort_evidence_url, job.cohortEvidenceUrl].filter(value => typeof value === 'string' && value);
  const failedRequest = Number.isInteger(raw.http_status) && raw.http_status >= 400;
  const positiveEvidence = Boolean(checked && method && evidenceUrl && applicableUrls.includes(evidenceUrl) && quote && !failedRequest);
  const state = ['available', 'closed'].includes(raw.state) && positiveEvidence ? raw.state : 'unknown';
  const result = {
    state, checked_at: checked, method,
    http_status: Number.isInteger(raw.http_status) ? raw.http_status : null,
    evidence_url: evidenceUrl, evidence_quote: quote || null,
    last_available_at: timestamp(raw.last_available_at),
    failure_type: typeof raw.failure_type === 'string' ? raw.failure_type : null,
    reason: state === 'unknown' ? '尚无明确的当前招聘状态证据。' : quote,
    needs_recheck: !checked || state !== 'available' || new Date(time).getTime() - Date.parse(checked) > 7 * 86400000,
  };
  if (deadlineInfo(job.deadline, time).expired) {
    result.state = 'closed';
    result.reason = '已过明确截止日期。';
    result.method = 'deadline';
    result.evidence_quote = job.deadline;
  }
  return result;
}
