import { api, setCsrf } from './api.js';
import { escape as e, icon, date, time, localDateInput, companyLogo, emptyState, toast, loading, dialog, downloadJson, statusBadge, safeUrl, polishDiagnosisMarkup } from './ui.js';
import { mountEditor } from './editor.js';
import { mountPrivateJobs } from './private-jobs.js';
import { mountProfile } from './profile.js';
import { mountEvaluations, jobQualityMarkup, evaluationSummaryMarkup, evaluationSelectionMarkup } from './job-evaluation.js';
import { mountApplicationMaterials } from './application-materials.js';
import { mountApplicationTimeline } from './application-timeline.js';
import { resumeMarkup } from './resume-renderer.js';
import { RESUME_FILE_LIMIT } from '/shared/resume-media.mjs';
import { availabilityForJob } from '/shared/job-workflow.mjs';
import { templates, statuses, blankResume, resumeText, sampleResume } from '/shared/templates.mjs';

const main = document.getElementById('workspace-content');
const emptyJobFilters = () => ({ q: '', company: '', company_nature: '', city: '', category: '', industry: '', record_type: 'job', source_type: '', base_scope: '', batch: '', sort: 'recent', page: 1 });
const state = { user: null, meta: null, route: 'overview', editor: null, workflow: null, pageController: null, navigation: 0, jobs: emptyJobFilters(), displayedJobs: [], activeJobId: '', selectedJobs: new Map(), applications: [], resumes: [], tasks: [], calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selectedDay: '', appFilter: 'all', selectedApplications: new Set() };
const navigation = [['overview', '总览'], ['jobs', '校招岗位库'], ['private-jobs', '私人岗位'], ['applications', '我的投递'], ['profile', '真实经历底稿'], ['evaluations', '岗位评估记录'], ['resumes', '简历中心'], ['templates', '模板与工作室'], ['calendar', '日程与待办'], ['ai', 'AI 润色记录'], ['settings', '个人设置']];
const pageHeaders = {
  overview: ['求职总览', '查看近期安排和投递进展。'],
  jobs: ['校招岗位库', '企业官网与西北大学发布的 2027 届具体岗位。'],
  applications: ['我的投递', '管理投递状态、简历版本和下次跟进。'],
  resumes: ['简历中心', '编辑简历，按岗位保存不同版本。'],
  templates: ['简历模板', `${templates.length} 套可在线编辑的版式。`],
  calendar: ['日程与待办', '安排截止提醒、笔试、面试和跟进。'],
  ai: ['AI 润色记录', '查看原文、HR 初看和润色建议。采纳前不会改简历。'],
  settings: ['个人设置', '管理账号、数据和 AI 服务。']
};
function pageHeading(key, action = '') { const [title, sub] = pageHeaders[key]; return `<div class="page-heading"><div><span class="page-kicker">2027 届 / 校招手册</span><h1>${title}</h1><p>${sub}</p></div>${action}</div>`; }
Object.assign(pageHeaders, { profile: ['让真实经历，成为依据。', '确认本人事实和求职偏好，再评估岗位与准备材料。'], evaluations: ['每个判断，都有依据。', '仅评估你主动选择的岗位，保留原文、事实引用与待核实项。'], materials: ['为这次机会，准备材料。', '核对草稿、单独复核、人工采纳，再确认实际投递快照。'] });
function errorMessage(error) { if (error.name !== 'AbortError') toast(error.message || '操作未完成。', true); }
function handle(promise) { Promise.resolve(promise).catch(errorMessage); }
function accountDraftKey(userId, resumeId) { return `offerbiu:resume-draft:${userId}:${resumeId}`; }
function setAccount() {
  document.getElementById('user-name').textContent = state.user?.name || '访客浏览';
  document.getElementById('user-caption').textContent = state.user ? state.user.email : '登录以保存你的进展';
  document.getElementById('user-avatar').textContent = state.user?.name.slice(0, 1) || 'O';
}
function renderNav() {
  document.getElementById('side-nav').innerHTML = navigation.map(([key, label]) => `${key === 'profile' ? '<span class="nav-group-label">经历与材料准备</span>' : key === 'settings' ? '<span class="nav-divider"></span>' : ''}<a href="#/${key}" class="nav-item ${state.route === key || (['resume','studio'].includes(state.route) && key === 'resumes') || (['evaluate','evaluation'].includes(state.route) && key === 'evaluations') || (state.route === 'materials' && key === 'applications') ? 'active' : ''}">${icon(key === 'private-jobs' ? 'jobs' : key === 'profile' ? 'resumes' : key === 'evaluations' ? 'ai' : key)}<span>${label}</span>${key === 'jobs' ? `<small>${state.meta?.jobs.count || 0}</small>` : key === 'ai' ? '<small class="nav-ai">AI</small>' : ''}</a>`).join('');
}
function requireUser(callback) { if (!state.user) { showAuth('register', callback); return false; } callback?.(); return true; }
function loginEmpty(key) { return pageHeading(key) + `<div class="welcome-panel"><span class="welcome-art">↗</span><div><span class="page-kicker">WELCOME TO YOUR WORKSPACE</span><h2>从一个机会，开始你的秋招。</h2><p>登录后，投递、简历和日程会保存到你的独立账号。你也可以先看看真实岗位。</p><div class="button-row"><button class="button button-primary" data-action="auth">创建我的工作台 ${icon('arrow')}</button><a href="#/jobs" class="button button-soft">先看看岗位</a></div></div></div><div class="intro-grid"><article>${icon('jobs')}<h3>${state.meta.jobs.count} 条校招信息</h3><p>届别、原始来源与采集时间可追溯。</p></article><article>${icon('resumes')}<h3>简历在线编辑</h3><p>${templates.length} 套模板、图片上传与历史版本。</p></article><article>${icon('ai')}<h3>AI 润色</h3><p>围绕真实经历优化表达，由你采纳。</p></article></div>`; }

function showAuth(mode = 'login', after) {
  const register = mode === 'register';
  dialog(register ? '创建你的秋招工作台' : '欢迎回到 Offerbiu', `<p class="modal-description">${register ? '用一个账号，保存岗位、简历与每次进展。邮箱作为登录账号，本地版本不发送验证邮件。' : '继续推进今天的下一步。'}</p><form id="auth-form">${register ? '<label class="field"><span>怎么称呼你</span><input name="name" maxlength="50" autocomplete="name" required placeholder="你的称呼"></label>' : ''}<label class="field"><span>邮箱</span><input name="email" type="email" maxlength="254" autocomplete="email" required placeholder="name@example.com"></label><label class="field"><span>密码</span><input name="password" type="password" minlength="8" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" required placeholder="至少 8 个字符"></label><p class="form-error" role="alert"></p><button class="button button-primary button-full" type="submit">${register ? '创建账号' : '登录工作台'} ${icon('arrow')}</button></form><div class="auth-switch">${register ? '已有账号？' : '还没有账号？'} <button class="text-link" id="auth-switch">${register ? '直接登录' : '创建一个'}</button></div>`, el => {
    el.querySelector('#auth-switch').addEventListener('click', () => showAuth(register ? 'login' : 'register', after));
    el.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const button = form.querySelector('button'); button.disabled = true; form.querySelector('.form-error').textContent = '';
      try { const result = await api('/auth/' + (register ? 'register' : 'login'), { method: 'POST', data: Object.fromEntries(new FormData(form)) }); state.user = result.user; setCsrf(result.csrf); setAccount(); el.close(); await renderRoute(); after?.(); toast(register ? '工作台已创建。可以开始整理你的秋招了。' : '欢迎回来。'); }
      catch (err) { form.querySelector('.form-error').textContent = err.message; button.disabled = false; }
    });
  });
}

function taskItem(task, compact = false) {
  const overdue = !task.completed && task.due_at && new Date(task.due_at) < new Date();
  const related = task.application_id ? ` · <button type="button" class="text-link" data-action="edit-application" data-id="${e(task.application_id)}">查看投递</button>` : '';
  return `<div class="task-item ${task.completed ? 'is-complete' : ''}"><button class="task-check ${task.completed ? 'checked' : ''}" data-action="toggle-task" data-id="${task.id}" data-completed="${task.completed}" aria-label="${task.completed ? '重新打开' : '完成'} ${e(task.title)}">${task.completed ? icon('check') : ''}</button><div class="task-item-body"><strong>${e(task.title)}</strong><small>${time(task.due_at)}${task.notes && !compact ? ' · ' + e(task.notes) : ''}${related}</small></div><span class="badge ${overdue ? 'badge-red' : 'badge-slate'}">${overdue ? '待跟进' : e(task.kind)}</span>${!compact ? `<button class="icon-button" data-action="delete-task" data-id="${task.id}" aria-label="删除待办">${icon('trash')}</button>` : ''}</div>`;
}

async function overviewPage() {
  if (!state.user) return loginEmpty('overview');
  const d = await api('/dashboard'); state.applications = d.applications; state.tasks = d.tasks;
  const today = dayKey(new Date());
  const inSevenDays = new Date();
  inSevenDays.setDate(inSevenDays.getDate() + 7);
  const weekEnd = dayKey(inSevenDays);
  const groups = new Map([['已逾期', []], ['今天', []], ['未来 7 天', []], ['稍后', []], ['待安排', []]]);
  for (const task of d.tasks.filter(task => !task.completed)) {
    const due = new Date(task.due_at || '');
    const day = Number.isFinite(due.getTime()) ? dayKey(due) : '';
    const group = !day ? '待安排' : day < today ? '已逾期' : day === today ? '今天' : day <= weekEnd ? '未来 7 天' : '稍后';
    groups.get(group).push(task);
  }
  const recent = d.applications.slice(0, 4);
  const submitted = d.applications.filter(a => a.applied_at).length;
  const metrics = [['目标岗位', d.total], ['记录了投递时间', submitted], ['面试中', d.counts.interview], ['Offer', d.counts.offer]];
  return pageHeading('overview', '<a class="button button-primary button-small" href="#/jobs">浏览校招岗位 ↗</a>') + `
    <div class="dashboard-columns handbook-dashboard">
      <section class="panel next-step-panel"><div class="panel-heading"><h2>下一步 <span>${d.pendingTasks}</span></h2><button class="text-link" data-action="new-task">添加待办 +</button></div>
        ${d.pendingTasks ? [...groups].filter(([, tasks]) => tasks.length).map(([label, tasks]) => `<section class="next-step-group"><h3>${label} <span>${tasks.length}</span></h3>${tasks.slice(0, 3).map(task => taskItem(task, true)).join('')}</section>`).join('') : emptyState('暂时没有待办', '为笔试、面试或下次跟进留一个位置。')}
        <a class="text-link panel-end-link" href="#/calendar">查看全部日程 →</a>
      </section>
      <section class="panel overview-progress"><div class="panel-heading"><h2>投递概况</h2><a href="#/applications" class="text-link">查看记录 →</a></div>
        <dl>${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value || 0}</dd></div>`).join('')}</dl>
        ${d.archived ? `<p class="data-note">${d.archived} 条目标岗位已下架，投递进展仍可查看。</p>` : ''}
        <div class="resume-nudge">${icon('resumes')}<span>已保存 <strong>${d.resumeCount}</strong> 份简历</span><a class="text-link" href="#/resumes">简历中心 →</a></div>
      </section>
    </div>
    <section class="panel application-list"><div class="panel-heading"><h2>最近更新的投递</h2><a href="#/applications" class="text-link">查看全部 →</a></div>${recent.length ? recent.map(a => applicationRow(a)).join('') : emptyState('还没有投递记录', '将目标岗位加入清单，开始记录进度。', '<a class="button button-soft button-small" href="#/jobs">浏览校招岗位</a>')}</section>`;
}

const wideJobs = matchMedia('(min-width: 1050px)');
function sourceLabel(job) {
  return job.source_type === 'private' ? '私人来源' : job.source_type === 'nwu_official' ? '西北大学' : job.source_type === 'employer_official' ? '企业官网' : '历史来源';
}
function applyLink(job, primary = false) {
  const url = safeUrl(job.apply_url);
  const label = job.source_type === 'private' ? '打开本人保存的投递链接' : job.source_type === 'nwu_official' ? '去西大岗位页' : '去官网投递';
  return url ? `<a class="${primary ? 'button button-primary button-small' : 'text-link'}" href="${e(url)}" target="_blank" rel="noopener noreferrer">${label} ↗</a>` : '';
}
function jobEntry(job) {
  const cities = job.cities || [];
  const location = cities.slice(0, 3).join(' / ') + (cities.length > 3 ? ` 等 ${cities.length} 地` : '');
  const selected = state.activeJobId === job.id;
  const closed = availabilityForJob(job).state === 'closed';
  return `<article class="job-index-entry${selected ? ' is-current' : ''}">
    <button type="button" class="job-index-title" data-action="job-detail" data-id="${e(job.id)}" aria-controls="job-reader app-dialog"${selected ? ' aria-current="true"' : ''}>${e(job.title)}</button>
    <p class="job-index-company">${e(job.company)}<span>${sourceLabel(job)}</span>${closed ? '<span>已停止招聘</span>' : ''}</p>
    <dl class="job-index-facts"><div><dt>${job.base_scope === 'campaign' ? '简章 Base' : 'Base'}</dt><dd>${e(location || '未公布')}</dd></div><div><dt>截止</dt><dd>${date(job.deadline)}</dd></div></dl>
    <div class="job-index-actions"><label class="job-index-pick"><input type="checkbox" data-action="pick-job" data-id="${e(job.id)}" aria-label="选择评估 ${e(job.title)}" ${state.selectedJobs.has(job.id) ? 'checked' : ''}>选择评估</label>${applyLink(job)}</div>
  </article>`;
}
function jobDetails(job, inline = false) {
  const source = safeUrl(job.source_url), evidence = safeUrl(job.cohort_evidence_url);
  const fields = [
    [job.base_scope === 'campaign' ? '简章 Base' : 'Base', job.cities?.join(' / ') || '未公布'], ['截止日期', date(job.deadline)],
    ['岗位方向', (job.directions?.length ? job.directions : [job.category]).filter(Boolean).join(' / ') || '未公布'],
    ['招聘批次', job.batch || job.program || '未公布'],
    ['学历', job.education || '详见岗位要求'], ['薪资', job.salary || '未公布']
  ];
  return `<div class="job-reader" data-job-reader>
    <header class="job-reader-heading"><p class="job-reader-kicker">2027 届 / ${sourceLabel(job)}</p>
      ${inline ? `<h2>${e(job.title)}</h2>` : ''}
      <p><strong>${e(job.company)}</strong>${job.employer_unit && job.employer_unit !== job.company ? ' · ' + e(job.employer_unit) : ''}${job.official_job_code ? ' · 岗位代码 ' + e(job.official_job_code) : ''}</p>
      <div class="button-row">${applyLink(job, true)}<button class="button button-soft button-small" data-action="${job.application ? 'edit-application' : 'save-job'}" data-id="${e(job.application?.id || job.id)}">${job.application ? '已在清单 · 查看' : '加入清单 +'}</button></div>
    </header>
    <dl class="job-reader-facts">${fields.map(([label, value]) => `<div><dt>${label}</dt><dd>${e(value)}</dd></div>`).join('')}</dl>
    ${job.base_note ? `<p class="job-reader-note">${e(job.base_note)}</p>` : ''}
    <section class="job-description"><h3>${job.listing_kind === 'notice_role' ? '岗位说明' : '工作职责'}</h3><p>${e(job.description || '请查看招聘详情。')}</p><h3>应聘要求</h3><p>${e(job.requirements || '请查看原始岗位页。')}</p></section>
    <div class="job-reader-assessment"><span data-job-assessment>${job.latest_evaluation ? evaluationSummaryMarkup(job.latest_evaluation) : state.user ? '尚无评估记录' : '登录后可保存评估记录'}</span><a class="text-link" href="#/evaluate/${e(job.id)}">评估此岗位 →</a></div>
    <section class="job-reader-source"><h3>招聘来源</h3><p>${e(job.source_name || sourceLabel(job))}</p>
      <p class="job-reader-note">发布 ${date(job.published_at || job.published_at_raw)} · 采集 ${date(job.collected_at)}${job.link_checked_at ? ' · 链接核验 ' + date(job.link_checked_at) : ''}</p>
      ${jobQualityMarkup(job)}${job.cohort_evidence ? `<p>${e(job.cohort_evidence)}</p>` : ''}${job.notes ? `<p>${e(job.notes)}</p>` : ''}
      <div class="button-row">${source ? `<a href="${e(source)}" target="_blank" rel="noopener noreferrer" class="text-link">查看原始来源 ↗</a>` : ''}${evidence && evidence !== source ? `<a href="${e(evidence)}" target="_blank" rel="noopener noreferrer" class="text-link">查看 2027 届依据 ↗</a>` : ''}</div>
    </section>
  </div>`;
}
async function loadJobAssessment(reader, job) {
  const target = reader.querySelector('[data-job-assessment]');
  if (!state.user) return;
  const signal = state.pageController.signal;
  try {
    const result = await api('/job-evaluations?jobId=' + encodeURIComponent(job.id) + '&limit=1&includeStale=1&sort=recent', { signal });
    if (target.isConnected && !signal.aborted) target.innerHTML = evaluationSummaryMarkup(result.items[0]);
  } catch (err) {
    if (target.isConnected && !signal.aborted) target.textContent = '评估记录暂不可用';
  }
}
function updateJobReader(job) {
  const reader = document.getElementById('job-reader');
  if (!reader || !job) return;
  reader.innerHTML = jobDetails(job, true);
  reader.scrollTop = 0;
  if (wideJobs.matches && !job.latest_evaluation) void loadJobAssessment(reader, job);
}
function showJob(jobId) {
  const job = state.displayedJobs.find(item => item.id === jobId);
  if (!job) return;
  state.activeJobId = jobId;
  main.querySelectorAll('[data-action=job-detail]').forEach(button => {
    const selected = button.dataset.id === jobId;
    button.closest('.job-index-entry').classList.toggle('is-current', selected);
    if (selected) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  updateJobReader(job);
  if (wideJobs.matches) { document.getElementById('job-reader').focus({ preventScroll: true }); return; }
  dialog(job.title, jobDetails(job) + '<button class="button button-soft button-small" type="button" data-close-dialog>← 返回岗位列表</button>', el => {
    el.querySelector('[data-action]').addEventListener('click', event => handle(action(event.currentTarget)));
    el.querySelector('a[href^="#/evaluate/"]').addEventListener('click', () => el.close());
    void loadJobAssessment(el, job);
  }, 'modal-wide job-reader-dialog');
}
async function jobsPage() {
  const signal = state.pageController.signal;
  const f = state.jobs, meta = state.meta.jobs;
  const query = new URLSearchParams(Object.entries(f).filter(([, value]) => value));
  const data = await api('/jobs?' + query, { signal });
  if (signal.aborted) return '';
  const latestEvaluations = new Map();
  if (state.user && data.items.length) {
    const params = new URLSearchParams();
    data.items.slice(0, 15).forEach(job => params.append('jobId', job.id));
    try {
      const summary = await api('/job-evaluations/latest?' + params, { signal });
      for (const item of summary.items || []) latestEvaluations.set(item.jobId, item);
    } catch { /* 岗位列表仍可用；摘要暂缺时不影响浏览。 */ }
  }
  data.items = data.items.map(job => ({ ...job, latest_evaluation: latestEvaluations.get(job.id) || null }));
  state.latestEvaluations = latestEvaluations;
  state.displayedJobs = data.items;
  state.activeJobId = (data.items.find(job => job.id === state.activeJobId) || data.items[0])?.id;
  const options = values => values.map(value => [value, value]);
  const sourceOptions = [['employer_official', '企业官网'], ['nwu_official', '西北大学']];
  const scopeOptions = [['job', '岗位已明确地点'], ['unspecified', '地点未公布']];
  const select = (name, label, choices, primary = false) => `<label class="job-filter-field"><span>${label}</span><select name="${name}" ${primary ? 'data-primary-filter' : ''}><option value="">全部${label}</option>${choices.map(([value, text]) => `<option value="${e(value)}"${f[name] === value ? ' selected' : ''}>${e(text)}</option>`).join('')}</select></label>`;
  const active = [
    ['q', f.q && '关键词 ' + f.q], ['city', f.city && 'Base ' + f.city], ['category', f.category],
    ['company', f.company], ['company_nature', f.company_nature], ['industry', f.industry], ['batch', f.batch],
    ['source_type', sourceOptions.find(([value]) => value === f.source_type)?.[1]],
    ['base_scope', scopeOptions.find(([value]) => value === f.base_scope)?.[1]],
  ].filter(([, value]) => value);
  return pageHeading('jobs') + `
    <form id="job-filters" class="job-index-filters">
      <input type="hidden" name="record_type" value="job">
      <div class="job-index-search">
        <label class="job-filter-field"><span>关键词</span><span class="job-search-input">${icon('search')}<input name="q" value="${e(f.q)}" maxlength="100" placeholder="搜索公司、岗位或技能"></span></label>
        ${select('city', 'Base', options(state.meta.cities), true)}
        ${select('category', '岗位方向', options(state.meta.categories), true)}
        <button class="button button-primary" type="submit">搜索</button>
      </div>
      <details class="job-more-filters">
        <summary>更多筛选</summary>
        <div class="job-more-fields">
          ${select('company', '企业', options(state.meta.companies.map(c => c.company)))}
          ${select('company_nature', '企业性质', options(state.meta.companyNatures || []))}
          ${select('industry', '行业', options(state.meta.industries.map(i => i.name)))}
          ${select('batch', '招聘批次', options(state.meta.batches))}
          ${select('source_type', '来源', sourceOptions)}
          ${select('base_scope', '地点精度', scopeOptions)}
          <label class="job-filter-field"><span>排序</span><select name="sort">${[['recent','发布 / 更新优先'],['company','按招聘单位'],['deadline','截止时间优先']].map(([value,label]) => `<option value="${value}"${f.sort === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <button class="button button-soft" type="submit">应用筛选</button>
        </div>
      </details>
    </form>
    <div class="job-index-meta" aria-live="polite">
      <strong>${data.total} 条岗位</strong>
      ${active.map(([key, label]) => `<button class="job-filter-chip" type="button" data-action="job-facet" data-field="${key}" aria-label="移除筛选 ${e(label)}">${e(label)} <span aria-hidden="true">×</span></button>`).join('')}
      ${active.length || f.sort !== 'recent' ? '<button class="text-link" type="button" data-action="reset-jobs">清除筛选</button>' : ''}
    </div>
    ${evaluationSelectionMarkup(state.selectedJobs)}
    ${data.items.length ? `<div class="job-index-layout"><section class="job-index-list" aria-label="岗位结果">${data.items.map(jobEntry).join('')}</section><aside id="job-reader" class="job-index-detail" aria-label="所选岗位详情" tabindex="0"></aside></div>
    <div class="pagination"><span>第 ${data.page} / ${data.pages} 页</span><button class="button button-soft button-small" data-action="job-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><button class="button button-soft button-small" data-action="job-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button></div>` : emptyState('没有匹配的岗位', '试试减少关键词，或放宽 Base 和岗位方向。', '<button class="button button-soft button-small" data-action="reset-jobs">清除筛选</button>')}
    <p class="data-note">${e(meta.limitations)} 「加入清单」用于管理个人进度，正式申请请前往对应的企业或西北大学岗位页。</p>`;
}
async function saveJob(jobId, trigger) {
  const userId = state.user.id;
  trigger.disabled = true;
  try {
    const result = await api('/applications', { method: 'POST', data: { jobId } });
    if (state.user?.id !== userId) return;
    const job = state.displayedJobs.find(item => item.id === jobId);
    if (job) job.application = { id: result.id };
    document.querySelectorAll('[data-job-reader] [data-action="save-job"]').forEach(button => {
      if (button.dataset.id !== jobId) return;
      button.dataset.action = 'edit-application';
      button.dataset.id = result.id;
      button.textContent = '已在清单 · 查看';
      button.disabled = false;
    });
    toast(result.existing ? '该岗位已在「我的投递」清单中。' : '已加入清单。正式申请请前往岗位投递页。');
  } finally {
    trigger.disabled = false;
  }
}

function statusOptions(current) { return statuses.map(s => `<option value="${s.id}" ${s.id === current ? 'selected' : ''}>${s.label}</option>`).join(''); }
/** In-list progress control: changing it saves immediately, so no dialog round trip is needed. */
function inlineStatus(a) {
  return `<label class="application-status"><select data-action="app-status" data-id="${a.id}" aria-label="更新投递状态">${statusOptions(a.status)}</select></label>`;
}
function applicationRow(a, manage = false) {
  const selected = manage && state.selectedApplications.has(a.id);
  const picker = manage ? `<label class="application-pick"><input type="checkbox" data-action="pick-application" data-id="${a.id}" ${selected ? 'checked' : ''} aria-label="选择这条投递记录"></label>` : '';
  const progress = manage ? inlineStatus(a) : statusBadge(a.status, statuses);
  const edit = manage ? '' : `<button class="button button-soft button-small application-edit" data-action="edit-application" data-id="${a.id}">编辑</button>`;
  return `<div class="application-row${manage ? ' application-row-manage' : ''}${selected ? ' is-selected' : ''}"${manage ? ` data-row="${a.id}"` : ''}>${picker}${companyLogo(a.job.company)}
    <div class="application-main">
      <button class="application-title" data-action="edit-application" data-id="${a.id}"><strong>${e(a.job.title || '岗位未知')}</strong><small>${e(a.job.company || '公司未知')}${a.job.job_type === 'private' ? ' · 私人岗位' : ''} · ${e(a.job.cities?.join(' / ') || 'Base 未公布')}${a.job.catalog_active === false ? (a.job.job_type === 'private' ? ' · 已归档' : ' · 已下架（历史记录）') : ''}</small></button>
      <div class="application-meta"><span class="application-next">${a.next_date ? '下一步 ' + time(a.next_date) : '下一步待安排'}</span>${a.updated_at ? `<span class="application-updated">更新 ${time(a.updated_at)}</span>` : ''}<span class="application-resume">${a.resume_title ? e(a.resume_title) + ' · V' + a.resume_revision : '尚未绑定简历'}</span></div>
    </div>
    <a class="text-link wf-app-material-link" href="#/materials/${e(a.id)}">材料与留档 →</a>${progress}${edit}</div>`;
}
async function applicationsPage() {
  if (!state.user) return loginEmpty('applications');
  state.applications = await api('/applications');
  // Drop selections that no longer exist, so a batch action can never carry a stale id.
  const present = new Set(state.applications.map(a => a.id));
  for (const id of [...state.selectedApplications]) if (!present.has(id)) state.selectedApplications.delete(id);
  const rows = state.applications.filter(a => state.appFilter === 'all' || a.status === state.appFilter);
  const archivedCount = state.applications.filter(a => a.job.catalog_active === false).length;
  const picked = state.selectedApplications.size;
  const allPicked = rows.length > 0 && rows.every(a => state.selectedApplications.has(a.id));
  const toolbar = `<div class="batch-bar${picked ? ' is-active' : ''}" role="group" aria-label="批量操作"><label class="batch-all"><input type="checkbox" data-action="pick-all-applications" ${allPicked ? 'checked' : ''} ${rows.length ? '' : 'disabled'}> 全选本页</label><span class="batch-count">已选 <strong>${picked}</strong> 条</span><div class="batch-actions"><button class="button button-soft button-small" data-action="batch-status" ${picked ? '' : 'disabled'}>批量改状态</button><button class="button button-soft button-small" data-action="batch-task" ${picked ? '' : 'disabled'}>批量安排待办</button><button class="button button-soft button-small danger-link" data-action="batch-remove" ${picked ? '' : 'disabled'}>移出清单</button><button class="text-link" data-action="clear-selection" ${picked ? '' : 'disabled'}>取消选择</button></div></div>`;
  return pageHeading('applications', '<a href="#/jobs" class="button button-primary button-small">发现新机会 +</a>') + `<div class="status-filters" role="group" aria-label="按状态筛选"><button type="button" class="${state.appFilter === 'all' ? 'active' : ''}" aria-pressed="${state.appFilter === 'all'}" data-action="app-filter" data-status="all">全部 <span>${state.applications.length}</span></button>${statuses.map(s => `<button type="button" class="${state.appFilter === s.id ? 'active' : ''}" aria-pressed="${state.appFilter === s.id}" data-action="app-filter" data-status="${s.id}">${s.label} <span>${state.applications.filter(a => a.status === s.id).length}</span></button>`).join('')}</div>${state.applications.length ? toolbar : ''}<section class="panel application-list" id="application-list">${rows.length ? rows.map(a => applicationRow(a, true)).join('') : emptyState('这里还没有投递记录', '从岗位库收下目标职位，再记录投递状态和简历版本。', '<a href="#/jobs" class="button button-primary button-small">去岗位库看看</a>')}</section><p class="data-note">直接改状态下拉即可保存进度，不必打开弹窗。「加入清单」只保存在你的账号里，不会代你向企业提交。${archivedCount ? ` 其中 ${archivedCount} 条岗位已下架，仅保留历史记录。` : ''} 实际投递请点岗位卡上的「去官网投递」。</p>`;
}
async function editApplication(applicationId, trigger) {
  if (!requireUser(() => {})) return;
  const navigation = state.navigation, signal = state.pageController?.signal;
  const [apps, resumes] = await Promise.all([api('/applications', { signal }), api('/resumes', { signal })]);
  if (navigation !== state.navigation || signal?.aborted || (trigger && (!trigger.isConnected || trigger.closest('dialog')?.open === false))) return;
  state.applications = apps;
  const a = apps.find(x => x.id === applicationId); if (!a) throw new Error('这条投递已不存在。');
  dialog('推进这份机会', `<div class="job-detail-brand">${companyLogo(a.job.company)}<div><strong>${e(a.job.title || '岗位未知')}</strong><small>${e(a.job.company || '公司未知')}${a.job.job_type === 'private' ? ' · 私人岗位' : ''}</small></div></div>${a.job.archived_at ? '<p class="archived-job-note">私人岗位已归档，已有材料、投递与留档仍保留。</p>' : a.job.catalog_active === false ? '<p class="archived-job-note">此岗位已从当前岗位库下架（来源规则调整或投递页待核实）。这条收藏和原有进展仍为你保留。</p>' : ''}<div class="wf-application-entry"><a class="button button-soft button-small" id="application-materials-link" href="#/materials/${e(a.id)}">准备材料、复核与投递留档 →</a>${a.job.archived_at ? '<span class="muted">私人岗位已归档，恢复后可重新评估。</span>' : `<a class="text-link" id="application-evaluation-link" href="#/evaluate/${e(a.job_id || a.job.id)}">评估本岗位</a>`}</div><form id="application-form"><div class="form-grid"><label class="field"><span>当前状态</span><select name="status">${statuses.map(s => `<option value="${s.id}" ${a.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label><label class="field"><span>使用的简历</span><select name="resumeId"><option value="">暂不绑定</option>${resumes.map(r => `<option value="${r.id}" ${r.id === a.resume_id ? 'selected' : ''}>${e(r.title)} · 当前 V${r.revision}</option>`).join('')}</select></label><label class="field"><span>实际投递时间</span><input type="datetime-local" name="appliedAt" value="${localDateInput(a.applied_at)}"></label><label class="field"><span>下次跟进时间</span><input type="datetime-local" name="nextDate" value="${localDateInput(a.next_date)}"></label><label class="field field-wide"><span>备注 / 面试记录</span><textarea name="notes" rows="5" maxlength="10000" placeholder="记录你关心的信息、沟通结果和下一步。">${e(a.notes)}</textarea></label></div>${a.resume_id ? `<label class="consent"><input name="refreshResumeSnapshot" type="checkbox"><span>更新为所选简历的最新版本快照（目前绑定 V${a.resume_revision}）</span></label>` : ''}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="text-link danger-link" id="remove-application">移出清单</button><button type="button" class="button button-soft" id="application-task">安排待办</button><button class="button button-primary" type="submit">保存进展 ${icon('check')}</button></div></form>`, el => {
    el.querySelectorAll('#application-materials-link,#application-evaluation-link').forEach(link => link.addEventListener('click', () => el.close()));
    const timeline = document.createElement('div');
    el.querySelector('form').before(timeline);
    mountApplicationTimeline(timeline, a.id, { signal });
    if (a.has_resume_snapshot) {
      const snapshotButton = document.createElement('button');
      snapshotButton.type = 'button'; snapshotButton.className = 'text-link snapshot-link';
      snapshotButton.textContent = `查看当时绑定的简历内容 · V${a.resume_revision}`;
      el.querySelector('.job-detail-brand').after(snapshotButton);
      snapshotButton.addEventListener('click', async () => {
        try {
          const snapshot = await api('/applications/' + a.id + '/resume', { signal });
          if (!el.open || !snapshotButton.isConnected || signal?.aborted) return;
          dialog('投递时的简历内容 · V' + snapshot.revision, `<p class="modal-description">这是绑定岗位时保存的内容快照，不会随编辑器里的后续修改而改变。</p><pre class="snapshot-text">${e(resumeText(snapshot.data))}</pre><div class="modal-actions"><button class="button button-soft" id="download-snapshot">导出这份快照</button><button class="button button-primary" id="back-to-application">返回投递记录</button></div>`, modal => {
            modal.querySelector('#download-snapshot').addEventListener('click', () => downloadJson({ format: 'offerbiu-resume-v1', title: a.job.company + ' · 投递快照 V' + snapshot.revision, template: 'classic', data: snapshot.data }, '投递简历快照.json'));
            modal.querySelector('#back-to-application').addEventListener('click', () => handle(editApplication(a.id)));
          }, 'modal-wide');
        } catch (err) { errorMessage(err); }
      });
    }
    el.querySelector('#application-task').addEventListener('click', () => handle(showTask(a.id)));
    el.querySelector('#remove-application').addEventListener('click', async () => { if (!confirm('删除这条投递记录及其材料、投递留档、简历绑定快照、进展日志？此操作不可恢复，关联待办会保留。')) return; try { await api('/applications/' + a.id, { method: 'DELETE' }); el.close(); await renderRoute(); toast('已移出清单。'); } catch (err) { errorMessage(err); } });
    el.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { await api('/applications/' + a.id, { method: 'PUT', data: { ...values, refreshResumeSnapshot: values.refreshResumeSnapshot === 'on' } }); el.close(); await renderRoute(); toast('进展已保存。'); } catch (err) { form.querySelector('.form-error').textContent = err.message; btn.disabled = false; }
    });
  });
}

function templateThumbnail(template) { return `<div class="template-paper" aria-hidden="true">${resumeMarkup(sampleResume(),template.id,false,{sample:true})}</div>`; }
function templatesPage() { return pageHeading('templates', '<a class="button button-primary button-small" href="#/studio/classic">打开简历工作室 →</a>') + `<div class="template-intro"><span>01 选一套版式</span><span>02 填写真实资料</span><span>03 编辑、润色与导出</span><small>预览中的内容为排版示例，开始编辑时使用空白草稿。</small></div><div class="template-grid studio-template-grid">${[...templates].sort((a,b)=>Number(!!b.featured)-Number(!!a.featured)||Number(!!b.collection)-Number(!!a.collection)).map(t => `<article class="template-card">${templateThumbnail(t)}<div><span class="template-tag">${t.featured ? "新增 · " : t.collection ? "精选 "+t.number+" · " : ""}${e(t.tag)}</span><h2>${e(t.name)}</h2><p>${e(t.description)}</p><div class="template-source">${t.source ? `<a href="${t.source}" target="_blank" rel="noopener noreferrer">${t.collection ? "ResumeCollection · "+t.number : t.license+" · 开源原作"} ↗</a><a href="${t.licenseUrl || "/assets/resume-templates/"+t.id+"/LICENSE"}" target="_blank" rel="noopener noreferrer">许可</a>${t.reference ? `<a href="${t.reference}" target="_blank" rel="noopener noreferrer">原版预览</a>` : ""}` : '<span>Offerbiu 原创模板</span>'}</div><a class="button button-primary button-small" href="#/studio/${t.id}">使用模板 · 在线编辑 ${icon('arrow')}</a></div></article>`).join('')}</div><div class="info-strip">${icon('check')}<p>浏览器内直接编辑、实时预览、导出 PDF / HTML / JSON。登录后保存到个人简历库；开源模板已适配中文，不依赖第三方字体或模板服务器。</p></div>`; }

async function resumesPage() {
  if (!state.user) return pageHeading('resumes','<a class="button button-primary" href="#/studio/classic">直接开始编辑 →</a>') + '<div class="welcome-panel"><div><span class="page-kicker">YOUR RESUME STUDIO</span><h2>先写好简历，再开启下一步。</h2><p>无需登录即可使用简历工作室。草稿保存在本机浏览器（关标签一般不丢）。登录后写入这台电脑上的账号。换电脑前请导出 JSON，或连同数据库和加密密钥一起备份。</p><a class="button button-soft" href="#/templates">挑选精品模板 ↗</a></div></div>';
  state.resumes = await api('/resumes');
  return pageHeading('resumes', '<div class="button-row"><button class="button button-soft button-small" data-action="import-resume">导入 JSON</button><button class="button button-primary button-small" data-action="new-resume">新建简历 +</button></div>') + `<div class="resume-grid">${state.resumes.map(r => `<article class="resume-card"><a href="#/resume/${r.id}" class="resume-card-preview" aria-label="编辑 ${e(r.title)}">${templateThumbnail(templates.find(t => t.id === r.template) || templates[0])}<span class="resume-edit-label">继续编辑 ${icon('arrow')}</span></a><div class="resume-card-body"><span class="template-tag">${e((templates.find(t => t.id === r.template) || templates[0]).name)} · V${r.revision}</span><h2><a href="#/resume/${r.id}">${e(r.title)}</a></h2><p>更新于 ${time(r.updated_at)}</p><div class="resume-card-actions"><a class="button button-soft button-small" href="#/resume/${r.id}">打开编辑器</a><button class="icon-button" data-action="clone-resume" data-id="${r.id}" title="创建副本" aria-label="创建副本">${icon('plus')}</button><button class="icon-button danger-link" data-action="delete-resume" data-id="${r.id}" aria-label="删除简历">${icon('trash')}</button></div></div></article>`).join('')}${!state.resumes.length ? emptyState('你的第一份简历，从这里开始', '选择模板，直接在网页中填写和修改真实经历。', '<a href="#/templates" class="button button-primary">挑选模板 →</a>') : ''}</div><input id="resume-import" type="file" accept=".json,application/json" hidden>`;
}
function createResume(template = 'classic') { location.hash = '/studio/' + template; }
function saveStudioToAccount(draft) {
  const editor = state.editor, generation = editor.editGeneration;
  const persist = async () => {
    if (state.editor !== editor || editor.editGeneration !== generation) return toast('草稿已变更，请在编辑器重新点击「存入我的简历」。');
    const button = main.querySelector('#save-account'); if (button) button.disabled = true;
    try {
      const result = await api('/resumes', { method:'POST',data:draft });
      if (state.editor === editor && editor.editGeneration === generation) {
        editor.markSaved(); location.hash = '/resume/' + result.id;
        toast('已存入你的简历库，可以继续编辑或 AI 润色。');
      } else toast('已将提交时的草稿存入简历中心。');
    } catch(error) { errorMessage(error); }
    finally { if (button) button.disabled = false; }
  };
  if (state.user) handle(persist()); else showAuth('login', () => handle(persist()));
}

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

async function calendarPage() {
  if (!state.user) return loginEmpty('calendar');
  state.tasks = await api('/tasks');
  const month = state.calendarMonth;
  const offset = (month.getDay() + 6) % 7;
  const today = dayKey(new Date());
  const cells = Array.from({ length: 42 }, (_, i) => {
    const day = new Date(month.getFullYear(), month.getMonth(), i - offset + 1);
    const key = dayKey(day);
    const tasks = state.tasks.filter(task => task.due_at && dayKey(new Date(task.due_at)) === key && !task.completed);
    const selected = state.selectedDay === key;
    return `<button class="calendar-day${day.getMonth() !== month.getMonth() ? ' other-month' : ''}${key === today ? ' today' : ''}${selected ? ' selected' : ''}" data-action="select-day" data-day="${key}" aria-label="${key} · ${tasks.length} 项待办" aria-pressed="${selected}"${key === today ? ' aria-current="date"' : ''}>
      <span>${day.getDate()}</span>${tasks.slice(0, 2).map(task => `<small>${e(task.kind)} · ${e(task.title)}</small>`).join('')}${tasks.length > 2 ? `<i>+${tasks.length - 2}</i>` : ''}
      ${tasks.length ? `<b class="calendar-day-count" aria-hidden="true">${tasks.length}</b>` : ''}
    </button>`;
  }).join('');
  const list = state.tasks.filter(task => !state.selectedDay || (task.due_at && dayKey(new Date(task.due_at)) === state.selectedDay));
  return pageHeading('calendar', '<button class="button button-primary button-small" data-action="new-task">添加安排 +</button>') + `
    <div class="calendar-layout">
      <section class="panel calendar-panel">
        <div class="panel-heading"><h2>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</h2><div class="button-row"><button class="icon-button" data-action="calendar-month" data-delta="-1" aria-label="上个月">‹</button><button class="text-link" data-action="calendar-today">今天</button><button class="icon-button" data-action="calendar-month" data-delta="1" aria-label="下个月">›</button></div></div>
        <div class="calendar-week">${['一', '二', '三', '四', '五', '六', '日'].map(day => `<span>${day}</span>`).join('')}</div>
        <div class="calendar-grid">${cells}</div>
      </section>
      <section class="panel">
        <div class="panel-heading"><h2>${state.selectedDay ? e(state.selectedDay) : '全部安排'}</h2>${state.selectedDay ? '<button class="text-link" data-action="clear-day">查看全部</button>' : ''}</div>
        ${list.length ? list.map(task => taskItem(task)).join('') : emptyState('暂无安排', '可以添加面试、笔试或跟进提醒。')}
      </section>
    </div>`;
}
async function showTask(applicationId = '') {
  if (!state.user) { showAuth('register', () => handle(showTask(applicationId))); return; }
  const signal = state.pageController?.signal;
  const applications = await api('/applications', { signal });
  if (signal?.aborted) return;
  dialog('安排你的下一步', `<form id="task-form"><label class="field"><span>要做什么</span><input name="title" maxlength="200" required placeholder="如：准备产品经理一面"></label><div class="form-grid"><label class="field"><span>类型</span><select name="kind">${['面试', '笔试', '截止', '跟进', '其他'].map(s => `<option>${s}</option>`).join('')}</select></label><label class="field"><span>日期与时间（可选）</span><input name="dueAt" type="datetime-local" value="${state.selectedDay ? state.selectedDay + 'T09:00' : localDateInput(new Date(Date.now() + 3600000).toISOString())}"></label></div><label class="field"><span>关联投递（可选）</span><select name="applicationId"><option value="">不关联</option>${applications.map(a => `<option value="${a.id}" ${a.id === applicationId ? 'selected' : ''}>${e(a.job.company)} · ${e(a.job.title)}</option>`).join('')}</select></label><label class="field"><span>备注</span><textarea name="notes" rows="3" maxlength="3000" placeholder="会议链接、面试准备、需要携带的材料…"></textarea></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button button-primary" type="submit">保存安排 ${icon('check')}</button></div></form>`, el => {
    el.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget, button = form.querySelector('[type=submit]');
      button.disabled = true;
      try {
        await api('/tasks', { method: 'POST', data: Object.fromEntries(new FormData(form)) });
        if (form.isConnected) el.close();
        await renderRoute();
        toast('下一步已安排。');
      } catch (err) { form.querySelector('.form-error').textContent = err.message; button.disabled = false; }
    });
  });
}

async function aiPage() {
  if (!state.user) return loginEmpty('ai');
  const [reports, settings] = await Promise.all([api('/ai/reports'), api('/settings/ai')]); state.reports = reports;
  return pageHeading('ai', `<a href="#/${settings.configured ? 'resumes' : 'settings'}" class="button button-primary button-small">${settings.configured ? '去简历编辑器润色' : '连接 AI 服务'} ${icon('arrow')}</a>`) + `<div class="info-strip">${icon('ai')}<p>${settings.configured ? 'AI 服务已配置。' : 'AI 服务尚未配置。'} 在简历编辑器中选择一段真实经历并同意发送后，才会生成建议。建议只是提案，采纳前不改简历。所有报告关联生成时的简历版本。</p></div><div class="ai-report-list">${reports.length ? reports.map(r => `<article class="panel report-card"><div class="panel-heading"><h2>${e(r.field_path === 'basics.summary' ? '个人简介润色' : r.field_path === 'skills' ? '专业技能润色' : '经历表达润色')} <span>V${r.resume_revision}</span></h2><span class="badge ${r.applied_at ? 'badge-green' : 'badge-slate'}">${r.applied_at ? '已采纳' : '待参考'}</span></div><div class="report-excerpt"><div><small>原文</small><p>${e(r.original.slice(0, 180))}</p></div><div><small>润色建议</small><p>${e(r.revised.slice(0, 240))}</p></div></div>${r.match ? `<div style="display:flex;gap:12px;align-items:center;padding-top:10px;font-size:12px;opacity:.72"><span style="font-weight:500">匹配度 ${r.match.score}</span><span>已具备 ${r.match.matched.length} 项 · 尚缺 ${r.match.missing.length} 项</span></div>` : ''}<div class="report-footer"><span>${e(r.model)} · ${time(r.created_at)}</span><button class="text-link" data-action="report-detail" data-id="${r.id}">查看完整对比 →</button></div></article>`).join('') : emptyState('还没有润色记录', '先创建简历，写下一段真实经历，再让 AI 帮你整理表达。', '<a class="button button-primary" href="#/resumes">去写简历</a>')}</div>`;
}
async function settingsPage() {
  if (!state.user) return loginEmpty('settings');
  const [config, storage] = await Promise.all([api('/settings/ai'), api('/storage')]);
  const serverKeyNote = config.serverKeyPolicy === 'allowlist'
    ? '服务器密钥只给 OFFERBIU_SERVER_KEY_EMAILS 中的邮箱使用。'
    : config.serverKeyPolicy === 'personal-only'
      ? '当前按公网或非本机地址运行，服务器密钥不会自动套用，请填写个人密钥。'
      : '当前只在本机监听，且未设置允许名单：本机账号可以继续使用服务器密钥。若要限制账号，设置 OFFERBIU_SERVER_KEY_EMAILS。';
  return pageHeading('settings') + `<div class="settings-layout"><section class="panel settings-panel"><div class="panel-heading"><h2>${icon('ai')} AI 接入</h2><span class="badge ${config.configured ? 'badge-green' : 'badge-slate'}">${config.configured ? '已配置' : '待配置'}</span></div><p class="settings-description">使用你自己的 AI 服务账户。密钥由后端加密保存，不会回显到浏览器；保存后可点「测试连接」确认密钥可用，再去简历编辑器润色。</p><form id="ai-settings-form"><label class="field"><span>服务商</span><select name="provider" id="ai-provider">${config.providers.map(item => `<option value="${item.key}" ${config.provider === item.key ? 'selected' : ''}>${e(item.label)}</option>`).join('')}</select></label><label class="field" id="ai-baseurl-field"${config.provider === 'custom' ? '' : ' hidden'}><span>接口地址（OpenAI 兼容，须 https）</span><input name="baseUrl" type="url" maxlength="300" placeholder="https://your-endpoint.example.com/v1" value="${e(config.baseUrl)}"></label><label class="field"><span>API 密钥${config.source === 'personal' ? '（已保存，留空则不修改）' : ''}</span><input name="apiKey" type="password" autocomplete="new-password" maxlength="500" placeholder="在这里填写 API 密钥"></label><label class="field" id="ai-model-pick"${config.provider === 'custom' ? ' hidden' : ''}><span>模型</span><select name="model">${config.models.map(model => `<option value="${model}" ${config.model === model ? 'selected' : ''}>${model === 'deepseek-flash' ? 'DeepSeek Flash · 日常润色' : 'DeepSeek V4 Pro · 深入优化'}</option>`).join('')}</select></label><label class="field" id="ai-model-free"${config.provider === 'custom' ? '' : ' hidden'}><span>模型名称</span><input name="modelCustom" maxlength="80" placeholder="例如 gpt-4o-mini" value="${config.provider === 'custom' ? e(config.model) : ''}"></label><p class="form-error" role="alert"></p><div class="button-row"><button class="button button-primary button-small" type="submit">保存配置</button><button class="button button-soft button-small" id="test-ai-key" type="button">测试连接</button>${config.source === 'personal' ? '<button class="button button-soft button-small" id="remove-ai-key" type="button">移除个人密钥</button>' : ''}${config.providers.find(item => item.key === config.provider)?.keyUrl ? `<a href="${config.providers.find(item => item.key === config.provider).keyUrl}" target="_blank" rel="noopener noreferrer" class="text-link">前往服务商平台 ↗</a>` : ''}</div><p class="field-note">当前来源：${config.source === 'personal' ? '个人配置' : config.source === 'server' ? '服务器环境配置' : '尚未配置'}。${serverKeyNote} 保存只会写入本地配置；「测试连接」会向服务商发起一次轻量请求以验证密钥。自定义接口地址不得指向本机或内网。</p></form></section><div><section class="panel settings-panel"><div class="panel-heading"><h2>我的账号</h2></div><div class="profile-summary"><span class="user-avatar">${e(state.user.name.slice(0, 1))}</span><div><strong>${e(state.user.name)}</strong><small>${e(state.user.email)}</small></div></div><form id="password-form"><label class="field"><span>当前密码</span><input name="currentPassword" type="password" autocomplete="current-password" required minlength="1" maxlength="128"></label><label class="field"><span>新密码</span><input name="newPassword" type="password" autocomplete="new-password" required minlength="8" maxlength="128"></label><p class="form-error" data-password-error role="alert"></p><div class="button-row"><button class="button button-primary button-small" type="submit">修改密码</button><button class="button button-soft button-small" data-action="logout" type="button">${icon('logout')} 退出登录</button></div><p class="field-note">修改密码后，其他浏览器里的登录会退出。本页会使用新的会话。</p></form><form id="delete-account-form"><h3>删除账号</h3><p class="field-note">删除后，这个账号下的简历、投递、底稿、评估和材料会从这台电脑的数据库移除，且不能自动恢复。岗位库本身不会删除。</p><label class="field"><span>输入当前邮箱确认</span><input name="email" type="email" autocomplete="off" required maxlength="254" placeholder="${e(state.user.email)}"></label><label class="field"><span>当前密码</span><input name="password" type="password" autocomplete="current-password" required minlength="1" maxlength="128"></label><label class="consent"><input name="confirm" type="checkbox" required><span>我确认删除账号 ${e(state.user.email)}</span></label><p class="form-error" data-delete-error role="alert"></p><button class="button button-soft button-small danger-link" type="submit">删除这个账号</button></form></section><section class="panel settings-panel"><div class="panel-heading"><h2>数据与备份</h2></div><p class="settings-description">私人岗位、简历和投递保存在运行服务的这台电脑上。导出 JSON 不含密码和 API 密钥。完整备份要同时复制数据库 <code>offerbiu.sqlite</code> 与加密密钥 <code>.encryption-key</code>，否则已保存的个人密钥无法解密。</p><p class="field-note">${storage.external ? '当前使用环境变量指定的数据目录。' : '当前使用项目下的 storage 目录。'}${storage.revealPath && storage.directory ? ' 目录：' + e(storage.directory) : ''}</p><p class="field-note">换目录时先停止服务，执行 <code>${e(storage.copyCommand)}</code>。它只复制、不删除。确认新目录能登录后，再设置 OFFERBIU_STORAGE 并重启。要还原，把变量改回原目录。</p><button class="button button-soft button-small" data-action="export-data">${icon('download')} 导出我的 JSON 数据</button></section></div></div><section class="panel source-panel"><div class="panel-heading"><h2>岗位数据说明</h2></div><p>本批 ${state.meta.jobs.count} 条，来源：${state.meta.companies.map(c => `${e(c.company)} ${c.count} 条`).join('、')}。采集于 ${date(state.meta.jobs.collected_at)}。</p><p>${e(state.meta.jobs.limitations)}</p><p>点击条目可查看企业官网或西北大学岗位页、2027 届依据和原始发布日期。当前不会自动刷新外部招聘状态。</p></section>`;
}

async function renderRoute() {
  // Navigation closes the editor explicitly; background refreshes keep the current draft.
  if (state.editor) return;
  if (state.workflow?.isDirty?.()) return;
  state.workflow?.destroy(); state.workflow = null;
  state.pageController?.abort(); state.pageController = new AbortController();
  const [routePath, routeQuery = ''] = location.hash.replace(/^#\/?/, '').split('?');
  const routeParts = routePath.split('/'); const route = routeParts[0] || 'overview';
  const workflowQuery = new URLSearchParams(routeQuery);
  const currentNavigation = ++state.navigation;
  state.currentHash = location.hash || '#/overview';
  state.route = route; renderNav(); document.getElementById('page-breadcrumb').textContent = ['resume','studio'].includes(route) ? '简历工作室' : route === 'materials' ? '申请材料与投递留档' : ['evaluate','evaluation'].includes(route) ? '岗位评估' : navigation.find(([key]) => key === route)?.[1] || '总览';
  document.title = document.getElementById('page-breadcrumb').textContent + ' · Offerbiu';
  main.innerHTML = loading();
  try {
    if (['private-jobs', 'profile', 'evaluations', 'evaluate', 'evaluation', 'materials'].includes(route)) {
      if (!state.user) { main.innerHTML = loginEmpty(route === 'materials' ? 'materials' : route === 'profile' ? 'profile' : 'evaluations'); return; }
      const context = { signal: state.pageController.signal, isCurrent: () => currentNavigation === state.navigation };
      const mounted = route === 'private-jobs' ? await mountPrivateJobs(main, { ...context, id: routeParts[1] || '', selectedJobs: state.selectedJobs }) : route === 'profile' ? await mountProfile(main, context) : route === 'materials' ? await mountApplicationMaterials(main, { ...context, applicationId: routeParts[1] || '', evaluationId: workflowQuery.get('evaluation') || '' }) : await mountEvaluations(main, { ...context, mode: route === 'evaluate' ? 'single' : route === 'evaluation' ? 'detail' : 'list', id: routeParts[1] || '', selectedJobs: state.selectedJobs });
      if (currentNavigation !== state.navigation) { mounted?.destroy(); return; }
      state.workflow = mounted; main.focus({ preventScroll: true }); return;
    }
    if (route === 'studio') {
      const template = templates.some(t => t.id === routeParts[1]) ? routeParts[1] : 'classic';
      const draftKey = 'offerbiu:studio:' + (state.user?.id || 'guest') + ':' + template;
      let initial = { id:'local',title:'我的校招简历',template,data:blankResume(),revision:0 };
      try {
        let raw = localStorage.getItem(draftKey);
        if (!raw) {
          raw = sessionStorage.getItem(draftKey);
          if (raw) { try { localStorage.setItem(draftKey, raw); sessionStorage.removeItem(draftKey); } catch {} }
        }
        const cached = raw ? JSON.parse(raw) : null;
        if (cached?.data?.basics && ['education','experience','projects'].every(k => Array.isArray(cached.data[k]))) initial = {...initial,...cached,id:'local',revision:0};
      } catch {}
      state.editor = mountEditor(main,initial,()=>{}, {local:true,draftKey,onSaveAccount:saveStudioToAccount}); return;
    }
    if (route === 'resume') {
      if (!state.user) { main.innerHTML = loginEmpty('resumes'); return; }
      const resume = await api('/resumes/' + encodeURIComponent(routeParts[1] || ''), { signal: state.pageController.signal });
      if (currentNavigation !== state.navigation) return;
      state.editor = mountEditor(main, resume, undefined, { draftKey: accountDraftKey(state.user.id, resume.id) }); return;
    }
    const renderers = { overview: overviewPage, jobs: jobsPage, applications: applicationsPage, resumes: resumesPage, templates: templatesPage, calendar: calendarPage, ai: aiPage, settings: settingsPage };
    const content = await (renderers[route] || overviewPage)();
    if (currentNavigation !== state.navigation) return;
    main.innerHTML = content; wirePage();
    main.focus({ preventScroll: true });
  } catch (err) {
    if (currentNavigation !== state.navigation || err.name === 'AbortError') return;
    main.innerHTML = emptyState('暂时没有加载成功', err.message, '<button class="button button-primary button-small" data-action="retry">重新加载</button>');
    main.focus({ preventScroll: true });
  }
}
function wirePage() {
  const filters = document.getElementById('job-filters');
  if (filters) {
    updateJobReader(state.displayedJobs.find(job => job.id === state.activeJobId));
    filters.addEventListener('submit', event => {
      event.preventDefault();
      state.jobs = { ...Object.fromEntries(new FormData(filters)), page: 1 };
      state.jobs.q = state.jobs.q.trim();
      handle(renderRoute());
    });
    filters.querySelectorAll('[data-primary-filter]').forEach(select => select.addEventListener('change', () => filters.requestSubmit()));
  }
  const aiForm = document.getElementById('ai-settings-form');
  const aiPayload = () => {
    const values = Object.fromEntries(new FormData(aiForm));
    const provider = values.provider === 'custom' ? 'custom' : 'deepseek';
    return { provider, apiKey: values.apiKey, baseUrl: values.baseUrl || '', model: provider === 'custom' ? values.modelCustom : values.model };
  };
  aiForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const btn = aiForm.querySelector('[type=submit]');
    btn.disabled = true;
    aiForm.querySelector('.form-error').textContent = '';
    try {
      const payload = aiPayload();
      await api('/settings/ai', { method: 'PUT', data: payload });
      aiForm.elements.apiKey.value = '';
      if (payload.apiKey) {
        try {
          await api('/settings/ai/test', { method: 'POST', data: { provider: payload.provider, baseUrl: payload.baseUrl, model: payload.model } });
          toast('配置已保存，连接测试通过。');
        } catch (err) {
          toast('配置已保存，但连接测试失败：' + err.message, true);
        }
      } else toast('配置已保存。可点「测试连接」验证密钥。');
      await renderRoute();
    } catch (err) { aiForm.querySelector('.form-error').textContent = err.message; btn.disabled = false; }
  });
  document.getElementById('test-ai-key')?.addEventListener('click', async () => {
    const btn = document.getElementById('test-ai-key');
    btn.disabled = true;
    aiForm.querySelector('.form-error').textContent = '';
    try {
      const payload = aiPayload();
      await api('/settings/ai/test', { method: 'POST', data: payload });
      toast('连接测试通过，可以去简历编辑器润色了。');
    } catch (err) { aiForm.querySelector('.form-error').textContent = err.message; toast(err.message, true); }
    finally { btn.disabled = false; }
  });
  const providerSelect = document.getElementById('ai-provider');
  providerSelect?.addEventListener('change', () => { const custom = providerSelect.value === 'custom'; document.getElementById('ai-baseurl-field').hidden = !custom; document.getElementById('ai-model-pick').hidden = custom; document.getElementById('ai-model-free').hidden = !custom; });
  document.getElementById('remove-ai-key')?.addEventListener('click', async () => { if (!confirm('移除保存在本机的个人 API 密钥？')) return; try { await api('/settings/ai', { method: 'PUT', data: { provider: aiForm.elements.provider.value, baseUrl: aiForm.elements.baseUrl.value, model: aiForm.elements.provider.value === 'custom' ? aiForm.elements.modelCustom.value : aiForm.elements.model.value, removeKey: true } }); await renderRoute(); toast('个人密钥已移除。'); } catch (err) { errorMessage(err); } });
  const passwordForm = document.getElementById('password-form');
  passwordForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const error = passwordForm.querySelector('[data-password-error]');
    const button = passwordForm.querySelector('[type=submit]');
    error.textContent = '';
    button.disabled = true;
    try {
      const result = await api('/auth/password', { method: 'POST', data: { currentPassword: passwordForm.elements.currentPassword.value, newPassword: passwordForm.elements.newPassword.value } });
      setCsrf(result.csrf);
      passwordForm.reset();
      toast('密码已更新，其他设备上的登录已退出。');
    } catch (err) { error.textContent = err.message; }
    finally { button.disabled = false; }
  });
  const deleteAccountForm = document.getElementById('delete-account-form');
  deleteAccountForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const error = deleteAccountForm.querySelector('[data-delete-error]');
    const button = deleteAccountForm.querySelector('[type=submit]');
    error.textContent = '';
    if (!confirm('删除账号后，该账号的简历、投递和评估会从本机数据库移除。确定继续？')) return;
    button.disabled = true;
    try {
      await api('/auth/account', { method: 'DELETE', data: { email: deleteAccountForm.elements.email.value, password: deleteAccountForm.elements.password.value, confirm: deleteAccountForm.elements.confirm.checked } });
      setCsrf(null);
      state.user = null;
      toast('账号已删除。');
      location.hash = '/overview';
      await renderRoute();
    } catch (err) { error.textContent = err.message; button.disabled = false; }
  });
  document.getElementById('resume-import')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { if (file.size > RESUME_FILE_LIMIT) throw new Error('含图片的简历 JSON 需小于 2 MB。'); const data = JSON.parse(await file.text()); if (!data.data?.basics || !data.title) throw new Error('请选择从本项目导出的简历 JSON 文件。'); const r = await api('/resumes', { method: 'POST', data: { title: data.title + ' · 导入', template: data.template, data: data.data } }); location.hash = '/resume/' + r.id; toast('简历内容已导入。'); } catch (err) { errorMessage(err); }
  });
}

async function selectedApplications() {
  const chosen = state.applications.filter(a => state.selectedApplications.has(a.id));
  if (!chosen.length) throw new Error('请先选择要处理的投递记录。');
  return chosen;
}
function batchStatusDialog() {
  return dialog('批量修改投递状态', `<p class="modal-description">将选中的 ${state.selectedApplications.size} 条记录改为同一状态。已下架的历史记录也可以改，状态会照常保存。</p><form id="batch-form"><div class="form-grid"><label class="field"><span>新状态</span><select name="status">${statusOptions('applied')}</select></label></div><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button button-soft" data-close-dialog>取消</button><button class="button button-primary" type="submit">保存状态 ${icon('check')}</button></div></form>`, el => {
    el.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type=submit]');
      const status = new FormData(form).get('status');
      button.disabled = true;
      try {
        const result = await api('/applications/batch', { method: 'POST', data: { op: 'status', status, ids: [...state.selectedApplications] } });
        el.close(); state.selectedApplications.clear(); await renderRoute();
        toast(`已把 ${result.updated} 条记录改为「${statuses.find(s => s.id === status)?.label}」。`);
      } catch (err) { form.querySelector('.form-error').textContent = err.message; button.disabled = false; }
    });
  });
}
function batchTaskDialog() {
  const count = state.selectedApplications.size;
  return dialog('批量安排待办', `<p class="modal-description">为选中的 ${count} 条机会各建一条待办，方便按时间跟进。${count > 1 ? '标题留空时按公司名自动命名。' : ''}</p><form id="batch-task-form"><div class="form-grid"><label class="field"><span>待办标题</span><input name="title" maxlength="200" placeholder="${count > 1 ? '留空则按公司自动命名' : '例如：投递截止前检查材料'}"></label><label class="field"><span>类型</span><select name="kind">${['跟进', '笔试', '面试', '截止', '其他'].map(k => `<option value="${k}">${k}</option>`).join('')}</select></label><label class="field field-wide"><span>时间</span><input type="datetime-local" name="dueAt"></label><label class="field field-wide"><span>备注</span><textarea name="notes" rows="3" maxlength="3000" placeholder="选填，例如需要准备的材料。"></textarea></label></div><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button button-soft" data-close-dialog>取消</button><button class="button button-primary" type="submit">创建待办 ${icon('check')}</button></div></form>`, el => {
    el.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const button = form.querySelector('[type=submit]');
      const values = Object.fromEntries(new FormData(form));
      button.disabled = true;
      try {
        const result = await api('/applications/batch', { method: 'POST', data: { ...values, op: 'task', ids: [...state.selectedApplications] } });
        el.close(); state.selectedApplications.clear(); await renderRoute();
        toast(`已创建 ${result.created} 条待办，可在「日程与待办」查看。`);
      } catch (err) { form.querySelector('.form-error').textContent = err.message; button.disabled = false; }
    });
  });
}
function batchRemoveDialog() {
  const count = state.selectedApplications.size;
  return dialog('移出投递清单', `<p class="modal-description">将删除选中的 ${count} 条投递记录及其简历快照、进展日志，此操作不可恢复。关联待办会保留。</p><p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="button button-soft" data-close-dialog>取消</button><button type="button" class="button button-primary danger-link" id="confirm-batch-remove">确认删除 ${count} 条</button></div>`, el => {
    el.querySelector('#confirm-batch-remove').addEventListener('click', async event => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await api('/applications/batch', { method: 'POST', data: { op: 'remove', ids: [...state.selectedApplications] } });
        el.close(); state.selectedApplications.clear(); await renderRoute();
        toast(`已移出 ${result.removed} 条记录。`);
      } catch (err) { el.querySelector('.form-error').textContent = err.message; button.disabled = false; }
    });
  });
}
async function changeApplicationStatus(select) {
  const id = select.dataset.id, status = select.value;
  const current = state.applications.find(a => a.id === id);
  if (!current || current.status === status) return;
  const previous = current.status;
  select.disabled = true;
  try {
    const updated = await api('/applications/' + id, { method: 'PATCH', data: { status } });
    current.status = updated.status;
    current.updated_at = updated.updated_at;
    const row = main.querySelector(`[data-row="${id}"]`);
    const stillVisible = state.appFilter === 'all' || state.appFilter === status;
    if (row && stillVisible) {
      row.outerHTML = applicationRow(current, true);
      const fresh = main.querySelector(`[data-row="${id}"]`);
      fresh?.querySelector('select')?.focus({ preventScroll: true });
    } else if (row) row.remove();
    document.querySelectorAll('.status-filters button').forEach(button => {
      const key = button.dataset.status;
      const count = key === 'all' ? state.applications.length : state.applications.filter(a => a.status === key).length;
      const badge = button.querySelector('span');
      if (badge) badge.textContent = count;
    });
    toast(`已更新为「${statuses.find(s => s.id === status)?.label}」（原为「${statuses.find(s => s.id === previous)?.label}」）。`);
  } catch (err) { select.value = previous; select.disabled = false; throw err; }
}
async function action(button) {
  const kind = button.dataset.action, key = button.dataset.id;
  if (kind === 'auth') return showAuth('register');
  if (kind === 'retry') return renderRoute();
  if (kind === 'job-detail') return showJob(key);
  if (kind === 'save-job') return requireUser(() => handle(saveJob(key, button)));
  if (kind === 'edit-application') return editApplication(key, button);
  if (kind === 'pick-job') {
    if (state.selectedJobs.has(key)) state.selectedJobs.delete(key);
    else {
      if (state.selectedJobs.size >= 10) { button.checked = false; toast('每批最多选择 10 个岗位，请先取消一项。', true); return; }
      const job = state.displayedJobs.find(j => j.id === key); if (job) state.selectedJobs.set(key, job);
    }
    return updateJobSelection();
  }
  if (kind === 'clear-job-selection') { state.selectedJobs.clear(); return updateJobSelection(); }
  if (kind === 'reset-jobs') { state.jobs = emptyJobFilters(); return renderRoute(); }
  if (kind === 'job-facet') {
    const draft = Object.fromEntries(new FormData(document.getElementById('job-filters')));
    state.jobs = { ...draft, [button.dataset.field]: '', page: 1 };
    state.jobs.q = state.jobs.q.trim();
    return renderRoute();
  }
  if (kind === 'job-page') { state.jobs.page = Number(button.dataset.page); await renderRoute(); main.scrollIntoView({ block: 'start' }); return; }
  if (kind === 'app-filter') { state.appFilter = button.dataset.status; return renderRoute(); }
  if (kind === 'pick-application') {
    if (state.selectedApplications.has(key)) state.selectedApplications.delete(key); else state.selectedApplications.add(key);
    return renderRoute();
  }
  if (kind === 'pick-all-applications') {
    const rows = state.applications.filter(a => state.appFilter === 'all' || a.status === state.appFilter);
    const allPicked = rows.length > 0 && rows.every(a => state.selectedApplications.has(a.id));
    for (const a of rows) { if (allPicked) state.selectedApplications.delete(a.id); else state.selectedApplications.add(a.id); }
    return renderRoute();
  }
  if (kind === 'clear-selection') { state.selectedApplications.clear(); return renderRoute(); }
  if (kind === 'batch-status') return batchStatusDialog();
  if (kind === 'batch-task') return batchTaskDialog();
  if (kind === 'batch-remove') return batchRemoveDialog();
  if (kind === 'new-resume') return createResume(button.dataset.template || 'classic');
  if (kind === 'import-resume') return document.getElementById('resume-import').click();
  if (kind === 'clone-resume') { const old = await api('/resumes/' + key); const copy = await api('/resumes', { method: 'POST', data: { title: old.title + ' · 副本', template: old.template, data: old.data } }); location.hash = '/resume/' + copy.id; return; }
  if (kind === 'delete-resume') {
    if (!confirm('删除这份简历、版本历史和本机草稿？此操作不可恢复。已绑定投递中的简历快照会保留。')) return;
    const draftKey = accountDraftKey(state.user.id, key);
    await api('/resumes/' + key, { method: 'DELETE' });
    try { localStorage.removeItem(draftKey); } catch {}
    toast('已删除简历。'); return renderRoute();
  }
  if (kind === 'new-task') return showTask();
  if (kind === 'toggle-task') { await api('/tasks/' + key, { method: 'PUT', data: { completed: button.dataset.completed !== '1' } }); return renderRoute(); }
  if (kind === 'delete-task') { if (!confirm('删除这条待办？')) return; await api('/tasks/' + key, { method: 'DELETE' }); return renderRoute(); }
  if (kind === 'calendar-month') { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + Number(button.dataset.delta), 1); state.selectedDay = ''; return renderRoute(); }
  if (kind === 'calendar-today') { const d = new Date(); state.calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1); state.selectedDay = dayKey(d); return renderRoute(); }
  if (kind === 'select-day') { state.selectedDay = button.dataset.day; return renderRoute(); }
  if (kind === 'clear-day') { state.selectedDay = ''; return renderRoute(); }
  if (kind === 'logout') { await api('/auth/logout', { method: 'POST' }); state.user = null; setCsrf(null); setAccount(); state.editor?.destroy(); state.editor = null; state.workflow?.destroy(); state.workflow = null; state.selectedJobs.clear(); location.hash = '/overview'; await renderRoute(); return; }
  if (kind === 'export-data') { const data = await api('/export'); return downloadJson(data, 'Offerbiu-我的秋招备份.json'); }
  if (kind === 'report-detail') {
    const report = state.reports.find(r => r.id === key); if (!report) return;
    return dialog('润色前后对比', `<div class="polish-comparison"><section><h3>原文 · V${report.resume_revision}</h3><p>${e(report.original)}</p></section><section class="revised-text"><h3>润色建议</h3><p>${e(report.revised)}</p></section></div><div class="ai-reasons"><h3>修改理由</h3><ul>${report.changes.map(s => `<li>${e(s)}</li>`).join('')}</ul>${report.questions.length ? `<h3>待补充的事实</h3><ul>${report.questions.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>${polishDiagnosisMarkup(report)}${report.match ? `<div class="ai-reasons"><h3>岗位匹配分析 · ${report.match.score} 分</h3>${report.match.advice ? `<p>${e(report.match.advice)}</p>` : ''}${report.match.matched.length ? `<h3>简历已具备</h3><ul>${report.match.matched.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}${report.match.missing.length ? `<h3>岗位要求但尚未体现</h3><ul>${report.match.missing.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>` : ''}<div class="modal-actions"><button class="button button-soft" id="copy-report">复制建议</button>${report.resume_id ? `<a href="#/resume/${report.resume_id}" class="button button-primary" id="open-report-resume">回到简历编辑</a>` : '<span class="muted">原简历已删除，报告仍保留</span>'}</div>`, el => { el.querySelector('#copy-report').addEventListener('click', async () => { try { await navigator.clipboard.writeText(report.revised); toast('已复制建议。'); } catch { toast('请手动选中文字复制。', true); } }); el.querySelector('#open-report-resume')?.addEventListener('click', () => el.close()); }, 'modal-wide');
  }
}
function updateJobSelection() {
  main.querySelectorAll('[data-action=pick-job],[data-private=select]').forEach(input => { input.checked = state.selectedJobs.has(input.dataset.id); });
  const toolbar = main.querySelector('.wf-selection-bar'); if (toolbar) toolbar.outerHTML = evaluationSelectionMarkup(state.selectedJobs);
}
main.addEventListener('click', event => { if (event.target.closest('[data-selected-evaluate][aria-disabled=true]')) { event.preventDefault(); toast('请先勾选要评估的岗位。'); return; } const button = event.target.closest('[data-action]'); if (button && !button.disabled) handle(action(button)); });
// Selects do not fire click, so the status control gets its own delegated listener.
main.addEventListener('change', event => {
  const select = event.target.closest('[data-action="app-status"]');
  if (select && !select.disabled) handle(changeApplicationStatus(select));
});
document.getElementById('header-action').addEventListener('click', () => handle(showTask()));
document.getElementById('account-button').addEventListener('click', () => { if (!state.user) showAuth('login'); else location.hash = '/settings'; });
const sidebar = document.getElementById('sidebar'), scrim = document.getElementById('mobile-scrim'), menu = document.getElementById('sidebar-toggle');
function closeSidebar() { sidebar.classList.remove('is-open'); scrim.hidden = true; menu.setAttribute('aria-expanded', 'false'); }
menu.addEventListener('click', () => { const open = !sidebar.classList.contains('is-open'); sidebar.classList.toggle('is-open', open); scrim.hidden = !open; menu.setAttribute('aria-expanded', String(open)); });
scrim.addEventListener('click', closeSidebar);
document.getElementById('side-nav').addEventListener('click', event => { if (event.target.closest('a')) closeSidebar(); });
wideJobs.addEventListener('change', event => {
  if (event.matches && state.route === 'jobs') updateJobReader(state.displayedJobs.find(job => job.id === state.activeJobId));
});
window.addEventListener('hashchange', () => {
  if (state.editor?.dirty && !confirm('简历有未保存修改，确定离开？也可以先保存或导出 JSON。')) { history.replaceState(null, '', '#' + state.editor.route); return; }
  if (state.workflow?.isDirty?.() && !confirm('当前底稿或材料有未保存修改，确定离开？')) { history.replaceState(null, '', state.currentHash); return; }
  state.editor?.destroy(); state.editor = null; state.workflow?.destroy(); state.workflow = null;
  const modal = document.getElementById('app-dialog'); if (modal.open) modal.close();
  handle(renderRoute());
});
window.addEventListener('beforeunload', event => { if (state.editor?.dirty || state.workflow?.isDirty?.()) { event.preventDefault(); event.returnValue = ''; } });
document.getElementById('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

try {
  const [session, meta] = await Promise.all([api('/session'), api('/meta')]); state.user = session.user; state.meta = meta; setCsrf(session.csrf); setAccount(); await renderRoute();
} catch (err) { main.innerHTML = emptyState('工作台尚未连接', err.message, '<p class="data-note">请使用项目的“启动工作台”入口。单独打开 HTML 无法连接数据库。</p>'); }
