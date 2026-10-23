import { db, transaction } from './db.mjs';
import { demand, id, now, sha256 } from './security.mjs';
import { getEvaluation } from './job-evaluation.mjs';
import { getMaterial } from './application-materials.mjs';
import { canonicalJson, countText, normalizeText, isCalendarDate } from '../shared/job-workflow.mjs';

function keys(value, allowed) {
  demand(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)), 400, '提交包含未知字段或格式不正确。');
}
function string(value, maximum, empty = false) {
  demand(typeof value === 'string', 400, '文字字段格式不正确。'); const text = normalizeText(value);
  demand((empty || text.trim()) && countText(text) <= maximum && !text.includes('\u0000'), 400, '文字为空、过长或包含无效字符。'); return text;
}
function identifier(value) { demand(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value), 400, '记录编号格式不正确。'); return value; }
function requestId(value) { demand(typeof value === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(value), 400, 'requestId 必须为 UUID。'); return value.toLowerCase(); }
function timestamp(value) {
  demand(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && isCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value)), 400, '投递时间必须是有效且带时区的 ISO 时间。');
  return new Date(value).toISOString();
}
function ownApplication(userId, applicationId) {
  const row = db.prepare('SELECT * FROM applications WHERE id=? AND user_id=?').get(applicationId, userId);
  demand(row, 404, '投递记录不存在或无权访问。'); return row;
}
export function getSubmissionJobPreview(userId, applicationId) {
  const application = ownApplication(userId, applicationId);
  const row = db.prepare('SELECT id,company,title,payload FROM jobs WHERE id=?').get(application.job_id);
  demand(row, 404, '应用对应的岗位记录不存在。');
  const job = { ...JSON.parse(row.payload), id: row.id, company: row.company, title: row.title };
  return { job, jobHash: sha256(canonicalJson(job)) };
}
function ownResume(userId, resumeId) {
  const row = db.prepare('SELECT * FROM resumes WHERE id=? AND user_id=?').get(resumeId, userId);
  demand(row, 404, '简历不存在或无权访问。'); return row;
}
function resumeVersion(userId, resumeId, revision) {
  const current = ownResume(userId, resumeId);
  const version = db.prepare('SELECT * FROM resume_versions WHERE resume_id=? AND revision=?').get(resumeId, revision);
  // Always use the version row when available; current data cannot masquerade as old data.
  const selected = version || (current.revision === revision ? current : null);
  demand(selected, 404, '所选简历历史版本不存在。');
  return { id: resumeId, revision, title: selected.title, template: selected.template, data: JSON.parse(selected.data) };
}
function ownRow(userId, submissionId) {
  const row = db.prepare('SELECT * FROM application_submissions WHERE id=? AND user_id=?').get(submissionId, userId);
  demand(row, 404, '投递留档不存在或无权访问。'); const application = ownApplication(userId, row.application_id);
  if (row.resume_id) ownResume(userId, row.resume_id);
  if (row.material_id) {
    const material = getMaterial(userId, row.material_id);
    demand(material.applicationId === row.application_id, 404, '材料不属于该投递记录。');
    if (row.resume_id && material.createdResumeId) demand(material.createdResumeId === row.resume_id, 404, '简历与材料关联不正确。');
  }
  const snapshot = JSON.parse(row.snapshot_json);
  if (snapshot.sources.evaluationId) {
    const evaluation = db.prepare('SELECT user_id,job_id FROM job_evaluations WHERE id=?').get(snapshot.sources.evaluationId);
    // Deleting an evaluation must not invalidate its independent archive.
    if (evaluation) demand(evaluation.user_id === userId && evaluation.job_id === application.job_id, 404, '评估不属于该投递岗位。');
  }
  return row;
}
function summary(row) {
  const snapshot = JSON.parse(row.snapshot_json);
  return { id: row.id, applicationId: row.application_id, sequence: row.sequence, resumeId: row.resume_id,
    resumeRevision: row.resume_revision, resumeTitle: snapshot.resume.title, materialId: row.material_id,
    submittedAt: row.submitted_at, recordedAt: row.recorded_at, channel: row.channel, snapshotHash: row.snapshot_hash,
    jobTitle: snapshot.job.title, company: snapshot.job.company, fieldCount: snapshot.submittedFields.length, jdSnapshotFrom: snapshot.sources.jdSnapshotFrom };
}
export function getSubmission(userId, submissionId) { const row = ownRow(userId, submissionId); return { ...summary(row), snapshot: JSON.parse(row.snapshot_json) }; }
function page(query = {}) {
  const read = key => typeof query.get === 'function' ? query.get(key) : query[key];
  const limit = read('limit') == null || read('limit') === '' ? 20 : Number(read('limit'));
  const offset = read('offset') == null || read('offset') === '' ? 0 : Number(read('offset'));
  demand(Number.isInteger(limit) && limit >= 1 && limit <= 50 && Number.isInteger(offset) && offset >= 0, 400, '分页参数不正确。');
  return { limit, offset, requestKey: read('requestId') ? requestId(read('requestId')) : null };
}
export function listSubmissions(userId, applicationId, query) {
  ownApplication(userId, applicationId); const { limit, offset, requestKey } = page(query);
  const where = 'user_id=? AND application_id=?' + (requestKey ? ' AND request_key=?' : '');
  const args = [userId, applicationId, ...(requestKey ? [requestKey] : [])];
  const total = db.prepare('SELECT COUNT(*) AS n FROM application_submissions WHERE '+where).get(...args).n;
  const rows = db.prepare('SELECT * FROM application_submissions WHERE '+where+' ORDER BY submitted_at DESC,sequence DESC LIMIT ? OFFSET ?').all(...args, limit, offset);
  return { items: rows.map(row => summary(ownRow(userId, row.id))), total, limit, offset };
}
function normalizeRequest(applicationId, body) {
  keys(body, ['requestId', 'resumeId', 'resumeRevision', 'materialId', 'jdSnapshotFrom', 'evaluationId', 'expectedJobHash', 'submittedFields', 'submittedAt', 'channel', 'confirmedSubmitted']);
  const key = requestId(body.requestId);
  demand(Number.isInteger(body.resumeRevision) && body.resumeRevision >= 1, 400, '请选择有效简历版本。');
  demand(['evaluation', 'current_catalog'].includes(body.jdSnapshotFrom), 400, '请选择岗位快照来源。');
  const evaluationId = body.evaluationId == null || body.evaluationId === '' ? null : identifier(body.evaluationId);
  demand(body.jdSnapshotFrom !== 'evaluation' || evaluationId, 400, '评估快照来源必须选择评估。');
  const expectedJobHash = body.expectedJobHash ?? null;
  demand(expectedJobHash === null || typeof expectedJobHash === 'string' && /^[a-f0-9]{64}$/.test(expectedJobHash), 400, '预览岗位版本标识不正确。');
  demand(Array.isArray(body.submittedFields) && body.submittedFields.length <= 8, 400, '一次最多留档 8 项网申字段。');
  const sourceIds = new Set();
  const submittedFields = body.submittedFields.map(field => {
    keys(field, ['sourceFieldId', 'text']); const sourceFieldId = field.sourceFieldId == null || field.sourceFieldId === '' ? null : identifier(field.sourceFieldId);
    demand(!sourceFieldId || !sourceIds.has(sourceFieldId), 400, '同一生成字段不可重复留档。'); if (sourceFieldId) sourceIds.add(sourceFieldId);
    return { sourceFieldId, text: string(field.text, 1000, true) };
  });
  return { key, request: { applicationId, resumeId: identifier(body.resumeId), resumeRevision: body.resumeRevision,
    materialId: body.materialId == null || body.materialId === '' ? null : identifier(body.materialId), jdSnapshotFrom: body.jdSnapshotFrom, evaluationId, expectedJobHash,
    submittedFields, submittedAt: timestamp(body.submittedAt), channel: string(body.channel, 80) } };
}
function replay(userId, request, row) {
  const snapshot = JSON.parse(row.snapshot_json);
  demand(sha256(canonicalJson({ request, versions: snapshot.sources.versions })) === row.request_hash, 409, '同一 requestId 已用于不同投递内容。', 'IDEMPOTENCY_CONFLICT');
  return { ...getSubmission(userId, row.id), replayed: true };
}
export function createSubmission(userId, applicationId, body) {
  ownApplication(userId, applicationId); const { key, request } = normalizeRequest(applicationId, body);
  const existing = db.prepare('SELECT * FROM application_submissions WHERE user_id=? AND request_key=?').get(userId, key);
  // Resolve successful retries before dereferencing sources that may now have been deleted.
  if (existing) return replay(userId, request, existing);
  demand(body.confirmedSubmitted === true, 400, '请明确确认已投递，且本次留档与实际使用的材料一致。');
  const submissionId = transaction(() => {
    const duplicate = db.prepare('SELECT * FROM application_submissions WHERE user_id=? AND request_key=?').get(userId, key);
    if (duplicate) { replay(userId, request, duplicate); return duplicate.id; }
    const application = ownApplication(userId, applicationId), resume = resumeVersion(userId, request.resumeId, request.resumeRevision);
    const material = request.materialId ? getMaterial(userId, request.materialId) : null;
    if (material) {
      demand(material.applicationId === applicationId, 404, '所选材料不属于该投递记录。');
      demand(material.acceptedAt && material.createdResumeId === resume.id, 409, '请选择由该材料采纳创建的简历。', 'INPUT_CHANGED');
    }
    const evaluation = request.evaluationId ? getEvaluation(userId, request.evaluationId) : null;
    if (evaluation) demand(evaluation.jobId === application.job_id, 404, '所选评估不属于该岗位。');
    let job, jdSupplement = '', units = [];
    if (request.jdSnapshotFrom === 'evaluation') {
      job = structuredClone(evaluation.inputs.job); jdSupplement = evaluation.inputs.jdSupplement || ''; units = structuredClone(evaluation.inputs.units);
    } else {
      const preview = getSubmissionJobPreview(userId, applicationId);
      demand(!request.expectedJobHash || request.expectedJobHash === preview.jobHash, 409, '岗位在预览之后已变化，请返回重新核对最终预览。', 'SUBMISSION_PREVIEW_CHANGED');
      job = preview.job;
    }
    const submittedFields = request.submittedFields.map(field => {
      const source = field.sourceFieldId ? material?.content.form_fields.find(item => item.id === field.sourceFieldId) : null;
      demand(!field.sourceFieldId || source, 400, '所选网申字段不存在于本次材料中。');
      const editedByUser = !source || field.text !== normalizeText(source.text);
      return { sourceFieldId: field.sourceFieldId, type: source?.type || 'manual', text: field.text, editedByUser,
        reviewed: Boolean(source && !editedByUser && material.reviewState === 'passed'),
        ...(source ? { countMode: source.count_mode, maxLength: source.max_length, usedLength: countText(field.text, source.count_mode) } : { countMode: 'codepoints', usedLength: countText(field.text) }) };
    });
    const time = now();
    const versions = { resumeHash: sha256(canonicalJson({title:resume.title,template:resume.template,data:resume.data})),
      jobHash: sha256(canonicalJson({job,jdSupplement,units})), materialVersion: material?.version || null, evaluationJobHash: evaluation?.jobHash || null };
    const snapshot = { schemaVersion: 1, job, jdSupplement, units, resume, submittedFields,
      sources: { jdSnapshotFrom: request.jdSnapshotFrom, evaluationId: request.evaluationId, materialId: request.materialId, materialVersion: material?.version || null, request, versions },
      confirmation: { confirmedSubmitted: true, confirmedAt: time, statement: '本人确认本次留档与实际使用材料一致；本系统未核验官网回执或企业收件。' } };
    const previousSequence = db.prepare('SELECT MAX(sequence) AS n FROM application_submissions WHERE application_id=? AND user_id=?').get(applicationId, userId).n || 0;
    const events = db.prepare("SELECT payload FROM application_events WHERE application_id=? AND user_id=? AND kind='submission_recorded'").all(applicationId, userId);
    const eventSequence = events.reduce((highest, event) => Math.max(highest, Number(JSON.parse(event.payload).sequence) || 0), 0);
    const sequence = Math.max(previousSequence, eventSequence) + 1, nextId = id();
    db.prepare(`INSERT INTO application_submissions(id,user_id,application_id,sequence,request_key,request_hash,resume_id,resume_revision,material_id,submitted_at,recorded_at,channel,snapshot_json,snapshot_hash)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(nextId, userId, applicationId, sequence, key, sha256(canonicalJson({request,versions})), resume.id, resume.revision, request.materialId, request.submittedAt, time, request.channel, JSON.stringify(snapshot), sha256(canonicalJson(snapshot)));
    const firstSubmission = events.length === 0 && previousSequence === 0;
    const advance = firstSubmission && application.status === 'saved';
    if (advance) db.prepare("UPDATE applications SET status='applied',applied_at=COALESCE(applied_at,?),updated_at=? WHERE id=? AND user_id=? AND status='saved'").run(request.submittedAt, time, applicationId, userId);
    db.prepare('INSERT INTO application_events(id,user_id,application_id,kind,payload,created_at) VALUES(?,?,?,?,?,?)').run(id(), userId, applicationId, 'submission_recorded',
      JSON.stringify({submissionId:nextId,sequence,channel:request.channel,submittedAt:request.submittedAt,resumeRevision:resume.revision,...(advance?{from:'saved',to:'applied'}:{})}), time);
    return nextId;
  });
  return { ...getSubmission(userId, submissionId), replayed: false };
}
export function deleteSubmission(userId, submissionId) { const row = ownRow(userId, submissionId); db.prepare('DELETE FROM application_submissions WHERE id=? AND user_id=?').run(row.id, userId); return { ok: true }; }
