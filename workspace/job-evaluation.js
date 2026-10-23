import { api } from './api.js';
import { escape as e, date, time, toast, downloadJson, emptyState, safeUrl } from './ui.js';
import { qualityForJob, availabilityForJob } from '../shared/job-workflow.mjs';

const qualityLabels = { complete: '正文完整', partial: '正文有遗漏', reference_only: '关键条件仅有引用', unknown: '正文完整度未知' };
const availabilityLabels = { available: '已核验可申请', closed: '已明确关闭', unknown: '招聘状态未知' };
const gateLabels = { pass: '条件已通过', needs_review: '条件待核实', fail: '条件不符' };
const relationLabels = { supported: '有明确事实支持', partial: '部分支持', not_shown: '底稿尚未体现', unknown: '无法可靠判断' };
const listItems = result => Array.isArray(result) ? result : result?.items || [];
const errorText = error => error?.message || '本次操作未完成。';

export async function runSequentialEvaluations(items, evaluate, { signal, onUpdate = () => {} } = {}) {
  if (items.length > 10) throw new Error('每批最多选择 10 个岗位。');
  const rows = items.map(item => ({ item, status: 'queued' }));
  onUpdate(rows);
  for (const row of rows) {
    if (signal?.aborted) { row.status = 'cancelled'; onUpdate(rows); continue; }
    row.status = 'running'; onUpdate(rows);
    try { row.result = await evaluate(row.item, signal); row.status = 'success'; }
    catch (error) { row.status = error.name === 'AbortError' || signal?.aborted ? 'cancelled' : 'error'; row.error = errorText(error); }
    onUpdate(rows);
  }
  return rows;
}

export function jobQualityMarkup(job, compact = false) {
  const quality = qualityForJob(job), availability = availabilityForJob(job), checked = availability.checked_at || availability.checkedAt;
  const older = !checked || Date.now() - new Date(checked).getTime() > 7 * 86400000;
  return `<div class="wf-job-quality ${compact ? 'is-compact' : ''}"><span class="badge ${quality.level === 'complete' ? 'badge-green' : 'badge-amber'}">${e(qualityLabels[quality.level] || qualityLabels.unknown)}</span><span class="badge ${availability.state === 'closed' ? 'badge-red' : availability.state === 'available' ? 'badge-green' : 'badge-slate'}">${e(availabilityLabels[availability.state] || availabilityLabels.unknown)}</span>${older ? '<span class="badge badge-amber">建议复核</span>' : ''}${compact ? '' : `<p>${e(quality.reason || '该岗位尚未完成正文质量核查。')} 最近状态检查：${checked ? date(checked) : '尚未核验'}；最近确认可申请：${availability.last_available_at ? date(availability.last_available_at) : '暂无肯定证据'}。</p>`}</div>`;
}

export function evaluationSummaryMarkup(item) {
  if (!item) return '<span class="muted">尚未评估</span>';
  const numeric = typeof item.totalScore === 'number' && !item.stale;
  return `<span class="wf-result-summary">${numeric ? `<strong>${e(item.totalScore)} 分</strong>` : '<strong>无可比较总分</strong>'}<small>${e(item.scoreLabel || gateLabels[item.gateState] || '评估记录')}${item.stale ? ' · 来源已变化' : ''}</small></span>`;
}

export function evaluationSelectionMarkup(selected) {
  const count = selected.size;
  return `<div class="wf-selection-bar" aria-label="选定岗位评估"><span>仅评估你选定的岗位 · 已选 <strong data-job-selected-count>${count}</strong> / 10</span><div class="button-row"><a href="#/profile" class="text-link">整理真实底稿</a><a href="#/evaluations" class="button button-primary button-small" data-selected-evaluate ${count ? '' : 'aria-disabled="true"'}>顺序评估所选岗位</a><button class="text-link" data-action="clear-job-selection" ${count ? '' : 'disabled'}>清空选择</button><a href="#/evaluations" class="text-link">评估记录 →</a></div></div>`;
}

function factReferenceMarkup(factIds, facts) {
  return (factIds || []).map(id => {
    const fact = facts.find(x => x.id === id);
    return `<details class="wf-evidence"><summary>${e(id)}${fact ? ' · ' + e(fact.kind) : ''}</summary><p>${e(fact?.text || '该事实不在当前详情快照中，请导出本条评估查看原始依据。')}</p>${fact?.source?.excerpt ? `<small>保存的来源：${e(fact.source.excerpt)}</small>` : ''}</details>`;
  }).join('');
}

export function evaluationDetailMarkup(item) {
  const result = item.result || {}, inputs = item.inputs || {}, job = inputs.job || {}, facts = inputs.profile?.facts || inputs.facts || [], units = inputs.units || inputs.jdUnits || [];
  const gates = result.gates || item.gates || [], questions = result.questions || item.questions || [], modelUnits = result.units || [];
  const coverage = typeof item.coverage === 'number' ? Math.round(item.coverage * 100) + '%' : '未知';
  return `<section class="panel wf-section"><div class="panel-heading"><h2>材料与岗位的支持程度</h2><span class="badge ${item.gateState === 'fail' ? 'badge-red' : item.gateState === 'pass' ? 'badge-green' : 'badge-amber'}">${e(gateLabels[item.gateState] || '待核实')}</span></div><div class="wf-score-line">${evaluationSummaryMarkup(item)}<span>覆盖率 ${coverage} · 底稿 V${e(item.profileRevision)}${item.cached ? ' · 命中本人成功缓存' : ''}</span></div><p class="wf-score-note">这是已确认材料对岗位要求的支持程度，分数不是面试率、录用概率或真实能力上限。正文不完整、覆盖不足和硬条件失败时不提供可比较总分。</p>${item.stale ? '<div class="wf-notice">底稿、JD 或评估规则已变化，本条仅供历史查阅。请重新评估后准备材料。</div>' : ''}<div class="wf-job-quality"><span class="badge badge-slate">${e(qualityLabels[item.contentQuality] || qualityLabels.unknown)}</span><span class="badge badge-slate">${e(availabilityLabels[item.availability] || availabilityLabels.unknown)}</span></div></section>
    <section class="panel wf-section"><h2>条件核对与待核实项</h2><div class="wf-gates">${gates.map(g => `<article class="wf-gate"><span class="badge ${g.state === 'fail' ? 'badge-red' : g.state === 'pass' ? 'badge-green' : 'badge-amber'}">${e(gateLabels[g.state] || '待核实')}</span><div><strong>${e(g.kind || g.id || '资格条件')}</strong><p>${e(g.reason)}</p>${g.sourceQuote ? `<blockquote>${e(g.sourceQuote)}</blockquote>` : ''}${safeUrl(g.sourceUrl) ? `<a class="text-link" href="${e(safeUrl(g.sourceUrl))}" target="_blank" rel="noopener noreferrer">核对原文 ↗</a>` : ''}</div></article>`).join('') || '<p class="field-note">没有可自动判定的资格条件，仍需本人核对官方适用要求。</p>'}</div>${(result.eligibilityCandidates || []).length ? `<h3>模型提出的条件线索 · 仍待人工核对</h3><ul class="wf-readable-list">${result.eligibilityCandidates.map(c => `<li>${e(c.source_quote || c.sourceQuote || c.text || c.reason || c.description || '需要核对原文的条件')}</li>`).join('')}</ul>` : ''}${questions.length ? `<h3>需要进一步确认</h3><ul class="wf-readable-list">${questions.map(q => `<li>${e(typeof q === 'string' ? q : q.question || q.reason)}</li>`).join('')}</ul>` : ''}</section>
    <section class="panel wf-section"><div class="panel-heading"><h2>逐项依据</h2><span class="muted">${modelUnits.length} 个 JD 单元</span></div>${modelUnits.map(u => {
      const source = units.find(x => (x.id || x.requirement_id) === u.requirement_id) || {};
      return `<article class="wf-assessment-unit"><div class="wf-unit-title"><strong>${e(u.requirement_id)} · ${e(relationLabels[u.relation] || u.relation)}</strong><span class="badge badge-slate">${e(({ skills: '技能', experience: '项目 / 实习', other: '不计分' })[u.group] || u.group)} · ${u.importance === 'required' ? '必需' : '优先'}</span></div><blockquote>${e(source.text || source.quote || source.source_quote || source.content || '')}</blockquote><small>JD 来源：${e(source.source_field || source.sourceField || '岗位正文')}${source.sourceType === 'user_supplement' || source.source_type === 'user_supplement' || source.source === 'user_supplement' ? ' · 本人补充，未经官网核验' : ''}</small><p>${e(u.reason)}</p>${(u.evidence_quotes || []).length ? `<blockquote>事实引用：${u.evidence_quotes.map(e).join('；')}</blockquote>` : ''}${factReferenceMarkup(u.fact_ids, facts)}</article>`;
    }).join('') || '<p class="field-note">本条没有模型逐项分析；请先查看本地条件核对结果。</p>'}</section>
    <details class="panel wf-section"><summary>本次固定输入与来源</summary><h3>${e(job.company || '')} · ${e(job.title || item.jobId)}</h3><p class="wf-preserve">${e(job.description || '')}</p><p class="wf-preserve">${e(job.requirements || '')}</p>${inputs.jdSupplement || inputs.jd_supplement ? `<h3>本人补充正文（未回写公共目录）</h3><p class="wf-preserve">${e(inputs.jdSupplement || inputs.jd_supplement)}</p>` : ''}<p class="field-note">模型：${e(item.model || '未提供')} · 评估时间 ${time(item.createdAt)} · 用量以服务商返回为准，未返回时为未知。</p></details>`;
}

export async function mountEvaluations(root, { mode = 'list', id = '', selectedJobs = new Map(), signal, isCurrent = () => true } = {}) {
  let alive = true, profile, job, detail, history = [], offset = 0, total = 0, busy = false, batchController = null, lastBatch = [], includeStale = true;
  const live = () => alive && !signal?.aborted && isCurrent();
  const fail = error => { if (live() && error.name !== 'AbortError') { const box = root.querySelector('[data-evaluation-error]'); if (box) box.textContent = errorText(error); toast(errorText(error), true); } };
  const run = fn => Promise.resolve().then(fn).catch(fail);
  const heading = `<div class="page-heading"><div><span class="page-kicker">EVIDENCE / JOB MATCH</span><h1>看清岗位，也看清依据。</h1><p>范围仅限本人选定的岗位。评估、材料生成和复核都需要单独同意并主动发起。</p></div><div class="button-row"><a class="button button-soft button-small" href="#/profile">真实底稿</a><a class="button button-soft button-small" href="#/jobs">继续筛选岗位</a></div></div>`;
  async function loadList() {
    const query = new URLSearchParams({ limit: '20', offset: String(offset), includeStale: includeStale ? '1' : '0', ...(mode === 'single' ? { jobId: id } : {}) });
    const data = await api('/job-evaluations?' + query, { signal }); history = listItems(data); total = data.total ?? history.length;
  }
  [profile] = await Promise.all([api('/candidate-profile', { signal }), mode === 'single' ? api('/jobs/' + encodeURIComponent(id), { signal }).then(value => { job = value; }) : Promise.resolve(), mode === 'detail' ? api('/job-evaluations/' + encodeURIComponent(id), { signal }).then(value => { detail = value; }) : loadList()]);
  function batchMarkup() {
    const statuses = { queued: '等待中', running: '正在评估…', success: '成功', error: '失败', cancelled: '已取消' };
    return lastBatch.map(row => `<article class="wf-batch-row"><div><strong>${e(row.item.company)} · ${e(row.item.title)}</strong><small>${e(statuses[row.status])}${row.error && row.status !== 'cancelled' ? '：' + e(row.error) : ''}</small></div>${row.status === 'success' ? `<a href="#/evaluation/${e(row.result.id)}" class="text-link">${row.result.cached ? '缓存命中 · ' : ''}${typeof row.result.totalScore === 'number' ? e(row.result.totalScore) + ' 分 · ' : ''}查看结果 →</a>` : row.status === 'running' ? '<span class="loader"></span>' : ''}</article>`).join('');
  }
  function render() {
    if (!live()) return;
    const selected = [...selectedJobs.values()];
    const historyMarkup = `<section class="panel wf-section"><div class="panel-heading"><h2>${mode === 'single' ? '本岗位评估记录' : '本人评估记录'} <span>${total}</span></h2><label class="wf-inline-check"><input type="checkbox" id="include-stale" ${includeStale ? 'checked' : ''}>包含历史来源版本</label></div><p class="field-note">结果按“条件通过且可比较、条件待核实、信息不足、条件不符”分组；不同组的分数不混排。</p>${history.length ? `<div class="wf-evaluation-list">${[...history].sort((a, b) => evaluationRank(a) - evaluationRank(b) || (b.totalScore ?? -1) - (a.totalScore ?? -1)).map(item => `<article class="wf-evaluation-row"><div><a class="wf-row-title" href="#/evaluation/${e(item.id)}">${e(item.job?.company || item.company || item.jobId)} · ${e(item.job?.title || item.title || item.jobTitle || '查看岗位评估')}</a><small>底稿 V${e(item.profileRevision)} · ${time(item.createdAt)} · ${e(gateLabels[item.gateState] || '信息不足')}${item.stale ? ' · 来源已变化' : ''}</small></div>${evaluationSummaryMarkup(item)}<button class="text-link danger-link" data-evaluation-action="delete" data-id="${e(item.id)}">删除</button></article>`).join('')}</div>` : emptyState('还没有评估结果', '在岗位库勾选最多 10 个目标岗位，或进入岗位详情单独评估。')}<div class="pagination"><span>${total ? offset + 1 : 0}–${Math.min(offset + 20, total)} / ${total}</span><button class="button button-soft button-small" data-evaluation-action="previous" ${offset > 0 ? '' : 'disabled'}>上一页</button><button class="button button-soft button-small" data-evaluation-action="next" ${offset + 20 < total ? '' : 'disabled'}>下一页</button></div></section>`;
    const context = mode === 'single' ? `<section class="panel wf-section"><h2>${e(job.company)} · ${e(job.title)}</h2>${jobQualityMarkup(job)}<details><summary>核对本岗位原文</summary><p class="wf-preserve">${e(job.description)}</p><p class="wf-preserve">${e(job.requirements)}</p></details></section>` : '';
    const runForm = mode === 'detail' ? '' : `<section class="panel wf-section"><div class="panel-heading"><h2>${mode === 'single' ? '评估此岗位' : '顺序评估选定岗位'}</h2><span class="badge badge-slate">底稿 V${profile.revision}</span></div>${profile.ready === false || !profile.revision ? `<div class="wf-notice">底稿尚未就绪：${e((profile.missing || ['请先确认真实经历和求职偏好']).join('；'))}。<a href="#/profile">去完善底稿 →</a></div>` : ''}${mode === 'list' ? `<div class="wf-selected-jobs">${selected.length ? selected.map(j => `<span>${e(j.company)} · ${e(j.title)}</span>`).join('') : '<p class="field-note">尚未选择岗位。请先到岗位库主动勾选。</p>'}</div>` : ''}<form id="evaluation-form">${mode === 'single' ? '<label class="field"><span>本人补充 JD（选填）</span><textarea name="jdSupplement" rows="6" maxlength="48000" placeholder="仅粘贴该官方岗位适用的补充正文；内容用于本次私人评估，不获得官网核验标记。"></textarea></label>' : '<p class="field-note">逐项发起，每批最多 10 个；个别失败不会撤销成功结果。未选中的岗位不会调用模型。</p>'}<label class="consent"><input type="checkbox" name="consent" required><span>我同意将已确认事实、求职偏好及本次岗位正文发送到已配置的 AI 服务。请核对<a href="#/settings">服务商设置</a>。</span></label><div class="button-row"><button class="button button-primary" type="submit" ${profile.ready === false || !profile.revision || (mode === 'list' && !selected.length) ? 'disabled' : ''}>${mode === 'single' ? '开始评估此岗位' : `开始顺序评估 ${selected.length} 个岗位`}</button><button class="button button-soft" type="button" data-evaluation-action="cancel" hidden>取消当前与后续评估</button><span data-evaluation-step class="muted"></span></div></form><div data-batch-results class="wf-batch-results" aria-live="polite">${batchMarkup()}</div></section>`;
    root.innerHTML = heading + context + runForm + '<p class="form-error" data-evaluation-error role="alert"></p>' + (detail ? `<div class="button-row wf-section"><button class="button button-primary button-small" data-evaluation-action="materials" ${detail.stale || detail.gateState === 'fail' ? 'disabled' : ''}>加入清单并准备材料 →</button><a class="button button-soft button-small" href="#/evaluate/${e(detail.jobId)}">重新评估此岗位</a><button class="text-link" data-evaluation-action="export">导出本条评估</button><button class="text-link danger-link" data-evaluation-action="delete" data-id="${e(detail.id)}">删除本条评估</button></div>${evaluationDetailMarkup(detail)}` : '') + (mode === 'detail' ? '' : historyMarkup);
  }
  function evaluationRank(item) { return item.stale || item.totalScore == null ? item.gateState === 'fail' ? 3 : 2 : item.gateState === 'pass' ? 0 : item.gateState === 'needs_review' ? 1 : 3; }
  const onSubmit = event => { if (event.target.id !== 'evaluation-form') return; event.preventDefault(); const form = event.target; run(async () => {
    if (busy) return; if (!form.elements.consent.checked) throw new Error('开始前请确认本次资料外发范围。');
    const supplement = form.elements.jdSupplement?.value || ''; if (Array.from(supplement).length > 24000) throw new Error('补充正文最多 24,000 个 Unicode 码点。');
    busy = true; batchController = new AbortController(); const abort = () => batchController?.abort(); signal?.addEventListener('abort', abort, { once: true });
    form.querySelector('[type=submit]').disabled = true; form.querySelector('[data-evaluation-action=cancel]').hidden = false;
    try {
      const jobs = mode === 'single' ? [job] : [...selectedJobs.values()];
      await runSequentialEvaluations(jobs, async (j, requestSignal) => api('/job-evaluations', { method: 'POST', signal: requestSignal, timeout: 105000, data: { jobId: j.id, profileRevision: profile.revision, jdSupplement: supplement, consent: true } }), {
        signal: batchController.signal, onUpdate(rows) {
          lastBatch = rows; if (!live()) return; root.querySelector('[data-batch-results]').innerHTML = batchMarkup();
          const done = rows.filter(x => !['queued', 'running'].includes(x.status)).length; root.querySelector('[data-evaluation-step]').textContent = `${done} / ${jobs.length} 已处理`;
        },
      });
      if (!live()) return;
      if (mode === 'single' && lastBatch[0]?.status === 'success') detail = await api('/job-evaluations/' + encodeURIComponent(lastBatch[0].result.id), { signal });
      await loadList(); if (live()) render();
    } finally { busy = false; signal?.removeEventListener('abort', abort); if (live()) { const start = root.querySelector('#evaluation-form [type=submit]'); if (start) start.disabled = false; const cancel = root.querySelector('[data-evaluation-action=cancel]'); if (cancel) cancel.hidden = true; } }
  }); };
  const onClick = event => { const button = event.target.closest('[data-evaluation-action]'); if (!button || button.disabled) return; run(async () => {
    const action = button.dataset.evaluationAction;
    if (action === 'cancel') { batchController?.abort(); toast('已停止后续评估，并尝试取消当前请求。'); return; }
    if (action === 'export') { downloadJson(detail, 'Offerbiu-岗位评估-' + detail.id + '.json'); return; }
    if (action === 'materials') { const app = await api('/applications', { method: 'POST', signal, data: { jobId: detail.jobId } }); if (live()) location.hash = '/materials/' + (app.id || app.application?.id) + '?evaluation=' + encodeURIComponent(detail.id); return; }
    if (action === 'delete') {
      if (!confirm('删除这条个人评估？已生成材料和投递留档中的独立快照会保留，可到对应投递分别删除。')) return;
      await api('/job-evaluations/' + encodeURIComponent(button.dataset.id), { method: 'DELETE', signal }); if (!live()) return;
      if (mode === 'detail') { location.hash = '/evaluations'; return; }
      if (detail?.id === button.dataset.id) detail = null; await loadList(); render(); toast('已删除个人评估。'); return;
    }
    offset = action === 'next' ? offset + 20 : Math.max(0, offset - 20); await loadList(); render();
  }); };
  const onChange = event => { if (event.target.id === 'include-stale') { includeStale = event.target.checked; offset = 0; run(async () => { await loadList(); render(); }); } };
  root.addEventListener('submit', onSubmit); root.addEventListener('click', onClick); root.addEventListener('change', onChange); render();
  return { isDirty: () => false, destroy() { alive = false; batchController?.abort(); root.removeEventListener('submit', onSubmit); root.removeEventListener('click', onClick); root.removeEventListener('change', onChange); } };
}
