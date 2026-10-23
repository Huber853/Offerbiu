import { api } from './api.js';
import { escape as e, date, time, localDateInput, toast, dialog, downloadJson, emptyState } from './ui.js';
import { resumeText } from '../shared/templates.mjs';
import { countText, normalizeText } from '../shared/job-workflow.mjs';
import { evaluationSummaryMarkup, jobQualityMarkup } from './job-evaluation.js';

const fieldTypes = { self_introduction: '自我介绍', project_introduction: '项目介绍', application_reason: '申请理由', opening_message: '沟通开场白' };
const modes = { codepoints: 'Unicode 码点', utf16: 'UTF-16 单元', utf8_bytes: 'UTF-8 字节' };
const listItems = result => Array.isArray(result) ? result : result?.items || [];
const reviewLabel = material => material.acceptedAt || material.createdResumeId ? '已采纳' : material.reviewState === 'passed' ? '本版复核通过' : material.reviewState === 'needs_revision' ? '需要修改' : '待复核';
const gateLabel = state => ({ pass: '条件通过', needs_review: '待核实', fail: '条件不符' })[state] || '待核实';

export function selectedSubmissionFields(fields) {
  return fields.filter(field => field.selected).map(field => ({ sourceFieldId: field.sourceFieldId || null, text: normalizeText(field.text) }));
}

function references(ids, facts) {
  return (ids || []).map(id => {
    const fact = facts.find(x => x.id === id);
    return `<details class="wf-evidence"><summary>事实依据 ${e(id)}</summary><p>${e(fact?.text || '请查看导出的输入快照核对该事实。')}</p>${fact?.source?.excerpt ? `<small>来源片段：${e(fact.source.excerpt)}</small>` : ''}</details>`;
  }).join('');
}
function plainQuestion(question) { return typeof question === 'string' ? question : question.question || question.message || question.reason || question.explanation || ''; }
function pendingConditions(evaluation) { return (evaluation?.result?.gates || []).filter(x => x.state === 'needs_review'); }
function snapshotMarkup(snapshot) {
  const job = snapshot.job || {}, resume = snapshot.resume || {};
  const jdSupplement = snapshot.jdSupplement || job.jdSupplement || job.jd_supplement;
  return `<div class="wf-notice"><strong>JD 来源：${e(snapshot.jdSnapshotFrom || ({ evaluation: '所选评估的固定 JD 输入', current_catalog: '当前应用对应的岗位目录' })[snapshot.sources?.jdSnapshotFrom] || snapshot.sources?.jd || '留档时选择的固定来源')}</strong><p>${e(job.company)} · ${e(job.title)}</p></div><details open class="wf-snapshot-block"><summary>当次岗位正文</summary><p class="wf-preserve">${e(job.description || job.payload?.description || '')}</p><p class="wf-preserve">${e(job.requirements || job.payload?.requirements || '')}</p>${jdSupplement ? `<h3>本人补充正文（未经官网核验）</h3><p class="wf-preserve">${e(jdSupplement)}</p>` : ''}</details><details class="wf-snapshot-block"><summary>当次简历「${e(resume.title)}」V${e(resume.revision)}</summary><pre class="snapshot-text">${e(resumeText(resume.data))}</pre></details><section class="wf-snapshot-block"><h3>本人明确选择使用的网申文字</h3>${(snapshot.submittedFields || []).map(field => `<article class="wf-field-snapshot"><span class="badge ${field.editedByUser ? 'badge-amber' : 'badge-slate'}">${field.editedByUser ? '本人改写 · 不继承原版复核' : field.reviewed ? '来自已复核材料' : '本人手工提供 / 未经材料复核'}</span><p class="wf-preserve">${e(field.text)}</p>${field.sourceFieldId ? `<small>来源字段 ${e(field.sourceFieldId)}</small>` : ''}</article>`).join('') || '<p class="field-note">本次未归档网申文字，只保存了 JD 与简历快照。</p>'}</section>`;
}

export async function mountApplicationMaterials(root, { applicationId, evaluationId = '', signal, isCurrent = () => true } = {}) {
  let alive = true, dirty = false, busy = false, material = null, selectedEvaluation = null, generationResumeId = '', generatedRequest = null;
  let materialRows = [], materialTotal = 0, materialOffset = 0, submissionRows = [], submissionTotal = 0, submissionOffset = 0;
  let submissionResume = null, submissionVersions = [], submissionMaterial = null, submissionFields = [], submissionEvaluationId = '', resumeLoad = 0, evaluationLoad = 0, submissionMaterialLoad = 0, generation = 0, materialLoad = 0;
  let failedSubmission = null, submissionPreview = 0;
  let submissionTime = localDateInput(new Date().toISOString()), submissionJdSource = 'current_catalog';
  const live = () => alive && !signal?.aborted && isCurrent();
  const fail = error => { if (live() && error.name !== 'AbortError') { const el = root.querySelector('[data-material-error]'); if (el) el.textContent = error.message; toast(error.message, true); } };
  const run = fn => Promise.resolve().then(fn).catch(fail);
  const [applications, profile, resumes] = await Promise.all([
    api('/applications', { signal }), api('/candidate-profile', { signal }), api('/resumes', { signal }),
  ]);
  const application = applications.find(x => x.id === applicationId);
  if (!application) throw new Error('这份投递记录不存在或无权访问。');
  const evaluationList = await api('/job-evaluations?jobId=' + encodeURIComponent(application.job_id || application.job.id) + '&limit=50&includeStale=1', { signal });
  const evaluations = listItems(evaluationList).filter(x => x.jobId === application.job_id || x.jobId === application.job?.id);
  async function loadMaterials() { const result = await api(`/applications/${encodeURIComponent(applicationId)}/materials?limit=20&offset=${materialOffset}`, { signal }); materialRows = listItems(result); materialTotal = result.total ?? materialRows.length; }
  async function loadSubmissions() { const result = await api(`/applications/${encodeURIComponent(applicationId)}/submissions?limit=20&offset=${submissionOffset}`, { signal }); submissionRows = listItems(result); submissionTotal = result.total ?? submissionRows.length; }
  const initialEvaluation = evaluations.find(x => x.id === evaluationId) || evaluations.find(x => !x.stale && x.gateState !== 'fail');
  await Promise.all([loadMaterials(), loadSubmissions(), initialEvaluation ? api('/job-evaluations/' + encodeURIComponent(initialEvaluation.id), { signal }).then(x => { selectedEvaluation = x; }) : Promise.resolve()]);
  generationResumeId = application.resume_id && resumes.some(x => x.id === application.resume_id) ? application.resume_id : resumes[0]?.id || '';
  async function loadSubmissionResume(id, revision) {
    const token = ++resumeLoad;
    if (!id) { submissionResume = null; submissionVersions = []; return; }
    const current = resumes.find(x => x.id === id);
    const [resume, versions] = await Promise.all([
      api('/resumes/' + encodeURIComponent(id) + (revision && revision !== current?.revision ? '/versions/' + revision : ''), { signal }),
      api('/resumes/' + encodeURIComponent(id) + '/versions', { signal }),
    ]);
    if (!live() || token !== resumeLoad) return;
    submissionResume = resume; submissionVersions = versions;
  }
  if (generationResumeId) await loadSubmissionResume(generationResumeId);
  function updateSubmissionDraft() {
    const rows = root.querySelectorAll('[data-submission-field]');
    if (rows.length) submissionFields = [...rows].map(row => ({ sourceFieldId: row.dataset.sourceField || null, text: row.querySelector('textarea').value, selected: row.querySelector('[type=checkbox]').checked }));
  }
  function conditionsMarkup() {
    if (!selectedEvaluation) return '<p class="field-note">先选择本岗位的有效评估。没有评估时，请从岗位评估开始。</p>';
    return `<div class="wf-summary">${evaluationSummaryMarkup(selectedEvaluation)}<span>底稿 V${e(selectedEvaluation.profileRevision)} · ${e(gateLabel(selectedEvaluation.gateState))}</span></div>${selectedEvaluation.stale || selectedEvaluation.gateState === 'fail' || (['reference_only', 'unknown'].includes(selectedEvaluation.contentQuality) && !selectedEvaluation.inputs?.jdSupplement?.trim()) ? '<div class="wf-notice">该评估来源已变化、条件不符，或关键正文不完整。请先重新核对并评估，服务端会校验材料生成条件。</div>' : ''}${pendingConditions(selectedEvaluation).map((g, i) => `<label class="consent"><input type="checkbox" name="pendingCondition" value="${i}" required><span>我知悉仍待核实：${e(g.reason)}${g.sourceQuote ? `（原文：${e(g.sourceQuote)}）` : ''}。知悉不代表资格已通过。</span></label>`).join('')}${selectedEvaluation.gateState === 'needs_review' && !pendingConditions(selectedEvaluation).length ? '<label class="consent"><input type="checkbox" name="pendingCondition" required><span>我已阅读评估中的待核实项，知悉这些条件仍未通过核对。</span></label>' : ''}<a class="text-link" href="#/evaluation/${e(selectedEvaluation.id)}">查看完整评估、原文与事实依据 →</a>`;
  }
  function generationMarkup() {
    return `<section class="panel wf-section"><div class="panel-heading"><h2>1. 生成定制材料草稿</h2><span class="badge badge-slate">底稿 V${profile.revision}</span></div><p class="field-note">生成只保存段落修改建议和所选网申字段。之后需要单独复核，再由你选择段落采纳为新简历。</p><form id="material-generate-form"><div class="form-grid"><label class="field"><span>本岗位评估</span><select name="evaluationId" id="generation-evaluation"><option value="">请选择评估</option>${evaluations.map(x => `<option value="${e(x.id)}" ${selectedEvaluation?.id === x.id ? 'selected' : ''}>${time(x.createdAt)} · ${gateLabel(x.gateState)}${x.stale ? ' · 来源已变化' : ''} · 底稿 V${x.profileRevision}</option>`).join('')}</select></label><label class="field"><span>源简历（使用已保存版本）</span><select name="resumeId" id="generation-resume"><option value="">请选择源简历</option>${resumes.map(r => `<option value="${e(r.id)}" ${generationResumeId === r.id ? 'selected' : ''}>${e(r.title)} · V${r.revision}</option>`).join('')}</select></label></div><div data-generation-conditions>${conditionsMarkup()}</div><h3>选择需要的中文网申字段</h3><div class="wf-field-options">${Object.entries(fieldTypes).map(([type, label], i) => `<div data-field-request="${type}"><label class="wf-inline-check"><input type="checkbox" name="fieldType" value="${type}" ${i === 0 ? 'checked' : ''}>${label}</label><label class="field"><span>长度上限</span><input name="maxLength" type="number" min="1" max="1000" value="${i === 1 ? 300 : 150}" aria-label="${label}长度上限"></label><label class="field"><span>计数口径</span><select name="countMode" aria-label="${label}计数口径">${Object.entries(modes).map(([value, name]) => `<option value="${value}">${name}</option>`).join('')}</select></label></div>`).join('')}</div><label class="consent"><input name="consent" type="checkbox" required><span>我同意将本次评估、已确认事实、源简历允许改写的段落和字段要求发给已配置的 AI 服务。联系信息、头像与作品图不发给模型。</span></label><div class="button-row"><button type="submit" class="button button-primary" ${resumes.length && evaluations.length ? '' : 'disabled'}>生成这次材料草稿</button><span data-material-step class="muted"></span>${generatedRequest ? '<button type="button" class="button button-soft" data-material-action="recover">按请求编号找回结果</button>' : ''}</div><p class="field-note">每次最多一次模型调用，约 105 秒等待上限。连接中断后先找回结果，再主动重试；不会后台自动重跑。</p></form></section>`;
  }
  function currentMaterialMarkup() {
    if (!material) return '<section class="panel wf-section">' + emptyState('选择一版材料，开始核对', '生成草稿或打开历史材料后，逐段比较原文、建议和事实依据。') + '</section>';
    const facts = material.inputs?.profile?.facts || material.inputs?.facts || material.inputs?.evaluation?.inputs?.profile?.facts || [];
    const accepted = !!material.createdResumeId || !!material.acceptedAt, passed = material.reviewState === 'passed', content = material.content || {}, review = material.review || {};
    return `<section class="panel wf-section"><div class="panel-heading"><h2>2. 核对与编辑草稿 <span>V${material.version}</span></h2><span class="badge ${passed ? 'badge-green' : 'badge-amber'}">${e(reviewLabel(material))}</span></div><p class="field-note">源简历 V${e(material.sourceResumeRevision)} · 底稿 V${e(material.profileRevision)} · ${time(material.updatedAt)}<span data-material-dirty>${dirty ? ' · 有未保存修改' : ''}</span></p>${material.stale ? '<div class="wf-notice">来源版本已变化：本材料可查阅，采纳前需要重新生成并复核。</div>' : ''}${(content.warnings || []).length ? `<div class="wf-notice"><strong>需要留意</strong><ul>${content.warnings.map(q => `<li>${e(plainQuestion(q))}</li>`).join('')}</ul></div>` : ''}${(content.questions || []).length ? `<h3>缺失事实与问题</h3><ul class="wf-readable-list">${content.questions.map(q => `<li>${e(plainQuestion(q))}</li>`).join('')}</ul>` : ''}<form id="material-edit-form"><div class="wf-patches">${(content.patches || []).map(patch => `<article class="wf-patch" data-patch="${e(patch.id)}"><div class="panel-heading"><h3>${e(patch.path)}</h3><span class="muted">${e(patch.id)}</span></div><div class="wf-comparison"><section><h4>源简历原文</h4><pre>${e(patch.original)}</pre></section><section><label class="field"><span>建议文字 · 可手工调整</span><textarea name="revised" rows="6" ${accepted ? 'disabled' : ''}>${e(patch.revised)}</textarea></label></section></div><p class="field-note">修改理由：${e(patch.reason)}</p>${references(patch.fact_ids, facts)}</article>`).join('') || '<p class="field-note">本版没有段落替换建议。</p>'}</div><h3>网申字段</h3><p class="field-note">空格、标点与换行按选择的口径计入。复制时仅复制正文，复制不代表发送。</p><div class="wf-form-fields">${(content.form_fields || []).map(field => `<article class="wf-form-field" data-form-field="${e(field.id)}"><div class="panel-heading"><h3>${e(fieldTypes[field.type] || field.type)}</h3><button type="button" class="button button-soft button-small" data-material-action="copy-field" data-id="${e(field.id)}">复制正文</button></div><label class="field"><span>最终文字</span><textarea name="fieldText" rows="5" data-max="${field.max_length}" data-mode="${e(field.count_mode)}" ${accepted ? 'disabled' : ''}>${e(field.text)}</textarea></label><div class="wf-length"><span data-field-length>${countText(field.text, field.count_mode)} / ${field.max_length}</span><span>${e(modes[field.count_mode])}</span></div>${references(field.fact_ids, facts)}</article>`).join('') || '<p class="field-note">本版没有网申字段。</p>'}</div><div class="button-row"><button type="submit" class="button button-soft" ${accepted ? 'disabled' : ''}>保存手工修改并清除旧复核</button><button type="button" class="text-link" data-material-action="export">导出本版材料与依据</button><button type="button" class="text-link danger-link" data-material-action="delete" data-id="${e(material.id)}">删除材料记录</button></div></form></section>
      <section class="panel wf-section"><div class="panel-heading"><h2>3. 单独复核当前保存版本</h2><span class="badge ${passed ? 'badge-green' : 'badge-slate'}">${e(reviewLabel(material))}</span></div><p class="field-note">这是一次新的内容检查调用。引用存在和模型复核通过都不能代替本人核对真实经历。</p>${(review.findings || []).length ? `<div class="wf-review-findings">${review.findings.map(f => `<article><strong>${e(f.target_id || f.targetId || '')} · ${e(f.type || f.issue_type || '待修改')}</strong><p>${e(f.explanation || f.reason || f.message)}</p><small>${e((f.fact_ids || f.evidence_ids || []).join('、'))}</small></article>`).join('')}</div>` : passed ? '<p class="wf-success">本次保存版本的段落与字段已完成复核。</p>' : ''}<form id="material-review-form"><label class="consent"><input type="checkbox" name="consent" required ${accepted ? 'disabled' : ''}><span>我同意将同一份事实、JD 和当前已保存草稿发送到 AI 服务，执行独立的一次内容检查。</span></label><button class="button button-primary" type="submit" data-requires-saved ${accepted || dirty ? 'disabled' : ''}>复核材料 V${material.version}</button></form></section>
      <section class="panel wf-section"><h2>4. 人工选择并采纳为新简历</h2>${accepted ? `<p class="wf-success">本版已采纳。继续修改新简历属于本人编辑，不会自动继承原版 AI 复核声明。</p><a class="button button-primary" href="#/resume/${e(material.createdResumeId)}">打开已创建简历 →</a>` : `<p class="field-note">选择需要的段落。只允许采纳本版复核通过的内容；系统会再次检查源简历与底稿版本。</p><form id="material-adopt-form"><div class="wf-patch-selection">${(content.patches || []).map(patch => `<label class="consent"><input type="checkbox" name="selectedPatchIds" value="${e(patch.id)}"><span>采纳 ${e(patch.path)}<small>${e(patch.revised.slice(0, 150))}</small></span></label>`).join('')}</div><label class="field"><span>新简历标题</span><input name="title" maxlength="100" required value="${e(Array.from(application.job.company + ' ' + application.job.title + ' 定制简历').slice(0, 100).join(''))}"></label><button class="button button-primary" type="submit" data-requires-saved ${!passed || dirty || material.stale || !(content.patches || []).length ? 'disabled' : ''}>按所选段落创建新简历</button></form>`}</section>`;
  }
  function fieldsMarkup() {
    return submissionFields.map((field, i) => `<article class="wf-form-field" data-submission-field="${i}" data-source-field="${e(field.sourceFieldId || '')}"><div class="panel-heading"><label class="wf-inline-check"><input type="checkbox" ${field.selected ? 'checked' : ''}>本次确实使用该字段</label>${field.sourceFieldId ? `<span class="muted">来源：${e(field.sourceFieldId)}</span>` : `<button type="button" class="text-link danger-link" data-material-action="remove-submission-field" data-index="${i}">删除手工字段</button>`}</div><label class="field"><span>本次实际提交文字（可与生成稿不同）</span><textarea rows="4">${e(field.text)}</textarea></label><small>调整后的文字会标记“本人改写”，不继承原版复核。当前 ${countText(field.text)} 个码点。</small></article>`).join('') || '<p class="field-note">可仅归档手工简历；如有实际使用的网申文字，请添加并主动勾选。</p>';
  }
  function submissionMarkup() {
    return `<section class="panel wf-section" id="submission-section"><div class="panel-heading"><h2>5. 投递后记录实际使用的材料</h2><span class="badge badge-slate">需要本人确认官网已提交</span></div><p class="field-note">可直接留档纯手工简历，无需调用模型。系统保存你选择的 JD、简历版本和实际使用文字；状态更新不能证明企业官网接收成功。</p><form id="submission-form"><div class="form-grid"><label class="field"><span>实际投递的简历</span><select id="submission-resume" name="resumeId" required><option value="">请选择简历</option>${resumes.map(r => `<option value="${e(r.id)}" ${submissionResume?.id === r.id ? 'selected' : ''}>${e(r.title)}</option>`).join('')}</select></label><label class="field"><span>实际使用的保存版本</span><select id="submission-revision" name="resumeRevision" required>${submissionVersions.map(v => `<option value="${v.revision}" ${submissionResume?.revision === v.revision ? 'selected' : ''}>V${v.revision} · ${time(v.created_at)} · ${e(v.reason)}</option>`).join('')}</select></label><label class="field"><span>JD 快照来源</span><select name="jdSnapshotFrom" id="submission-jd-source"><option value="current_catalog" ${submissionJdSource === 'current_catalog' ? 'selected' : ''}>当前应用对应的岗位目录（含历史岗位行）</option><option value="evaluation" ${submissionJdSource === 'evaluation' ? 'selected' : ''}>所选评估的固定 JD 输入</option></select></label><label class="field"><span>JD 评估来源（选择评估快照时使用）</span><select id="submission-evaluation" name="evaluationId"><option value="">请选择</option>${evaluations.map(x => `<option value="${e(x.id)}" ${submissionEvaluationId === x.id ? 'selected' : ''}>${time(x.createdAt)} · 底稿 V${x.profileRevision}${x.stale ? ' · 历史版本' : ''}</option>`).join('')}</select></label><label class="field"><span>网申字段来源材料（可不使用）</span><select id="submission-material" name="materialId"><option value="">仅使用手工简历 / 手工字段</option>${[...new Map([...materialRows, ...(material ? [material] : [])].map(x => [x.id, x])).values()].filter(x => x.createdResumeId === submissionResume?.id).map(x => `<option value="${e(x.id)}" ${submissionMaterial?.id === x.id ? 'selected' : ''}>${time(x.createdAt)} · 材料 V${x.version} · ${reviewLabel(x)}</option>`).join('')}</select></label><label class="field"><span>本人实际提交时间</span><input type="datetime-local" name="submittedAt" required value="${e(submissionTime)}"></label></div><div data-submission-resume-preview>${submissionResume ? `<details class="wf-snapshot-block"><summary>核对所选简历：${e(submissionResume.title)} · V${submissionResume.revision}</summary><pre class="snapshot-text">${e(resumeText(submissionResume.data))}</pre></details>` : ''}</div><div class="panel-heading"><h3>只选择本次真实使用的文字</h3><button type="button" class="text-link" data-material-action="add-submission-field">添加手工字段 +</button></div><div data-submission-fields>${fieldsMarkup()}</div><div class="button-row"><button type="submit" class="button button-primary" ${resumes.length ? '' : 'disabled'}>核对最终留档预览</button>${failedSubmission ? '<button class="button button-soft" type="button" data-material-action="recover-submission">找回上次留档结果</button>' : ''}</div></form></section>`;
  }
  function render() {
    if (!live()) return;
    const oldSubmission = root.querySelector('#submission-form');
    if (oldSubmission) { submissionTime = oldSubmission.elements.submittedAt.value; submissionJdSource = oldSubmission.elements.jdSnapshotFrom.value; submissionEvaluationId = oldSubmission.elements.evaluationId.value; }
    updateSubmissionDraft();
    if (dirty && material && root.querySelector('#current-material')?.dataset.materialId === material.id) {
      const edits = editableText();
      for (const patch of edits.patches) { const item = material.content.patches.find(x => x.id === patch.id); if (item) item.revised = patch.revised; }
      for (const field of edits.formFields) { const item = material.content.form_fields.find(x => x.id === field.id); if (item) item.text = field.text; }
    }
    root.innerHTML = `<div class="page-heading"><div><span class="page-kicker">PREPARE / REVIEW / RECORD</span><h1>准备这份机会的申请材料。</h1><p>${e(application.job.company)} · ${e(application.job.title)}</p></div><div class="button-row"><a class="button button-soft button-small" href="#/applications">返回我的投递</a><a class="button button-soft button-small" href="#/evaluate/${e(application.job_id || application.job.id)}">评估此岗位</a></div></div>${jobQualityMarkup(application.job)}<p class="form-error" data-material-error role="alert"></p>
      <div class="wf-notice">材料生成、复核、采纳与投递留档是四个独立操作。只有你在官网完成提交并确认后，才应保存“实际投递”留档。</div>${generationMarkup()}
      <section class="panel wf-section"><div class="panel-heading"><h2>历史材料 <span>${materialTotal}</span></h2><a class="text-link" href="#/settings">导出全部个人资料 →</a></div>${materialRows.length ? `<div class="wf-material-list">${materialRows.map(x => `<article class="wf-history-row"><div><strong>材料 V${x.version} · ${e(reviewLabel(x))}</strong><small>${time(x.createdAt)} · 源简历 V${x.sourceResumeRevision} · 底稿 V${x.profileRevision}${x.stale ? ' · 来源已变化' : ''}</small></div><button class="button button-soft button-small" data-material-action="open" data-id="${e(x.id)}">${material?.id === x.id ? '当前查看' : '打开核对'}</button><button class="text-link danger-link" data-material-action="delete" data-id="${e(x.id)}">删除</button></article>`).join('')}</div>` : '<p class="field-note">还没有生成材料。下方可以直接记录手工简历投递。</p>'}${pagination('materials', materialOffset, materialTotal)}</section>
      <div id="current-material" data-material-id="${e(material?.id || '')}">${currentMaterialMarkup()}</div>${submissionMarkup()}
      <section class="panel wf-section"><div class="panel-heading"><h2>实际投递留档 <span>${submissionTotal}</span></h2></div>${submissionRows.length ? submissionRows.map(x => `<article class="wf-history-row"><div><strong>第 ${x.sequence} 次 · 简历 V${x.resumeRevision}</strong><small>本人填写的提交时间：${time(x.submittedAt)} · 留档时间：${time(x.recordedAt)}</small></div><button class="button button-soft button-small" data-material-action="open-submission" data-id="${e(x.id)}">查看快照</button><button class="text-link" data-material-action="export-submission" data-id="${e(x.id)}">导出</button><button class="text-link danger-link" data-material-action="delete-submission" data-id="${e(x.id)}">删除</button></article>`).join('') : '<p class="field-note">尚无本人确认的实际投递留档。</p>'}${pagination('submissions', submissionOffset, submissionTotal)}</section>`;
  }
  function pagination(kind, offset, total) { return total > 20 ? `<div class="pagination"><span>${offset + 1}–${Math.min(offset + 20, total)} / ${total}</span><button class="button button-soft button-small" data-material-action="page" data-kind="${kind}" data-offset="${Math.max(0, offset - 20)}" ${offset ? '' : 'disabled'}>上一页</button><button class="button button-soft button-small" data-material-action="page" data-kind="${kind}" data-offset="${offset + 20}" ${offset + 20 < total ? '' : 'disabled'}>下一页</button></div>` : ''; }
  function editableText() {
    return { patches: [...root.querySelectorAll('[data-patch]')].map(row => ({ id: row.dataset.patch, revised: normalizeText(row.querySelector('textarea').value) })), formFields: [...root.querySelectorAll('[data-form-field]')].map(row => ({ id: row.dataset.formField, text: normalizeText(row.querySelector('textarea').value) })) };
  }
  function setBusy(value, text = '') { busy = value; if (!live()) return; updateControls(); const el = root.querySelector('[data-material-step]'); if (el) el.textContent = text; }
  async function recoverGeneration() {
    if (!generatedRequest) return false;
    const result = await api(`/applications/${encodeURIComponent(applicationId)}/materials?requestId=${encodeURIComponent(generatedRequest.requestId)}`, { signal });
    const found = listItems(result).find(x => x.requestId === generatedRequest.requestId) || listItems(result)[0];
    if (!found) return false;
    const restored = await api('/materials/' + encodeURIComponent(found.id), { signal }); if (!live()) return true;
    material = restored; generatedRequest = null; dirty = false; await loadMaterials(); render(); toast('已找回上次成功生成的材料。'); return true;
  }
  async function showSubmission(record) {
    if (!live()) return;
    dialog('第 ' + record.sequence + ' 次投递留档', `<p class="modal-description">这是本人确认的内容快照。提交时间：${time(record.submittedAt)}；本机留档时间：${time(record.recordedAt)}。记录不验证企业官网接收结果。</p>${snapshotMarkup(record.snapshot || {})}<p class="field-note">快照哈希：${e(record.snapshotHash)}</p><div class="modal-actions"><button class="button button-soft" id="export-submission-detail">导出这次留档</button><button class="button button-primary" data-close-dialog>关闭</button></div>`, modal => modal.querySelector('#export-submission-detail').addEventListener('click', () => downloadJson(record, 'Offerbiu-投递留档-' + record.id + '.json')), 'modal-wide');
  }
  async function confirmSubmission(form) {
    const previewToken = ++submissionPreview;
    if (failedSubmission) {
      const previous = await api(`/applications/${encodeURIComponent(applicationId)}/submissions?requestId=${encodeURIComponent(failedSubmission.requestId)}`, { signal });
      const found = listItems(previous)[0];
      if (found) { failedSubmission = null; await loadSubmissions(); render(); await showSubmission(await api('/submissions/' + encodeURIComponent(found.id), { signal })); return; }
    }
    updateSubmissionDraft(); const values = Object.fromEntries(new FormData(form));
    if (!submissionResume || values.resumeId !== submissionResume.id || Number(values.resumeRevision) !== submissionResume.revision) throw new Error('简历版本正在加载或已变化，请先核对所选版本。');
    const selectedResume = structuredClone(submissionResume), selectedMaterial = submissionMaterial ? structuredClone(submissionMaterial) : null;
    const fields = selectedSubmissionFields(submissionFields); if (fields.length > 8) throw new Error('一次最多留档 8 项网申文字。');
    if (fields.some(x => !x.text.trim() || countText(x.text) > 1000)) throw new Error('每项实际使用的文字须非空，且最多 1,000 个 Unicode 码点。');
    let jd, sourceEvaluation = null, expectedJobHash = null;
    if (values.jdSnapshotFrom === 'evaluation') { if (!values.evaluationId) throw new Error('请选择本次实际使用的 JD 评估快照。'); sourceEvaluation = await api('/job-evaluations/' + encodeURIComponent(values.evaluationId), { signal }); jd = sourceEvaluation.inputs?.job || {}; }
    else {
      const current = await api(`/applications/${encodeURIComponent(applicationId)}/submission-preview`, { signal });
      jd = current.job; expectedJobHash = current.jobHash;
      if (!jd || !expectedJobHash) throw new Error('这份应用对应的岗位记录已不存在，请重新加载。');
    }
    const submittedAt = new Date(values.submittedAt); if (!Number.isFinite(submittedAt.getTime())) throw new Error('请填写实际提交时间。');
    const payload = { requestId: crypto.randomUUID(), resumeId: selectedResume.id, resumeRevision: selectedResume.revision, materialId: values.materialId || null, jdSnapshotFrom: values.jdSnapshotFrom, evaluationId: values.jdSnapshotFrom === 'evaluation' ? values.evaluationId : null, expectedJobHash, submittedFields: fields, submittedAt: submittedAt.toISOString(), channel: 'official_portal', confirmedSubmitted: true };
    if (failedSubmission && JSON.stringify({ ...failedSubmission, requestId: '' }) === JSON.stringify({ ...payload, requestId: '' })) payload.requestId = failedSubmission.requestId;
    if (!live() || previewToken !== submissionPreview) return;
    const snapshot = { job: { ...jd, jdSupplement: sourceEvaluation?.inputs?.jdSupplement }, resume: selectedResume, submittedFields: fields.map(f => {
      const source = selectedMaterial?.content?.form_fields?.find(x => x.id === f.sourceFieldId), editedByUser = !!source && normalizeText(source.text) !== f.text;
      return { ...f, editedByUser, reviewed: !!source && !editedByUser && selectedMaterial.reviewState === 'passed' };
    }), jdSnapshotFrom: values.jdSnapshotFrom === 'evaluation' ? '所选评估固定输入 · ' + values.evaluationId : '当前应用对应岗位目录' };
    dialog('最终留档预览 · 请逐项确认', `<p class="modal-description">仅在你已经完成官网提交后保存。以下将冻结为一次独立记录，之后不会随简历编辑或岗位更新变化。</p>${snapshotMarkup(snapshot)}<label class="consent"><input type="checkbox" id="confirm-actual-submission"><span>我确认已在企业官网提交，以上 JD、简历 V${payload.resumeRevision}、本人填写时间与所选文字符合本次实际使用情况。</span></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button button-soft" data-close-dialog>返回调整</button><button class="button button-primary" id="confirm-submission-save" disabled>确认并冻结这次投递快照</button></div>`, modal => {
      const confirmButton = modal.querySelector('#confirm-submission-save');
      modal.querySelector('#confirm-actual-submission').addEventListener('change', event => { confirmButton.disabled = !event.target.checked; });
      confirmButton.addEventListener('click', async () => {
        if (!modal.querySelector('#confirm-actual-submission').checked || busy) return; confirmButton.disabled = true; busy = true; failedSubmission = payload;
        try {
          const result = await api(`/applications/${encodeURIComponent(applicationId)}/submissions`, { method: 'POST', data: payload, signal });
          if (!live()) return;
          failedSubmission = null; if (modal.open && confirmButton.isConnected) modal.close(); submissionOffset = 0; await loadSubmissions(); render(); toast('已冻结本人确认的投递内容快照。');
        } catch (error) { if (live() && modal.open && confirmButton.isConnected) { modal.querySelector('.form-error').textContent = error.message + ' 如连接中断，请返回页面找回上次留档结果后再重试。'; confirmButton.disabled = false; } }
        finally { busy = false; if (live() && failedSubmission && !confirmButton.isConnected) render(); }
      });
      modal.addEventListener('close', () => { if (failedSubmission && live() && !busy) render(); }, { once: true });
    }, 'modal-wide');
  }
  const onSubmit = event => {
    if (!['material-generate-form', 'material-edit-form', 'material-review-form', 'material-adopt-form', 'submission-form'].includes(event.target.id)) return;
    event.preventDefault(); const form = event.target;
    run(async () => {
      if (busy) return;
      if (form.id === 'submission-form') { await confirmSubmission(form); return; }
      if (form.id === 'material-generate-form') {
        if (dirty && !confirm('当前材料有未保存修改，确定打开新生成草稿？')) return;
        if (!selectedEvaluation || form.elements.evaluationId.value !== selectedEvaluation.id) throw new Error('请先选择并加载本岗位评估。');
        const resume = resumes.find(x => x.id === form.elements.resumeId.value); if (!resume) throw new Error('请选择一份已保存的源简历。');
        const pending = [...form.querySelectorAll('[name=pendingCondition]')]; if (pending.some(x => !x.checked)) throw new Error('请逐项阅读并确认知悉待核实条件。');
        if (!form.elements.consent.checked) throw new Error('请确认本次材料生成的资料外发范围。');
        const fields = [...form.querySelectorAll('[data-field-request]')].filter(row => row.querySelector('[type=checkbox]').checked).map(row => ({ type: row.dataset.fieldRequest, maxLength: Number(row.querySelector('[name=maxLength]').value), countMode: row.querySelector('[name=countMode]').value }));
        if (fields.some(x => !Number.isInteger(x.maxLength) || x.maxLength < 1 || x.maxLength > 1000)) throw new Error('每个字段长度上限须在 1–1,000 之间。');
        const payload = { evaluationId: selectedEvaluation.id, resumeId: resume.id, resumeRevision: resume.revision, profileRevision: profile.revision, requestId: crypto.randomUUID(), acknowledgePendingConditions: !pending.length || pending.every(x => x.checked), fields, consent: true };
        if (generatedRequest) { if (await recoverGeneration()) return; const previous = { ...generatedRequest, requestId: '' }, next = { ...payload, requestId: '' }; if (JSON.stringify(previous) === JSON.stringify(next)) payload.requestId = generatedRequest.requestId; }
        generatedRequest = payload; setBusy(true, '正在生成草稿…');
        try { const result = await api(`/applications/${encodeURIComponent(applicationId)}/materials`, { method: 'POST', signal, timeout: 105000, data: payload }); if (!live()) return; material = result.material || result; dirty = false; generatedRequest = null; await loadMaterials(); render(); toast('草稿已保存，请逐段核对并主动复核。'); }
        finally { busy = false; if (live()) renderGenerationState(); } return;
      }
      if (!material) throw new Error('请先打开一版材料。');
      if (form.id === 'material-edit-form') {
        const edits = editableText(); for (const field of edits.formFields) { const original = material.content.form_fields.find(x => x.id === field.id); if (countText(field.text, original.count_mode) > original.max_length) throw new Error('网申字段超出所选长度上限，请精简后保存。'); }
        const started = generation; setBusy(true, '正在保存修改…');
        try { const result = await api('/materials/' + encodeURIComponent(material.id), { method: 'PUT', signal, data: { version: material.version, ...edits } }); if (!live()) return; material = result.material || result; if (generation === started) { dirty = false; await loadMaterials(); render(); } else { toast('已保存提交时的版本；编辑区后续修改仍保留，请再次保存。'); } }
        finally { busy = false; if (live()) updateControls(); } return;
      }
      if (dirty) throw new Error('请先保存当前手工修改，再复核或采纳。');
      if (form.id === 'material-review-form') {
        if (!form.elements.consent.checked) throw new Error('请确认本次独立复核的资料外发范围。'); setBusy(true, '正在复核当前保存版本…');
        const started = generation, targetId = material.id;
        try { const result = await api('/materials/' + encodeURIComponent(targetId) + '/review', { method: 'POST', signal, timeout: 105000, data: { version: material.version, consent: true } }); if (!live() || material.id !== targetId) return; material = result.material || result; if (generation === started) { await loadMaterials(); render(); toast(material.reviewState === 'passed' ? '本版复核通过，请本人选择需要采纳的段落。' : '复核发现待修改项，请调整并保存后再次复核。'); } else { toast('复核完成；编辑区存在后续修改，请保存并重新复核。'); } }
        finally { busy = false; if (live()) updateControls(); } return;
      }
      if (form.id === 'material-adopt-form') {
        const selectedPatchIds = new FormData(form).getAll('selectedPatchIds'); if (!selectedPatchIds.length) throw new Error('请至少主动选择一处要采纳的段落。');
        setBusy(true, '正在创建新简历…');
        try { const result = await api('/materials/' + encodeURIComponent(material.id) + '/create-resume', { method: 'POST', signal, data: { version: material.version, sourceResumeRevision: material.sourceResumeRevision, selectedPatchIds, title: form.elements.title.value } }); if (!live()) return; dirty = false; toast('已创建定制简历新副本。'); location.hash = '/resume/' + (result.resume?.id || result.id); }
        finally { busy = false; if (live()) updateControls(); }
      }
    });
  };
  function updateControls() {
    if (!live()) return;
    const accepted = !!material?.createdResumeId || !!material?.acceptedAt;
    const edit = root.querySelector('#material-edit-form [type=submit]'); if (edit) edit.disabled = busy || accepted;
    const review = root.querySelector('#material-review-form [type=submit]'); if (review) review.disabled = busy || dirty || accepted;
    const adopt = root.querySelector('#material-adopt-form [type=submit]'); if (adopt) adopt.disabled = busy || dirty || material?.reviewState !== 'passed' || !!material?.stale || !material?.content?.patches?.length;
    root.querySelectorAll('#material-edit-form textarea').forEach(x => x.disabled = busy || accepted);
    const generate = root.querySelector('#material-generate-form [type=submit]'); if (generate) generate.disabled = busy || !resumes.length || !evaluations.length;
    const submission = root.querySelector('#submission-form [type=submit]'); if (submission) submission.disabled = busy || !resumes.length;
    root.querySelectorAll('[data-material-action=open]').forEach(x => x.disabled = busy);
    root.querySelectorAll('[data-material-action=delete],[data-material-action=delete-submission],[data-material-action=page]').forEach(x => x.disabled = busy);
  }
  function renderGenerationState() {
    updateControls(); const el = root.querySelector('[data-material-step]'); if (el) el.textContent = generatedRequest ? '连接未确认完成：请先找回本次请求结果，再主动重试。' : '';
    if (generatedRequest && !root.querySelector('[data-material-action=recover]')) { const button = document.createElement('button'); button.type = 'button'; button.className = 'button button-soft'; button.dataset.materialAction = 'recover'; button.textContent = '按请求编号找回结果'; el?.after(button); }
  }
  const onInput = event => {
    if (event.target.closest('#material-edit-form')) { dirty = true; generation++; const el = root.querySelector('[data-material-dirty]'); if (el) el.textContent = ' · 有未保存修改，需重新复核'; root.querySelectorAll('[data-requires-saved]').forEach(x => x.disabled = true); }
    const field = event.target.closest('[data-form-field]'); if (field) { const text = field.querySelector('textarea'), used = countText(text.value, text.dataset.mode), indicator = field.querySelector('[data-field-length]'); indicator.textContent = `${used} / ${text.dataset.max}`; indicator.classList.toggle('is-over-limit', used > Number(text.dataset.max)); }
  };
  const onChange = event => run(async () => {
    if (event.target.id === 'generation-resume') generationResumeId = event.target.value;
    if (event.target.id === 'generation-evaluation') { const token = ++evaluationLoad; const id = event.target.value; selectedEvaluation = null; const result = id ? await api('/job-evaluations/' + encodeURIComponent(id), { signal }) : null; if (!live() || token !== evaluationLoad) return; selectedEvaluation = result; root.querySelector('[data-generation-conditions]').innerHTML = conditionsMarkup(); }
    if (event.target.id === 'submission-resume' || event.target.id === 'submission-revision') {
      const resumeId = root.querySelector('#submission-resume').value, revision = event.target.id === 'submission-revision' ? Number(event.target.value) : undefined;
      updateSubmissionDraft(); await loadSubmissionResume(resumeId, revision); if (!live()) return;
      if (submissionMaterial && submissionMaterial.createdResumeId !== submissionResume?.id) { submissionMaterial = null; submissionFields = submissionFields.filter(x => !x.sourceFieldId); }
      const form = root.querySelector('#submission-form'); const submittedAt = form.elements.submittedAt.value, source = form.elements.jdSnapshotFrom.value, evalId = form.elements.evaluationId.value;
      root.querySelector('#submission-section').outerHTML = submissionMarkup(); root.querySelector('#submission-form').elements.submittedAt.value = submittedAt; root.querySelector('#submission-jd-source').value = source; root.querySelector('#submission-evaluation').value = evalId;
    }
    if (event.target.id === 'submission-evaluation') submissionEvaluationId = event.target.value;
    if (event.target.id === 'submission-material') {
      updateSubmissionDraft(); const token = ++submissionMaterialLoad, id = event.target.value;
      const result = id ? await api('/materials/' + encodeURIComponent(id), { signal }) : null; if (!live() || token !== submissionMaterialLoad) return;
      submissionMaterial = result; submissionFields = [...submissionFields.filter(x => !x.sourceFieldId), ...(result?.content?.form_fields || []).map(x => ({ selected: false, sourceFieldId: x.id, text: x.text }))]; root.querySelector('[data-submission-fields]').innerHTML = fieldsMarkup();
    }
  });
  const onClick = event => { const button = event.target.closest('[data-material-action]'); if (!button || button.disabled) return; run(async () => {
    const action = button.dataset.materialAction, id = button.dataset.id;
    if (action === 'copy-field') { const field = root.querySelectorAll('[data-form-field]'); const row = [...field].find(x => x.dataset.formField === id); if (!row) return; try { await navigator.clipboard.writeText(normalizeText(row.querySelector('textarea').value)); if (live()) toast('已复制正文，未发送到站外。'); } catch { row.querySelector('textarea').select(); toast('请使用 Ctrl+C 复制已选中的正文。'); } return; }
    if (action === 'add-submission-field' || action === 'remove-submission-field') { updateSubmissionDraft(); if (action === 'add-submission-field') { if (submissionFields.length >= 8) throw new Error('最多准备 8 项留档文字。'); submissionFields.push({ sourceFieldId: null, text: '', selected: false }); } else submissionFields.splice(Number(button.dataset.index), 1); root.querySelector('[data-submission-fields]').innerHTML = fieldsMarkup(); return; }
    if (action === 'recover') { if (!await recoverGeneration() && live()) toast('尚未找到本次成功生成记录。可主动点击生成重试；相同请求会沿用编号。'); return; }
    if (action === 'recover-submission') {
      if (!failedSubmission) return; const result = await api(`/applications/${encodeURIComponent(applicationId)}/submissions?requestId=${encodeURIComponent(failedSubmission.requestId)}`, { signal }); const found = listItems(result).find(x => x.requestId === failedSubmission.requestId) || listItems(result)[0];
      if (!found) { toast('未找到上次成功留档记录，可重新核对并确认留档。'); return; } failedSubmission = null; await loadSubmissions(); render(); await showSubmission(await api('/submissions/' + encodeURIComponent(found.id), { signal })); return;
    }
    if (action === 'open') {
      if (busy) return;
      if (dirty && !confirm('当前材料有未保存修改，确定打开其他材料？')) return;
      const token = ++materialLoad, started = generation;
      const result = await api('/materials/' + encodeURIComponent(id), { signal });
      if (!live() || token !== materialLoad || busy) return;
      if (generation !== started) {
        const error = root.querySelector('[data-material-error]');
        if (error) error.textContent = '加载期间有新修改，已保留当前编辑内容；请保存后再打开其他材料。';
        return;
      }
      material = result; dirty = false; updateSubmissionDraft(); render();
      root.querySelector('#current-material').scrollIntoView({ behavior: 'smooth', block: 'start' }); return;
    }
    if (action === 'export') { downloadJson(material, 'Offerbiu-申请材料-' + material.id + '.json'); return; }
    if (action === 'delete') { if (!confirm('删除这版材料记录？由它创建的简历和实际投递快照会独立保留，需要分别删除。')) return; await api('/materials/' + encodeURIComponent(id), { method: 'DELETE', signal }); if (!live()) return; if (material?.id === id) { material = null; dirty = false; } if (submissionMaterial?.id === id) { submissionMaterial = null; submissionFields = submissionFields.filter(x => !x.sourceFieldId); } await loadMaterials(); updateSubmissionDraft(); render(); toast('已删除材料记录。'); return; }
    if (action === 'open-submission' || action === 'export-submission') { const result = await api('/submissions/' + encodeURIComponent(id), { signal }); if (!live()) return; if (action === 'open-submission') await showSubmission(result); else downloadJson(result, 'Offerbiu-投递留档-' + id + '.json'); return; }
    if (action === 'delete-submission') { if (!confirm('删除这次实际投递快照？投递进展状态会保留。')) return; await api('/submissions/' + encodeURIComponent(id), { method: 'DELETE', signal }); if (!live()) return; await loadSubmissions(); updateSubmissionDraft(); render(); toast('已删除本次留档。'); return; }
    if (action === 'page') { if (dirty && !confirm('切换历史列表会收起未保存修改，确定继续？')) return; updateSubmissionDraft(); if (button.dataset.kind === 'materials') { materialOffset = Number(button.dataset.offset); await loadMaterials(); } else { submissionOffset = Number(button.dataset.offset); await loadSubmissions(); } render(); }
  }); };
  root.addEventListener('submit', onSubmit); root.addEventListener('input', onInput); root.addEventListener('change', onChange); root.addEventListener('click', onClick); render();
  return { isDirty: () => dirty, destroy() { alive = false; resumeLoad++; evaluationLoad++; submissionMaterialLoad++; root.removeEventListener('submit', onSubmit); root.removeEventListener('input', onInput); root.removeEventListener('change', onChange); root.removeEventListener('click', onClick); } };
}
