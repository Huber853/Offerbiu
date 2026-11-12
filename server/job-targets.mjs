import { db } from './db.mjs';
import { demand } from './security.mjs';
export const targetId = row => row?.private_job_id || row?.job_id;
export const targetColumns = jobId => jobId.startsWith('private:') ? [null, jobId] : [jobId, null];
export function privatePayload(row) {
  return { ...JSON.parse(row.payload), id: row.id, job_type: 'private', source_type: 'private', record_type: 'job',
    revision: row.revision, archived_at: row.archived_at, catalog_active: !row.archived_at,
    created_at: row.created_at, updated_at: row.updated_at, direct_apply_verified: false };
}
/** Resolve caller-owned canonical job references in one place. */
export function resolveJob(userId, jobId, { active = false, historical = false } = {}) {
  demand(typeof jobId === 'string' && jobId.length > 0 && jobId.length <= 160, 400, '岗位ID格式不正确。');
  if (jobId.startsWith('private:')) {
    const row = db.prepare('SELECT * FROM private_jobs WHERE id=? AND user_id=?').get(jobId, userId);
    demand(row, 404, '私人岗位不存在或无权访问。');
    demand(!active || !row.archived_at, 409, '私人岗位已归档，请恢复后再选择为新目标。', 'JOB_ARCHIVED');
    return privatePayload(row);
  }
  const row = db.prepare('SELECT * FROM jobs WHERE id=?').get(jobId);
  demand(row && (row.catalog_active === 1 || !active && (historical || db.prepare('SELECT id FROM applications WHERE user_id=? AND job_id=?').get(userId, jobId))), 404, '岗位不存在或不在本人可访问范围。');
  return { ...JSON.parse(row.payload), id: row.id, company: row.company, title: row.title };
}
