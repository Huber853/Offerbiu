import { createHash } from 'node:crypto';
import { availabilityForJob, canonicalJson, CONTENT_QUALITY_LEVELS } from '../shared/job-workflow.mjs';

// A review belongs to one collected text snapshot. New source text needs a new review.
export function jobReviewHash(job) {
  const fields = ['id', 'company', 'title', 'description', 'requirements', 'education', 'cohort', 'cohort_evidence', 'cities', 'source_url', 'apply_url'];
  return createHash('sha256').update(canonicalJson(Object.fromEntries(fields.map(key => [key, job[key] ?? null])))).digest('hex');
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
