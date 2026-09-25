import { api, setCsrf } from './api.js';
import { initDelight } from './delight.js';
import { escape as e, icon, date, time, localDateInput, companyLogo, emptyState, toast, loading, dialog, downloadJson, statusBadge, safeUrl } from './ui.js';
import { mountEditor } from './editor.js';
import { resumeMarkup } from './resume-renderer.js';
import { RESUME_FILE_LIMIT } from '/shared/resume-media.mjs';
import { templates, statuses, blankResume, resumeText, sampleResume } from '/shared/templates.mjs';

const main = document.getElementById('workspace-content');
initDelight(main);
const emptyJobFilters = () => ({ q: '', company: '', company_nature: '', city: '', category: '', industry: '', record_type: 'job', source_type: '', base_scope: '', batch: '', sort: 'recent', page: 1 });
const state = { user: null, meta: null, route: 'overview', editor: null, navigation: 0, jobs: emptyJobFilters(), applications: [], resumes: [], tasks: [], calendarMonth: new Date(new Date().getFullYear(), new Date().getMonth(), 1), selectedDay: '', appFilter: 'all' };
const navigation = [['overview', '总览'], ['jobs', '校招岗位库'], ['applications', '我的投递'], ['resumes', '简历中心'], ['templates', '模板与工作室'], ['calendar', '日程与待办'], ['ai', 'AI 润色记录'], ['settings', '个人设置']];
const pageHeaders = { overview: ['把今天，安排明白。', '机会、准备和进展，在一个地方继续。'], jobs: ['下一份机会，从这里发现。', '企业官网与西北大学的 2027 届具体岗位，直接前往对应投递页。'], applications: ['每个机会，都有进展。', '记下投递状态、使用的简历版本，以及下一步。'], resumes: ['让好的经历，被看见。', '按目标岗位准备不同版本，修改与历史都有迹可循。'], templates: ['让经历，拥有好的版面。', '精选十一套可编辑版式，新增 ResumeCollection 模板与头像、作品配图。'], calendar: ['重要的事，提前安排。', '把截止、笔试、面试与跟进，放进自己的节奏里。'], ai: ['把经历，讲得更清楚。', '保留原文与润色建议，由你决定采纳。'], settings: ['让工作台，更适合你。', '连接 AI 服务，管理你的账号和数据。'] };
function pageHeading(key, action = '') { const [title, sub] = pageHeaders[key]; return `<div class="page-heading"><div><span class="page-kicker">YOUR NEXT CHAPTER / ${key.toUpperCase()}</span><h1>${title}</h1><p>${sub}</p></div>${action}</div>`; }
function errorMessage(error) { toast(error.message || '操作未完成。', true); }
function handle(promise) { Promise.resolve(promise).catch(errorMessage); }
function setAccount() {
  document.getElementById('user-name').textContent = state.user?.name || '访客浏览';
  document.getElementById('user-caption').textContent = state.user ? state.user.email : '登录以保存你的进展';
  document.getElementById('user-avatar').textContent = state.user?.name.slice(0, 1) || 'O';
}
function renderNav() {
  document.getElementById('side-nav').innerHTML = navigation.map(([key, label], index) => `${index === 3 ? '<span class="nav-group-label">简历与准备</span>' : index === 7 ? '<span class="nav-divider"></span>' : ''}<a href="#/${key}" class="nav-item ${state.route === key || (['resume','studio'].includes(state.route) && key === 'resumes') ? 'active' : ''}">${icon(key)}<span>${label}</span>${key === 'jobs' ? `<small>${state.meta?.jobs.count || 0}</small>` : key === 'ai' ? '<small class="nav-ai">AI</small>' : ''}</a>`).join('');
}
function requireUser(callback) { if (!state.user) { showAuth('register', callback); return false; } callback?.(); return true; }
function loginEmpty(key) { return pageHeading(key) + `<div class="welcome-panel"><span class="welcome-art">↗</span><div><span class="page-kicker">WELCOME TO YOUR WORKSPACE</span><h2>从一个机会，开始你的秋招。</h2><p>登录后，投递、简历和日程会保存到你的独立账号。你也可以先看看真实岗位。</p><div class="button-row"><button class="button button-primary" data-action="auth">创建我的工作台 ${icon('arrow')}</button><a href="#/jobs" class="button button-soft">先看看岗位</a></div></div></div><div class="intro-grid"><article>${icon('jobs')}<h3>${state.meta.jobs.count} 条校招信息</h3><p>届别、原始来源与采集时间可追溯。</p></article><article>${icon('resumes')}<h3>简历在线编辑</h3><p>十一套模板、图片上传与历史版本。</p></article><article>${icon('ai')}<h3>AI 润色</h3><p>围绕真实经历优化表达，由你采纳。</p></article></div>`; }

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
  const overdue = !task.completed && new Date(task.due_at) < new Date();
  return `<div class="task-item ${task.completed ? 'is-complete' : ''}"><button class="task-check ${task.completed ? 'checked' : ''}" data-action="toggle-task" data-id="${task.id}" data-completed="${task.completed}" aria-label="${task.completed ? '重新打开' : '完成'} ${e(task.title)}">${task.completed ? icon('check') : ''}</button><div class="task-item-body"><strong>${e(task.title)}</strong><small>${time(task.due_at)}${task.notes && !compact ? ' · ' + e(task.notes) : ''}</small></div><span class="badge ${overdue ? 'badge-red' : 'badge-slate'}">${overdue ? '待跟进' : e(task.kind)}</span>${!compact ? `<button class="icon-button" data-action="delete-task" data-id="${task.id}" aria-label="删除待办">${icon('trash')}</button>` : ''}</div>`;
}
async function overviewPage() {
  if (!state.user) return loginEmpty('overview');
  const d = await api('/dashboard'); state.applications = d.applications; state.tasks = d.tasks;
  const pending = d.tasks.filter(t => !t.completed).slice(0, 5);
  const recent = d.applications.slice(0, 4);
  const submitted = d.applications.filter(a => a.status !== 'saved').length;
  return pageHeading('overview') + `<section class="dashboard-banner"><div><span class="banner-eyebrow">${e(state.user.name)}，每一步都算数。</span><h2>${pending.length ? '今天，先从眼前的事开始。' : '给下一份期待，留一点准备。'}</h2><p>${d.total ? `你已收下 ${d.total} 个目标岗位，${d.counts.interview} 个正在面试。` : '先找到一个心仪岗位，再为它准备合适的简历。'}</p><a class="button button-primary button-small" href="#/jobs">寻找新机会 ${icon('arrow')}</a></div><div class="banner-decoration" aria-hidden="true"><span class="banner-ring"></span><span class="banner-arrow">↗</span><span class="banner-card">NEXT STEP<br><b>心中有数。</b></span></div></section><div class="stats-grid">${[['目标岗位', d.total, 'jobs', '已经加入投递清单'], ['已投递', submitted, 'applications', '包括笔试、面试和结果'], ['面试中', d.counts.interview, 'calendar', '保持准备，及时跟进'], ['已获 Offer', d.counts.offer, 'ai', '认真比较，做出选择']].map(([label, n, name, note]) => `<article class="stat-card"><div><span>${label}</span>${icon(name)}</div><strong>${String(n).padStart(2, '0')}</strong><small>${note}</small></article>`).join('')}</div><div class="dashboard-columns"><section class="panel"><div class="panel-heading"><h2>接下来的安排 <span>${d.pendingTasks}</span></h2><button class="text-link" data-action="new-task">添加待办 +</button></div>${pending.length ? pending.map(t => taskItem(t, true)).join('') : emptyState('暂时没有待办', '为笔面试或重要截止时间留一个位置。', '<button class="button button-soft button-small" data-action="new-task">添加第一个安排</button>')}</section><section class="panel"><div class="panel-heading"><h2>投递节奏</h2><a href="#/applications" class="text-link">查看全部 ↗</a></div><div class="pipeline-summary">${statuses.map(s => `<div><span><i class="status-dot dot-${s.color}"></i>${s.label}</span><div class="bar-track"><span class="bar-${s.color}" style="width:${d.total ? Math.max(d.counts[s.id] / d.total * 100, d.counts[s.id] ? 3 : 0) : 0}%"></span></div><b>${d.counts[s.id]}</b></div>`).join('')}</div><div class="resume-nudge">${icon('resumes')}<span>已保存 <strong>${d.resumeCount}</strong> 份简历</span><a class="text-link" href="#/resumes">去完善 →</a></div></section></div><section class="panel"><div class="panel-heading"><h2>最近推进的机会</h2><a href="#/jobs" class="text-link">逛逛岗位库 ↗</a></div>${recent.length ? recent.map(a => applicationRow(a)).join('') : emptyState('你的机会清单，从这里开始', '将岗位加入“我的投递”，就能记录进度与简历版本。', '<a class="button button-primary button-small" href="#/jobs">浏览真实岗位</a>')}</section>`;
}

function selectOptions(items, current) { return items.map(item => `<option value="${e(item)}" ${item === current ? 'selected' : ''}>${e(item)}</option>`).join(''); }
function sourceLabel(job) {
  return job.source_type === 'nwu_official' ? '西北大学' : job.source_type === 'employer_official' ? '企业官网' : '历史来源';
}
function typeLabel(job) { return job.source_type === 'nwu_official' ? '西大具体岗位' : '官网独立职位'; }
function baseLabel(job) { return job.base_scope === 'job' ? '岗位 Base' : 'Base 待公布'; }
function jobCard(j) {
  const cities = j.cities || [], campaign = j.record_type === 'campaign';
  const location = cities.slice(0, 3).join(' / ') + (cities.length > 3 ? ` 等 ${cities.length} 个地区` : '');
  return `<article class="job-card ${campaign ? 'campaign-card' : ''}">
    <div class="job-card-top">${companyLogo(j.company)}<div><strong>${e(j.company)}</strong><small>${e(j.industry || j.program)}</small></div><span class="official-tag">${sourceLabel(j)}</span></div>
    <div class="record-label"><span>${typeLabel(j)}</span><span>${e(j.batch || '校园招聘')} · 2027</span></div>
    <a class="job-title" href="${e(safeUrl(j.apply_url))}" target="_blank" rel="noopener noreferrer">${e(j.title)} ↗</a>
    ${j.employer_unit ? `<p class="job-employer-unit">招聘单位：${e(j.employer_unit)}</p>` : ''}
    <div class="job-base ${j.base_scope === 'campaign' ? 'base-campaign' : ''}" title="${e(cities.join(' / '))}">${icon('jobs')}<span><small>${baseLabel(j)}</small>${e(location || '简章未明确')}</span></div>
    <div class="job-tags">${j.company_nature && j.company_nature !== '其他／待核实' ? `<span class="nature-tag">${e(j.company_nature)}</span>` : ''}${(j.directions?.length ? j.directions : [j.category]).slice(0, 4).map(d => `<span>${e(d)}</span>`).join('')}${j.deadline ? `<span class="deadline-tag">${date(j.deadline)} 截止</span>` : ''}</div>
    <p class="job-excerpt">${e((j.description || j.requirements || '查看招聘详情。').replace(/\n/g, ' ').slice(0, 140))}</p>
    <div class="direct-job-actions"><a class="button button-primary button-small" href="${e(safeUrl(j.apply_url))}" target="_blank" rel="noopener noreferrer">${j.source_type === 'nwu_official' ? '去西大投递' : '去官网投递'} ${icon('link')}</a><button class="text-link" data-action="job-detail" data-id="${e(j.id)}">查看详情</button></div>
    <div class="job-card-footer"><span>${j.updated_at ? '更新 ' + date(j.updated_at) : j.published_at || j.published_at_raw ? '发布 ' + date(j.published_at || j.published_at_raw) : '采集 ' + date(j.collected_at)}</span><button class="button button-small button-soft" data-action="${j.application ? 'edit-application' : 'save-job'}" data-id="${e(j.application?.id || j.id)}">${j.application ? '已收藏 · 查看' : '收藏岗位 +'}</button></div>
  </article>`;
}
async function jobsPage() {
  const query = new URLSearchParams(Object.entries(state.jobs).filter(([, value]) => value));
  const data = await api('/jobs?' + query);
  const meta = state.meta.jobs, f = state.jobs;
  const featured = ['腾讯', '阿里巴巴', '字节跳动', '滴滴', '美团', '拼多多', '网易', '快手', '小红书', 'B站', '米哈游', '得物', '小米', 'OPPO', '华为', 'vivo', '影石', '中核集团', '中国银行', '中芯国际', '百度', '腾讯音乐', '金证科技'].map(name => state.meta.companies.find(c => c.company === name)).filter(Boolean);
  const active = [f.q && `搜索：${f.q}`, f.company, f.company_nature, f.industry, f.city && `Base：${f.city}`, f.category, f.batch, f.source_type && ({ employer_official: '企业官网', nwu_official: '西北大学' })[f.source_type], f.base_scope && ({ job: '岗位已明确地点', unspecified: '地点未公布' })[f.base_scope]].filter(Boolean);
  const select = (name, label, options) => `<label class="job-filter-field"><span>${label}</span><select name="${name}" aria-label="${label}"><option value="">全部${label}</option>${selectOptions(options, f[name])}</select></label>`;
  return pageHeading('jobs', `<span class="source-chip">${icon('clock')} ${date(meta.collected_at)} 数据整理</span>`) + `
    <section class="recruit-summary"><div><strong>${meta.company_count}</strong><span>家招聘单位</span></div><div><strong>${meta.job_count}</strong><span>条具体岗位</span></div><div><strong>${meta.employer_count}</strong><span>条企业官网岗位</span></div><div><strong>${meta.nwu_count}</strong><span>条西大岗位</span></div><p>把选择，看得更广一点。<small>企业官网 / 西北大学 · 每条直达岗位投递页</small></p></section>
    <div class="recruit-tabs" aria-label="岗位来源">${[['', '全部岗位', meta.count], ['employer_official', '企业官网', meta.employer_count], ['nwu_official', '西北大学', meta.nwu_count]].map(([value,label,count]) => `<button class="${f.source_type === value ? 'active' : ''}" aria-pressed="${f.source_type === value}" data-action="job-facet" data-field="source_type" data-value="${value}">${label}<span>${count}</span></button>`).join('')}</div>
    <section class="recruit-filters"><div class="industry-row"><span>行业</span><div><button class="filter-chip ${!f.industry ? 'active' : ''}" data-action="job-facet" data-field="industry" data-value="">全部</button>${state.meta.industries.map(i => `<button class="filter-chip ${f.industry === i.name ? 'active' : ''}" data-action="job-facet" data-field="industry" data-value="${e(i.name)}" aria-pressed="${f.industry === i.name}">${e(i.name)}<small>${i.count}</small></button>`).join('')}</div></div>
    <form id="job-filters" class="recruit-filter-form">
      <input type="hidden" name="record_type" value="job"><input type="hidden" name="source_type" value="${e(f.source_type)}"><input type="hidden" name="industry" value="${e(f.industry)}">
      <div class="recruit-search-row"><label class="search-field">${icon('search')}<input name="q" value="${e(f.q)}" placeholder="搜索公司、岗位、技能，例如：金证 / Java / 管培生" aria-label="搜索招聘信息"></label><button class="button button-primary button-small" type="submit">搜索机会 ${icon('arrow')}</button><button class="text-link" type="button" data-action="reset-jobs">清除筛选</button></div>
      <div class="recruit-selects">${select('company', '企业 / 集团', state.meta.companies.map(c => c.company))}${select('company_nature', '企业性质', state.meta.companyNatures || [])}${select('city', 'Base / 地区', state.meta.cities)}${select('category', '岗位方向', state.meta.categories)}${select('batch', '招聘批次', state.meta.batches)}
      <label class="job-filter-field"><span>地点精度</span><select name="base_scope"><option value="">全部地点口径</option><option value="job" ${f.base_scope === 'job' ? 'selected' : ''}>岗位已明确地点</option><option value="unspecified" ${f.base_scope === 'unspecified' ? 'selected' : ''}>地点尚未公布</option></select></label>
      <label class="job-filter-field"><span>排序</span><select name="sort">${[['recent','发布 / 更新优先'],['company','按招聘单位'],['deadline','截止时间优先']].map(([value,label]) => `<option value="${value}" ${f.sort === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div>
    </form><div class="company-shortcuts"><span>快速查找</span>${featured.map(c => `<button class="${f.company === c.company ? 'active' : ''}" data-action="job-facet" data-field="company" data-value="${e(c.company)}">${e(c.company)} <small>${c.count}</small> ↗</button>`).join('')}</div></section>
    <div class="list-meta recruit-list-meta"><span>找到 <strong>${data.total}</strong> 条信息${active.length ? ' · ' + active.map(e).join(' / ') : ''}</span><span>点击岗位名称或投递按钮，直达来源岗位页</span></div>
    <div class="job-grid">${data.items.map(jobCard).join('') || emptyState('没有匹配的招聘信息', '可以放宽 Base、行业或地点精度。未公布地点的信息不会猜测归入某个城市。', '<button class="button button-soft button-small" data-action="reset-jobs">清除筛选</button>')}</div>
    <div class="pagination"><span>第 ${data.page} / ${Math.max(1, data.pages)} 页</span><button class="button button-soft button-small" data-action="job-page" data-page="${data.page - 1}" ${data.page <= 1 ? 'disabled' : ''}>上一页</button><button class="button button-soft button-small" data-action="job-page" data-page="${data.page + 1}" ${data.page >= data.pages ? 'disabled' : ''}>下一页</button></div>
    <p class="data-note">${e(meta.limitations)} 多城市同一岗位不拆分计数。企业和校内页面可能要求登录；收藏仅保存到个人清单，不会向企业提交简历。</p>`;
}
async function showJob(jobId) {
  const j = await api('/jobs/' + encodeURIComponent(jobId));
  const source = safeUrl(j.source_url), evidence = safeUrl(j.cohort_evidence_url), apply = safeUrl(j.apply_url) || source;
  const campaign = j.record_type === 'campaign', cities = j.cities || [];
  const applyLabel = j.source_type === 'nwu_official' ? '去西大岗位页投递' : '去官网岗位页投递';
  dialog(j.title, `<div class="job-detail-brand">${companyLogo(j.company)}<div><strong>${e(j.company)}</strong><small>${e(j.industry)} · ${typeLabel(j)} · ${sourceLabel(j)}</small></div></div>
    <p class="detail-employer">${j.employer_unit ? `招聘单位：${e(j.employer_unit)} · ` : ''}${e(j.company_nature || '企业性质待核实')}${j.official_job_code ? ` · 岗位代码 ${e(j.official_job_code)}` : ''}</p>
    <div class="detail-base"><span>${baseLabel(j)}</span><strong>${e(cities.join(' / ') || '未公布')}</strong><p>${e(j.base_note || '')}</p></div>
    <div class="detail-facts">${[['招聘届别','2027 届'],['招聘批次',j.batch || j.program],['岗位方向',(j.directions || [j.category]).join(' / ')],['学历',j.education || '详见简章和岗位要求'],['薪资',j.salary || '未明确公布'],['截止日期',j.deadline ? date(j.deadline) : '未明确公布']].map(([k,v]) => `<div><span>${k}</span><strong>${e(v)}</strong></div>`).join('')}</div>
    <section class="job-description"><h3>${campaign ? '招聘计划' : j.listing_kind === 'notice_role' ? '岗位说明' : '工作职责'}</h3><p>${e(j.description || '请查看招聘详情。')}</p><h3>应聘要求</h3><p>${e(j.requirements || '请查看招聘简章或网申岗位。')}</p></section>
    <div class="provenance-box"><strong>来源：${e(j.source_name || sourceLabel(j))}</strong><p>${e(j.cohort_evidence)}</p><p>${e(j.notes)}</p><small>原始发布：${date(j.published_at || j.published_at_raw)} · 采集：${date(j.collected_at)}${j.external_id ? ' · 来源编号：' + e(j.external_id) : ' · 公告整理岗位（无独立官网编号）'}</small><div class="button-row">${source ? `<a href="${e(source)}" target="_blank" rel="noopener noreferrer" class="text-link">查看原始${campaign ? '招聘公告' : '岗位来源'} ↗</a>` : ''}${evidence && evidence !== source ? `<a href="${e(evidence)}" target="_blank" rel="noopener noreferrer" class="text-link">查看 2027 届依据 ↗</a>` : ''}</div></div>
    <div class="modal-actions">${apply ? `<a class="button button-soft" href="${e(apply)}" target="_blank" rel="noopener noreferrer">${applyLabel} ${icon('link')}</a>` : ''}<button class="button button-primary" id="detail-save">收藏到我的清单 ${icon('plus')}</button></div>`, el => el.querySelector('#detail-save').addEventListener('click', () => { requireUser(() => handle(saveJob(jobId))); }), 'modal-wide');
}
async function saveJob(jobId) { const result = await api('/applications', { method: 'POST', data: { jobId } }); toast(result.existing ? '这份机会已在投递清单中。' : '已收下这个机会。可在“我的投递”记录进展。'); document.getElementById('app-dialog').close(); await renderRoute(); }

function applicationRow(a) { return `<div class="application-row">${companyLogo(a.job.company)}<button class="application-title" data-action="edit-application" data-id="${a.id}"><strong>${e(a.job.title)}</strong><small>${e(a.job.company)} · ${e(a.job.cities.join(' / '))}${a.job.catalog_active === false ? ' · 已下架（历史记录）' : ''}</small></button>${statusBadge(a.status, statuses)}<span class="application-resume">${a.resume_title ? e(a.resume_title) + ' · V' + a.resume_revision : '尚未绑定简历'}</span><span class="application-next">${a.next_date ? time(a.next_date) : '下一步待安排'}</span><button class="icon-button" data-action="edit-application" data-id="${a.id}" aria-label="编辑投递">${icon('arrow')}</button></div>`; }
async function applicationsPage() {
  if (!state.user) return loginEmpty('applications');
  state.applications = await api('/applications');
  const rows = state.applications.filter(a => state.appFilter === 'all' || a.status === state.appFilter);
  return pageHeading('applications', '<a href="#/jobs" class="button button-primary button-small">发现新机会 +</a>') + `<div class="status-filters"><button class="${state.appFilter === 'all' ? 'active' : ''}" data-action="app-filter" data-status="all">全部 <span>${state.applications.length}</span></button>${statuses.map(s => `<button class="${state.appFilter === s.id ? 'active' : ''}" data-action="app-filter" data-status="${s.id}">${s.label} <span>${state.applications.filter(a => a.status === s.id).length}</span></button>`).join('')}</div><section class="panel application-list">${rows.length ? rows.map(applicationRow).join('') : emptyState('这里还没有投递记录', '从岗位库收下目标职位，再记录投递状态和简历版本。', '<a href="#/jobs" class="button button-primary button-small">去岗位库看看</a>')}</section><p class="data-note">“加入投递”是收藏到自己的清单，不会代你向企业提交申请。实际投递请前往官方渠道。</p>`;
}
async function editApplication(applicationId) {
  if (!requireUser(() => {})) return;
  const [apps, resumes] = await Promise.all([api('/applications'), api('/resumes')]); state.applications = apps;
  const a = apps.find(x => x.id === applicationId); if (!a) throw new Error('这条投递已不存在。');
  dialog('推进这份机会', `<div class="job-detail-brand">${companyLogo(a.job.company)}<div><strong>${e(a.job.title)}</strong><small>${e(a.job.company)}</small></div></div>${a.job.catalog_active === false ? '<p class="archived-job-note">此岗位已从当前岗位库下架（来源规则调整或投递页待核实）。这条收藏和原有进展仍为你保留。</p>' : ''}<form id="application-form"><div class="form-grid"><label class="field"><span>当前状态</span><select name="status">${statuses.map(s => `<option value="${s.id}" ${a.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}</select></label><label class="field"><span>使用的简历</span><select name="resumeId"><option value="">暂不绑定</option>${resumes.map(r => `<option value="${r.id}" ${r.id === a.resume_id ? 'selected' : ''}>${e(r.title)} · 当前 V${r.revision}</option>`).join('')}</select></label><label class="field"><span>实际投递时间</span><input type="datetime-local" name="appliedAt" value="${localDateInput(a.applied_at)}"></label><label class="field"><span>下次跟进时间</span><input type="datetime-local" name="nextDate" value="${localDateInput(a.next_date)}"></label><label class="field field-wide"><span>备注 / 面试记录</span><textarea name="notes" rows="5" maxlength="10000" placeholder="记录你关心的信息、沟通结果和下一步。">${e(a.notes)}</textarea></label></div>${a.resume_id ? `<label class="consent"><input name="refreshResumeSnapshot" type="checkbox"><span>更新为所选简历的最新版本快照（目前绑定 V${a.resume_revision}）</span></label>` : ''}<p class="form-error" role="alert"></p><div class="modal-actions"><button type="button" class="text-link danger-link" id="remove-application">移出清单</button><button type="button" class="button button-soft" id="application-task">安排待办</button><button class="button button-primary" type="submit">保存进展 ${icon('check')}</button></div></form>`, el => {
    if (a.has_resume_snapshot) {
      const snapshotButton = document.createElement('button');
      snapshotButton.type = 'button'; snapshotButton.className = 'text-link snapshot-link';
      snapshotButton.textContent = `查看当时绑定的简历内容 · V${a.resume_revision}`;
      el.querySelector('.job-detail-brand').after(snapshotButton);
      snapshotButton.addEventListener('click', async () => {
        try {
          const snapshot = await api('/applications/' + a.id + '/resume');
          dialog('投递时的简历内容 · V' + snapshot.revision, `<p class="modal-description">这是绑定岗位时保存的内容快照，不会随编辑器里的后续修改而改变。</p><pre class="snapshot-text">${e(resumeText(snapshot.data))}</pre><div class="modal-actions"><button class="button button-soft" id="download-snapshot">导出这份快照</button><button class="button button-primary" id="back-to-application">返回投递记录</button></div>`, modal => {
            modal.querySelector('#download-snapshot').addEventListener('click', () => downloadJson({ format: 'offerbiu-resume-v1', title: a.job.company + ' · 投递快照 V' + snapshot.revision, template: 'classic', data: snapshot.data }, '投递简历快照.json'));
            modal.querySelector('#back-to-application').addEventListener('click', () => handle(editApplication(a.id)));
          }, 'modal-wide');
        } catch (err) { errorMessage(err); }
      });
    }
    el.querySelector('#application-task').addEventListener('click', () => handle(showTask(a.id)));
    el.querySelector('#remove-application').addEventListener('click', async () => { if (!confirm('从清单移除这条记录？岗位仍保留在岗位库，关联待办会保留。')) return; try { await api('/applications/' + a.id, { method: 'DELETE' }); el.close(); await renderRoute(); toast('已移出清单。'); } catch (err) { errorMessage(err); } });
    el.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form)); const btn = form.querySelector('[type=submit]'); btn.disabled = true;
      try { await api('/applications/' + a.id, { method: 'PUT', data: { ...values, refreshResumeSnapshot: values.refreshResumeSnapshot === 'on' } }); el.close(); await renderRoute(); toast('进展已保存。'); } catch (err) { form.querySelector('.form-error').textContent = err.message; btn.disabled = false; }
    });
  });
}

function templateThumbnail(template) { return `<div class="template-paper" aria-hidden="true">${resumeMarkup(sampleResume(),template.id,false,{sample:true})}</div>`; }
function templatesPage() { return pageHeading('templates', '<a class="button button-primary button-small" href="#/studio/classic">打开简历工作室 →</a>') + `<div class="template-intro"><span>01 选一套版式</span><span>02 填写真实资料</span><span>03 编辑、润色与导出</span><small>预览中的内容为排版示例，开始编辑时使用空白草稿。</small></div><div class="template-grid studio-template-grid">${[...templates].sort((a,b)=>Number(!!b.collection)-Number(!!a.collection)).map(t => `<article class="template-card">${templateThumbnail(t)}<div><span class="template-tag">${t.collection ? "精选 "+t.number+" · " : ""}${e(t.tag)}</span><h2>${e(t.name)}</h2><p>${e(t.description)}</p><div class="template-source">${t.source ? `<a href="${t.source}" target="_blank" rel="noopener noreferrer">${t.collection ? "ResumeCollection · "+t.number : t.license+" · 开源原作"} ↗</a><a href="${t.licenseUrl || "/assets/resume-templates/"+t.id+"/LICENSE"}" target="_blank" rel="noopener noreferrer">许可</a>${t.reference ? `<a href="${t.reference}" target="_blank" rel="noopener noreferrer">原版预览</a>` : ""}` : '<span>Offerbiu 原创模板</span>'}</div><a class="button button-primary button-small" href="#/studio/${t.id}">使用模板 · 在线编辑 ${icon('arrow')}</a></div></article>`).join('')}</div><div class="info-strip">${icon('check')}<p>浏览器内直接编辑、实时预览、导出 PDF / HTML / JSON。登录后保存到个人简历库；开源模板已适配中文，不依赖第三方字体或模板服务器。</p></div>`; }

async function resumesPage() {
  if (!state.user) return pageHeading('resumes','<a class="button button-primary" href="#/studio/classic">直接开始编辑 →</a>') + '<div class="welcome-panel"><div><span class="page-kicker">YOUR RESUME STUDIO</span><h2>先写好简历，再开启下一步。</h2><p>无需登录即可使用简历工作室。草稿保存在当前浏览器会话，可导出 PDF、网页及 JSON；登录后可保存版本并使用 AI 润色。</p><a class="button button-soft" href="#/templates">挑选精品模板 ↗</a></div></div>';
  state.resumes = await api('/resumes');
  return pageHeading('resumes', '<div class="button-row"><button class="button button-soft button-small" data-action="import-resume">导入 JSON</button><button class="button button-primary button-small" data-action="new-resume">新建简历 +</button></div>') + `<div class="resume-grid">${state.resumes.map(r => `<article class="resume-card"><a href="#/resume/${r.id}" class="resume-card-preview" aria-label="编辑 ${e(r.title)}">${templateThumbnail(templates.find(t => t.id === r.template) || templates[0])}<span class="resume-edit-label">继续编辑 ${icon('arrow')}</span></a><div class="resume-card-body"><span class="template-tag">${e((templates.find(t => t.id === r.template) || templates[0]).name)} · V${r.revision}</span><h2><a href="#/resume/${r.id}">${e(r.title)}</a></h2><p>更新于 ${time(r.updated_at)}</p><div class="resume-card-actions"><a class="button button-soft button-small" href="#/resume/${r.id}">打开编辑器</a><button class="icon-button" data-action="clone-resume" data-id="${r.id}" title="创建副本" aria-label="创建副本">${icon('plus')}</button><button class="icon-button danger-link" data-action="delete-resume" data-id="${r.id}" aria-label="删除简历">${icon('trash')}</button></div></div></article>`).join('')}${!state.resumes.length ? emptyState('你的第一份简历，从这里开始', '选择模板，直接在网页中填写和修改真实经历。', '<a href="#/templates" class="button button-primary">挑选模板 →</a>') : ''}</div><input id="resume-import" type="file" accept=".json,application/json" hidden>`;
}
function createResume(template = 'classic') { location.hash = '/studio/' + template; }
function saveStudioToAccount(draft) {
  const persist = async () => {
    const button = main.querySelector('#save-account'); if (button) button.disabled = true;
    try {
      const result = await api('/resumes', { method:'POST',data:draft });
      state.editor?.markSaved(); location.hash = '/resume/'+result.id; toast('已存入你的简历库，可以继续编辑或 AI 润色。');
    } catch(error) { if (button) button.disabled = false; errorMessage(error); }
  };
  if (state.user) handle(persist()); else showAuth('login', () => handle(persist()));
}

const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
async function calendarPage() {
  if (!state.user) return loginEmpty('calendar');
  state.tasks = await api('/tasks');
  const month = state.calendarMonth, start = new Date(month.getFullYear(), month.getMonth(), 1); const offset = (start.getDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(i - offset + 1); const key = dayKey(d); const tasks = state.tasks.filter(t => dayKey(new Date(t.due_at)) === key && !t.completed); return `<button class="calendar-day ${d.getMonth() !== month.getMonth() ? 'other-month' : ''} ${key === dayKey(new Date()) ? 'today' : ''} ${state.selectedDay === key ? 'selected' : ''}" data-action="select-day" data-day="${key}"><span>${d.getDate()}</span>${tasks.slice(0, 2).map(t => `<small>${e(t.kind)} · ${e(t.title.slice(0, 9))}</small>`).join('')}${tasks.length > 2 ? `<i>+${tasks.length - 2}</i>` : ''}</button>`; }).join('');
  const list = state.tasks.filter(t => !state.selectedDay || dayKey(new Date(t.due_at)) === state.selectedDay);
  return pageHeading('calendar', '<button class="button button-primary button-small" data-action="new-task">添加安排 +</button>') + `<div class="calendar-layout"><section class="panel calendar-panel"><div class="panel-heading"><h2>${month.getFullYear()} 年 ${month.getMonth() + 1} 月</h2><div class="button-row"><button class="icon-button" data-action="calendar-month" data-delta="-1" aria-label="上个月">‹</button><button class="text-link" data-action="calendar-today">今天</button><button class="icon-button" data-action="calendar-month" data-delta="1" aria-label="下个月">›</button></div></div><div class="calendar-week">${['一', '二', '三', '四', '五', '六', '日'].map(d => `<span>${d}</span>`).join('')}</div><div class="calendar-grid">${cells}</div></section><section class="panel"><div class="panel-heading"><h2>${state.selectedDay ? e(state.selectedDay) : '全部安排'}</h2>${state.selectedDay ? '<button class="text-link" data-action="clear-day">查看全部</button>' : ''}</div>${list.length ? list.map(t => taskItem(t)).join('') : emptyState('这一天，还可以从容安排', '添加一场面试、笔试或跟进提醒。')}</section></div>`;
}
async function showTask(applicationId = '') {
  if (!state.user) { showAuth('register', () => handle(showTask(applicationId))); return; }
  const applications = await api('/applications');
  dialog('安排你的下一步', `<form id="task-form"><label class="field"><span>要做什么</span><input name="title" maxlength="200" required placeholder="如：准备产品经理一面"></label><div class="form-grid"><label class="field"><span>类型</span><select name="kind">${['面试', '笔试', '截止', '跟进', '其他'].map(s => `<option>${s}</option>`).join('')}</select></label><label class="field"><span>日期与时间</span><input name="dueAt" type="datetime-local" required value="${state.selectedDay ? state.selectedDay + 'T09:00' : localDateInput(new Date(Date.now() + 3600000).toISOString())}"></label></div><label class="field"><span>关联投递（可选）</span><select name="applicationId"><option value="">不关联</option>${applications.map(a => `<option value="${a.id}" ${a.id === applicationId ? 'selected' : ''}>${e(a.job.company)} · ${e(a.job.title)}</option>`).join('')}</select></label><label class="field"><span>备注</span><textarea name="notes" rows="3" maxlength="3000" placeholder="会议链接、面试准备、需要携带的材料…"></textarea></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button button-primary" type="submit">保存安排 ${icon('check')}</button></div></form>`, el => el.querySelector('form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; const btn = form.querySelector('button'); btn.disabled = true; try { await api('/tasks', { method: 'POST', data: Object.fromEntries(new FormData(form)) }); el.close(); await renderRoute(); toast('下一步已安排。'); } catch (err) { form.querySelector('.form-error').textContent = err.message; btn.disabled = false; } }));
}

async function aiPage() {
  if (!state.user) return loginEmpty('ai');
  const [reports, settings] = await Promise.all([api('/ai/reports'), api('/settings/ai')]); state.reports = reports;
  return pageHeading('ai', `<a href="#/${settings.configured ? 'resumes' : 'settings'}" class="button button-primary button-small">${settings.configured ? '去简历编辑器润色' : '连接 AI 服务'} ${icon('arrow')}</a>`) + `<div class="info-strip">${icon('ai')}<p>${settings.configured ? 'AI 服务已配置。' : 'AI 服务尚未配置。'} 在简历编辑器中选择一段真实经历，生成建议后对比、采纳。所有报告关联生成时的简历版本。</p></div><div class="ai-report-list">${reports.length ? reports.map(r => `<article class="panel report-card"><div class="panel-heading"><h2>${e(r.field_path === 'basics.summary' ? '个人简介润色' : r.field_path === 'skills' ? '专业技能润色' : '经历表达润色')} <span>V${r.resume_revision}</span></h2><span class="badge ${r.applied_at ? 'badge-green' : 'badge-slate'}">${r.applied_at ? '已采纳' : '待参考'}</span></div><div class="report-excerpt"><div><small>原文</small><p>${e(r.original.slice(0, 180))}</p></div><div><small>润色建议</small><p>${e(r.revised.slice(0, 240))}</p></div></div>${r.match ? `<div style="display:flex;gap:12px;align-items:center;padding-top:10px;font-size:12px;opacity:.72"><span style="font-weight:500">匹配度 ${r.match.score}</span><span>已具备 ${r.match.matched.length} 项 · 尚缺 ${r.match.missing.length} 项</span></div>` : ''}<div class="report-footer"><span>${e(r.model)} · ${time(r.created_at)}</span><button class="text-link" data-action="report-detail" data-id="${r.id}">查看完整对比 →</button></div></article>`).join('') : emptyState('还没有润色记录', '先创建简历，写下一段真实经历，再让 AI 帮你整理表达。', '<a class="button button-primary" href="#/resumes">去写简历</a>')}</div>`;
}
async function settingsPage() {
  if (!state.user) return loginEmpty('settings');
  const config = await api('/settings/ai');
  return pageHeading('settings') + `<div class="settings-layout"><section class="panel settings-panel"><div class="panel-heading"><h2>${icon('ai')} AI 接入</h2><span class="badge ${config.configured ? 'badge-green' : 'badge-slate'}">${config.configured ? '已配置' : '待配置'}</span></div><p class="settings-description">使用你自己的 AI 服务账户。密钥由后端加密保存，不会回显到浏览器；只有点击润色时才调用。</p><form id="ai-settings-form"><label class="field"><span>服务商</span><select name="provider" id="ai-provider">${config.providers.map(item => `<option value="${item.key}" ${config.provider === item.key ? 'selected' : ''}>${e(item.label)}</option>`).join('')}</select></label><label class="field" id="ai-baseurl-field"${config.provider === 'custom' ? '' : ' hidden'}><span>接口地址（OpenAI 兼容，须 https）</span><input name="baseUrl" type="url" maxlength="300" placeholder="https://your-endpoint.example.com/v1" value="${e(config.baseUrl)}"></label><label class="field"><span>API 密钥${config.source === 'personal' ? '（已保存，留空则不修改）' : ''}</span><input name="apiKey" type="password" autocomplete="new-password" maxlength="500" placeholder="在这里填写 API 密钥"></label><label class="field" id="ai-model-pick"${config.provider === 'custom' ? ' hidden' : ''}><span>模型</span><select name="model">${config.models.map(model => `<option value="${model}" ${config.model === model ? 'selected' : ''}>${model === 'deepseek-flash' ? 'DeepSeek Flash · 日常润色' : 'DeepSeek V4 Pro · 深入优化'}</option>`).join('')}</select></label><label class="field" id="ai-model-free"${config.provider === 'custom' ? '' : ' hidden'}><span>模型名称</span><input name="modelCustom" maxlength="80" placeholder="例如 gpt-4o-mini" value="${config.provider === 'custom' ? e(config.model) : ''}"></label><p class="form-error" role="alert"></p><div class="button-row"><button class="button button-primary button-small" type="submit">保存配置</button>${config.source === 'personal' ? '<button class="button button-soft button-small" id="remove-ai-key" type="button">移除个人密钥</button>' : ''}${config.providers.find(item => item.key === config.provider)?.keyUrl ? `<a href="${config.providers.find(item => item.key === config.provider).keyUrl}" target="_blank" rel="noopener noreferrer" class="text-link">前往服务商平台 ↗</a>` : ''}</div><p class="field-note">当前来源：${config.source === 'personal' ? '个人配置' : config.source === 'server' ? '服务器环境配置' : '尚未配置'}。保存配置不会自动发起调用，也不代表已经验证密钥可用。自定义接口地址不得指向本机或内网。</p></form></section><div><section class="panel settings-panel"><div class="panel-heading"><h2>我的账号</h2></div><div class="profile-summary"><span class="user-avatar">${e(state.user.name.slice(0, 1))}</span><div><strong>${e(state.user.name)}</strong><small>${e(state.user.email)}</small></div></div><button class="button button-soft button-small" data-action="logout">${icon('logout')} 退出登录</button></section><section class="panel settings-panel"><div class="panel-heading"><h2>数据与备份</h2></div><p class="settings-description">导出你的投递、待办与简历内容。导出文件不含密码或 API 密钥，请妥善保存个人资料。</p><button class="button button-soft button-small" data-action="export-data">${icon('download')} 导出我的数据</button><p class="field-note">本地数据保存在启动这个项目的电脑。邮箱暂仅用作账号，不提供邮件找回。</p></section></div></div><section class="panel source-panel"><div class="panel-heading"><h2>岗位数据说明</h2></div><p>本批 ${state.meta.jobs.count} 条，来源：${state.meta.companies.map(c => `${e(c.company)} ${c.count} 条`).join('、')}。采集于 ${date(state.meta.jobs.collected_at)}。</p><p>${e(state.meta.jobs.limitations)}</p><p>点击条目可查看企业官网或西北大学岗位页、2027 届依据和原始发布日期。当前不会自动刷新外部招聘状态。</p></section>`;
}

async function renderRoute() {
  const routeParts = location.hash.replace(/^#\/?/, '').split('/'); const route = routeParts[0] || 'overview';
  const currentNavigation = ++state.navigation;
  state.editor?.destroy(); state.editor = null;
  state.route = route; renderNav(); document.getElementById('page-breadcrumb').textContent = ['resume','studio'].includes(route) ? '简历工作室' : navigation.find(([key]) => key === route)?.[1] || '总览';
  document.title = document.getElementById('page-breadcrumb').textContent + ' · Offerbiu';
  main.innerHTML = loading();
  try {
    if (route === 'studio') {
      const template = templates.some(t => t.id === routeParts[1]) ? routeParts[1] : 'classic';
      const draftKey = 'offerbiu:studio:' + (state.user?.id || 'guest') + ':' + template;
      let initial = { id:'local',title:'我的校招简历',template,data:blankResume(),revision:0 };
      try { const cached = JSON.parse(sessionStorage.getItem(draftKey)); if (cached?.data?.basics && ['education','experience','projects'].every(k => Array.isArray(cached.data[k]))) initial = {...initial,...cached,id:'local',revision:0}; } catch {}
      state.editor = mountEditor(main,initial,()=>{}, {local:true,draftKey,onSaveAccount:saveStudioToAccount}); return;
    }
    if (route === 'resume') {
      if (!state.user) { main.innerHTML = loginEmpty('resumes'); return; }
      const resume = await api('/resumes/' + encodeURIComponent(routeParts[1] || ''));
      if (currentNavigation !== state.navigation) return;
      state.editor = mountEditor(main, resume); return;
    }
    const renderers = { overview: overviewPage, jobs: jobsPage, applications: applicationsPage, resumes: resumesPage, templates: templatesPage, calendar: calendarPage, ai: aiPage, settings: settingsPage };
    const content = await (renderers[route] || overviewPage)();
    if (currentNavigation !== state.navigation) return;
    main.innerHTML = content; wirePage();
  } catch (err) {
    if (currentNavigation !== state.navigation) return;
    main.innerHTML = emptyState('暂时没有加载成功', err.message, '<button class="button button-primary button-small" data-action="retry">重新加载</button>');
  }
}
function wirePage() {
  const filters = document.getElementById('job-filters');
  filters?.addEventListener('submit', event => { event.preventDefault(); state.jobs = { ...Object.fromEntries(new FormData(filters)), page: 1 }; handle(renderRoute()); });
  filters?.querySelectorAll('select').forEach(select => select.addEventListener('change', () => filters.requestSubmit()));
  const aiForm = document.getElementById('ai-settings-form');
  aiForm?.addEventListener('submit', async event => { event.preventDefault(); const btn = aiForm.querySelector('[type=submit]'); btn.disabled = true; try { const values = Object.fromEntries(new FormData(aiForm)); const provider = values.provider === 'custom' ? 'custom' : 'deepseek'; await api('/settings/ai', { method: 'PUT', data: { provider, apiKey: values.apiKey, baseUrl: values.baseUrl || '', model: provider === 'custom' ? values.modelCustom : values.model } }); aiForm.elements.apiKey.value = ''; toast('配置已保存；尚未发起 API 调用。'); await renderRoute(); } catch (err) { aiForm.querySelector('.form-error').textContent = err.message; btn.disabled = false; } });
  const providerSelect = document.getElementById('ai-provider');
  providerSelect?.addEventListener('change', () => { const custom = providerSelect.value === 'custom'; document.getElementById('ai-baseurl-field').hidden = !custom; document.getElementById('ai-model-pick').hidden = custom; document.getElementById('ai-model-free').hidden = !custom; });
  document.getElementById('remove-ai-key')?.addEventListener('click', async () => { if (!confirm('移除保存在本机的个人 API 密钥？')) return; try { await api('/settings/ai', { method: 'PUT', data: { provider: aiForm.elements.provider.value, baseUrl: aiForm.elements.baseUrl.value, model: aiForm.elements.provider.value === 'custom' ? aiForm.elements.modelCustom.value : aiForm.elements.model.value, removeKey: true } }); await renderRoute(); toast('个人密钥已移除。'); } catch (err) { errorMessage(err); } });
  document.getElementById('resume-import')?.addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    try { if (file.size > RESUME_FILE_LIMIT) throw new Error('含图片的简历 JSON 需小于 2 MB。'); const data = JSON.parse(await file.text()); if (!data.data?.basics || !data.title) throw new Error('请选择从本项目导出的简历 JSON 文件。'); const r = await api('/resumes', { method: 'POST', data: { title: data.title + ' · 导入', template: data.template, data: data.data } }); location.hash = '/resume/' + r.id; toast('简历内容已导入。'); } catch (err) { errorMessage(err); }
  });
}

async function action(button) {
  const kind = button.dataset.action, key = button.dataset.id;
  if (kind === 'auth') return showAuth('register');
  if (kind === 'retry') return renderRoute();
  if (kind === 'job-detail') return showJob(key);
  if (kind === 'save-job') return requireUser(() => handle(saveJob(key)));
  if (kind === 'edit-application') return editApplication(key);
  if (kind === 'reset-jobs') { state.jobs = emptyJobFilters(); return renderRoute(); }
  if (kind === 'job-facet') { const filters = document.getElementById('job-filters'); state.jobs = { ...state.jobs, ...(filters ? Object.fromEntries(new FormData(filters)) : {}), [button.dataset.field]: button.dataset.value, page: 1 }; return renderRoute(); }
  if (kind === 'job-page') { state.jobs.page = Number(button.dataset.page); await renderRoute(); main.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  if (kind === 'app-filter') { state.appFilter = button.dataset.status; return renderRoute(); }
  if (kind === 'new-resume') return createResume(button.dataset.template || 'classic');
  if (kind === 'import-resume') return document.getElementById('resume-import').click();
  if (kind === 'clone-resume') { const old = await api('/resumes/' + key); const copy = await api('/resumes', { method: 'POST', data: { title: old.title + ' · 副本', template: old.template, data: old.data } }); location.hash = '/resume/' + copy.id; return; }
  if (kind === 'delete-resume') { if (!confirm('删除这份简历和版本历史？此操作不可恢复。已绑定投递中的简历快照会保留。')) return; await api('/resumes/' + key, { method: 'DELETE' }); toast('已删除简历。'); return renderRoute(); }
  if (kind === 'new-task') return showTask();
  if (kind === 'toggle-task') { await api('/tasks/' + key, { method: 'PUT', data: { completed: button.dataset.completed !== '1' } }); return renderRoute(); }
  if (kind === 'delete-task') { if (!confirm('删除这条待办？')) return; await api('/tasks/' + key, { method: 'DELETE' }); return renderRoute(); }
  if (kind === 'calendar-month') { state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + Number(button.dataset.delta), 1); state.selectedDay = ''; return renderRoute(); }
  if (kind === 'calendar-today') { const d = new Date(); state.calendarMonth = new Date(d.getFullYear(), d.getMonth(), 1); state.selectedDay = dayKey(d); return renderRoute(); }
  if (kind === 'select-day') { state.selectedDay = button.dataset.day; return renderRoute(); }
  if (kind === 'clear-day') { state.selectedDay = ''; return renderRoute(); }
  if (kind === 'logout') { await api('/auth/logout', { method: 'POST' }); state.user = null; setCsrf(null); setAccount(); state.editor?.destroy(); state.editor = null; location.hash = '/overview'; await renderRoute(); return; }
  if (kind === 'export-data') { const data = await api('/export'); return downloadJson(data, 'Offerbiu-我的秋招备份.json'); }
  if (kind === 'report-detail') {
    const report = state.reports.find(r => r.id === key); if (!report) return;
    return dialog('润色前后对比', `<div class="polish-comparison"><section><h3>原文 · V${report.resume_revision}</h3><p>${e(report.original)}</p></section><section class="revised-text"><h3>润色建议</h3><p>${e(report.revised)}</p></section></div><div class="ai-reasons"><h3>修改理由</h3><ul>${report.changes.map(s => `<li>${e(s)}</li>`).join('')}</ul>${report.questions.length ? `<h3>待补充的事实</h3><ul>${report.questions.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>${report.match ? `<div class="ai-reasons"><h3>岗位匹配分析 · ${report.match.score} 分</h3>${report.match.advice ? `<p>${e(report.match.advice)}</p>` : ''}${report.match.matched.length ? `<h3>简历已具备</h3><ul>${report.match.matched.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}${report.match.missing.length ? `<h3>岗位要求但尚未体现</h3><ul>${report.match.missing.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>` : ''}<div class="modal-actions"><button class="button button-soft" id="copy-report">复制建议</button>${report.resume_id ? `<a href="#/resume/${report.resume_id}" class="button button-primary" id="open-report-resume">回到简历编辑</a>` : '<span class="muted">原简历已删除，报告仍保留</span>'}</div>`, el => { el.querySelector('#copy-report').addEventListener('click', async () => { try { await navigator.clipboard.writeText(report.revised); toast('已复制建议。'); } catch { toast('请手动选中文字复制。', true); } }); el.querySelector('#open-report-resume')?.addEventListener('click', () => el.close()); }, 'modal-wide');
  }
}
main.addEventListener('click', event => { const button = event.target.closest('[data-action]'); if (button && !button.disabled) handle(action(button)); });
document.getElementById('header-action').addEventListener('click', () => handle(showTask()));
document.getElementById('account-button').addEventListener('click', () => { if (!state.user) showAuth('login'); else location.hash = '/settings'; });
const sidebar = document.getElementById('sidebar'), scrim = document.getElementById('mobile-scrim'), menu = document.getElementById('sidebar-toggle');
function closeSidebar() { sidebar.classList.remove('is-open'); scrim.hidden = true; menu.setAttribute('aria-expanded', 'false'); }
menu.addEventListener('click', () => { const open = !sidebar.classList.contains('is-open'); sidebar.classList.toggle('is-open', open); scrim.hidden = !open; menu.setAttribute('aria-expanded', String(open)); });
scrim.addEventListener('click', closeSidebar);
document.getElementById('side-nav').addEventListener('click', event => { if (event.target.closest('a')) closeSidebar(); });
window.addEventListener('hashchange', () => {
  if (state.editor?.dirty && !confirm('简历有未保存修改，确定离开？也可以先保存或导出 JSON。')) { history.replaceState(null, '', '#' + state.editor.route); return; }
  state.editor?.destroy(); state.editor = null; handle(renderRoute());
});
window.addEventListener('beforeunload', event => { if (state.editor?.dirty) { event.preventDefault(); event.returnValue = ''; } });
document.getElementById('today-label').textContent = new Intl.DateTimeFormat('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());

try {
  const [session, meta] = await Promise.all([api('/session'), api('/meta')]); state.user = session.user; state.meta = meta; setCsrf(session.csrf); setAccount(); await renderRoute();
} catch (err) { main.innerHTML = emptyState('工作台尚未连接', err.message, '<p class="data-note">请使用项目的“启动工作台”入口。单独打开 HTML 无法连接数据库。</p>'); }
