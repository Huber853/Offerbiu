import { createHash } from 'node:crypto';
import { availabilityForJob, canonicalJson, CONTENT_QUALITY_LEVELS } from '../shared/job-workflow.mjs';

// A review belongs to one collected text snapshot. New source text needs a new review.
export function jobReviewHash(job) {
  const fields = ['id', 'company', 'title', 'description', 'requirements', 'education', 'cohort', 'cohort_evidence', 'cities', 'source_url', 'apply_url'];
  return createHash('sha256').update(canonicalJson(Object.fromEntries(fields.map(key => [key, job[key] ?? null])))).digest('hex');
}

export function mergeCatalogJobs(baseJobs, extraJobs) {
  const merged = new Map();
  for (const job of baseJobs || []) if (job?.id) merged.set(job.id, job);
  let added = 0;
  for (const job of extraJobs || []) {
    if (!job?.id || merged.has(job.id)) continue;
    merged.set(job.id, job);
    added += 1;
  }
  return { jobs: [...merged.values()], added };
}

export function applyReviewedJob(job, review) {
  if (!review || review.job_id !== job.id || review.source_hash !== jobReviewHash(job)) return job;
  const result = { ...job };
  if (CONTENT_QUALITY_LEVELS.includes(review.content_quality?.level)) result.content_quality = structuredClone(review.content_quality);
  if (Array.isArray(review.eligibility_constraints)) result.eligibility_constraints = structuredClone(review.eligibility_constraints);
  if (review.availability && typeof review.availability === 'object') {
    result.availability = structuredClone(review.availability);
    if (availabilityForJob(result).state === 'closed') result.catalog_status = 'withdrawn';
  }
  return result;
}

function reviewAvailability(job, availability) {
  if (!availability || typeof availability !== 'object') return null;
  const normalized = availabilityForJob({ ...job, availability });
  return {
    state: normalized.state,
    reason: normalized.reason || availability.reason || '',
    evidence_quote: normalized.evidence_quote,
    checked_at: normalized.checked_at,
    method: normalized.method,
    http_status: normalized.http_status,
    evidence_url: normalized.evidence_url,
    last_available_at: normalized.last_available_at,
    failure_type: normalized.failure_type,
  };
}

/**
 * Merge one public evidence probe into an existing review.
 * Unknown probes do not erase a prior content review or eligibility rules.
 * Available/closed states survive only when availabilityForJob accepts the evidence.
 */
export function mergeEvidenceReview(job, current, probe) {
  if (!probe || probe.job_id !== job.id || probe.source_hash !== jobReviewHash(job)) {
    return { review: current || null, action: 'skipped', reason: probe?.source_hash && probe.source_hash !== jobReviewHash(job) ? 'hash-mismatch' : 'invalid-probe' };
  }
  const availability = reviewAvailability(job, probe.availability) || current?.availability || {
    state: 'unknown', reason: '尚无明确的当前招聘状态证据。', evidence_quote: null, checked_at: null, method: null, http_status: null, evidence_url: null, last_available_at: null,
  };
  const incomingQuality = probe.content_quality;
  const keepQuality = !incomingQuality || incomingQuality.level === 'unknown' || !CONTENT_QUALITY_LEVELS.includes(incomingQuality.level);
  const content_quality = keepQuality
    ? (current?.content_quality || { level: 'unknown', reason: incomingQuality?.reason || '尚未审核正文完整度。', reference_urls: [] })
    : structuredClone(incomingQuality);
  const review = {
    job_id: job.id,
    source_hash: probe.source_hash,
    reviewed_at: probe.checked_at || probe.availability?.checked_at || current?.reviewed_at || null,
    review_basis: probe.review_basis || current?.review_basis || '公开页面证据更新；未知状态保持未知，不据此放宽评估门。',
    content_quality,
    availability,
    eligibility_constraints: Array.isArray(current?.eligibility_constraints) ? structuredClone(current.eligibility_constraints) : [],
  };
  const changed = !current || canonicalJson(current) !== canonicalJson(review);
  return { review, action: current ? (changed ? 'updated' : 'unchanged') : 'added', reason: '' };
}

export function mergeEvidenceDocument(jobs, document, probes, reviewedAt) {
  const byId = new Map((document?.reviews || []).map(review => [review.job_id, review]));
  const jobsById = new Map(jobs.map(job => [job.id, job]));
  const report = { added: 0, updated: 0, unchanged: 0, skipped: [] };
  for (const probe of probes || []) {
    const job = jobsById.get(probe?.job_id);
    if (!job) { report.skipped.push({ job_id: probe?.job_id || '', reason: 'missing-job' }); continue; }
    const merged = mergeEvidenceReview(job, byId.get(job.id), probe);
    if (merged.action === 'skipped') { report.skipped.push({ job_id: job.id, reason: merged.reason }); continue; }
    report[merged.action] += 1;
    if (merged.review) byId.set(job.id, merged.review);
  }
  const changed = report.added + report.updated > 0;
  return {
    document: {
      schema_version: document?.schema_version || 1,
      reviewed_at: changed ? reviewedAt : (document?.reviewed_at || reviewedAt),
      catalog_collected_at: document?.catalog_collected_at || null,
      scope: document?.scope || '公开页面证据与正文哈希绑定的审核记录。未知状态保持未知。',
      reviews: [...byId.values()],
    },
    report,
  };
}
