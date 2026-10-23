import { api } from './api.js';
import { escape as e, toast, dialog, downloadJson, emptyState } from './ui.js';

const kinds = { education: '教育信息', experience: '实习 / 工作', project: '项目经历', skill: '技能', award: '奖项 / 证书', other: '其他事实' };
const splitList = value => String(value || '').split(/[\n,，、]/).map(x => x.trim()).filter(Boolean);
const clone = value => structuredClone(value);

export function profileMissing(profile) {
  const missing = [], prefs = profile.preferences || {}, facts = profile.facts || [];
  if (!prefs.confirmedAt || !prefs.targetRoles?.length) missing.push('确认至少一个目标方向及求职偏好');
  if (!facts.some(x => x.kind === 'education' && x.status === 'confirmed')) missing.push('确认至少一项教育信息');
  if (!facts.some(x => ['project', 'experience', 'skill'].includes(x.kind) && x.status === 'confirmed')) missing.push('确认至少一项项目、实习或技能事实');
  return missing;
}

export function mergeProfileImport(current, preview, selectedIds, usePreferences = false) {
  const selected = new Set(selectedIds);
  return { ...clone(current), preferences: usePreferences ? { ...clone(preview.preferences), confirmedAt: null } : clone(current.preferences),
    facts: [...clone(current.facts || []), ...(preview.facts || []).filter(x => selected.has(x.id)).map(x => ({ ...clone(x), status: 'draft', confirmedAt: null }))] };
}

export async function mountProfile(root, { signal, isCurrent = () => true } = {}) {
  const [initial, resumes] = await Promise.all([api('/candidate-profile', { signal }), api('/resumes', { signal })]);
  let profile = clone(initial), dirty = false, alive = true, busy = false;
  let savedFactIds = new Set(initial.facts.map(f => f.id));
  const live = () => alive && !signal?.aborted && isCurrent();
  const fail = error => { if (live() && error.name !== 'AbortError') { const el = root.querySelector('[data-profile-error]'); if (el) el.textContent = error.message; toast(error.message, true); } };
  const run = fn => Promise.resolve().then(fn).catch(fail);
  const sourceMarkup = fact => {
    const source = fact.source?.originalSource || fact.source || {}, resume = resumes.find(x => x.id === source.resumeId);
    if (source.type === 'resume' || source.resumeId) return `<div class="wf-source">${fact.source?.originalSource ? '本人手工改写；保留原始来源：' : '来源：'}${resume ? `<a href="#/resume/${e(resume.id)}">${e(resume.title)}</a>` : '已删除的源简历'} · V${e(source.resumeRevision)} · ${e(source.field || '')}${resume && resume.revision !== source.resumeRevision ? '<span class="badge badge-amber">源简历已变化</span>' : ''}${source.excerpt ? `<details><summary>查看保存的原文</summary><p>${e(source.excerpt)}</p></details>` : ''}</div>`;
    return '<div class="wf-source">来源：本人手工填写与确认</div>';
  };
  function collect() {
    const form = root.querySelector('#profile-form'); if (!form) return profile;
    const values = Object.fromEntries(new FormData(form)), preferences = { ...profile.preferences,
      targetRoles: splitList(values.targetRoles), preferredCities: splitList(values.preferredCities), cityConstraint: values.cityConstraint,
      graduationDate: values.graduationDate || '', degree: values.degree || '', major: values.major || '',
      languages: [...root.querySelectorAll('[data-language]')].map(row => ({ name: row.querySelector('[name=languageName]').value.trim(), qualification: row.querySelector('[name=languageQualification]').value.trim(), value: row.querySelector('[name=languageValue]').value === '' ? null : Number(row.querySelector('[name=languageValue]').value) })).filter(x => x.name),
      confirmedAt: form.elements.confirmPreferences.checked ? profile.preferences.confirmedAt || 'pending' : null,
    };
    const facts = [...root.querySelectorAll('[data-fact]')].map(row => {
      const old = profile.facts.find(f => f.id === row.dataset.fact), checked = row.querySelector('[name=factConfirmed]').checked;
      const kind = row.querySelector('[name=factKind]').value, text = row.querySelector('[name=factText]').value;
      const source = !savedFactIds.has(old.id) && old.source?.type === 'resume' && (kind !== old.kind || text !== old.text) ? { type: 'manual', originalSource: old.source } : old.source;
      return { ...old, kind, text, source,
        status: checked ? 'confirmed' : 'draft', confirmedAt: checked ? old.confirmedAt : null };
    });
    return { ...profile, preferences, facts };
  }
  function render() {
    if (!live()) return;
    const p = profile.preferences, missing = profileMissing(profile), confirmed = profile.facts.filter(x => x.status === 'confirmed').length;
    root.innerHTML = `<div class="page-heading"><div><span class="page-kicker">YOUR FACTS / PROFILE</span><h1>让每一份材料，有真实依据。</h1><p>只有本人确认的求职偏好与事实会用于岗位评估、草拟和复核。联系方式、头像与作品图不进入底稿模型输入。</p></div><a class="button button-soft button-small" href="#/jobs">下一步：筛选岗位 →</a></div>
      <div class="wf-summary"><span class="badge ${missing.length ? 'badge-amber' : 'badge-green'}">${missing.length ? '资料待完善' : '可进行评估'}</span><span>底稿 V${profile.revision} · 已确认 ${confirmed} / ${profile.facts.length} 项事实</span><span data-profile-state>${dirty ? '有未保存修改' : '已读取保存版本'}</span></div>
      ${missing.length ? `<div class="wf-notice"><strong>完成这些信息后即可评估</strong><ul>${missing.map(x => `<li>${e(x)}</li>`).join('')}</ul></div>` : ''}
      <section class="panel wf-import"><div><h2>从已保存简历开始</h2><p>导入只生成待合并预览，每项仍由你选择、编辑与确认。再次导入不会自动覆盖底稿。</p></div><div class="button-row"><select id="profile-resume" aria-label="导入来源简历"><option value="">选择一份已保存简历</option>${resumes.map(r => `<option value="${e(r.id)}">${e(r.title)} · V${r.revision}</option>`).join('')}</select><button class="button button-soft button-small" type="button" data-profile-action="import" ${resumes.length ? '' : 'disabled'}>预览导入</button>${!resumes.length ? '<a class="text-link" href="#/resumes">先保存一份简历 →</a>' : ''}</div></section>
      <form id="profile-form"><section class="panel wf-section"><div class="panel-heading"><h2>求职偏好与资格信息</h2><span class="badge ${p.confirmedAt ? 'badge-green' : 'badge-slate'}" data-preference-badge>${p.confirmedAt ? '已确认' : '待本人确认'}</span></div><div class="form-grid" data-preferences>
        <label class="field"><span>目标方向（逗号分隔）</span><input name="targetRoles" maxlength="1000" value="${e((p.targetRoles || []).join('，'))}" placeholder="填写你实际考虑的岗位方向"></label>
        <label class="field"><span>意向城市（逗号分隔）</span><input name="preferredCities" maxlength="1000" value="${e((p.preferredCities || []).join('，'))}"></label>
        <label class="field"><span>城市约束</span><select name="cityConstraint"><option value="preferred" ${p.cityConstraint !== 'required' ? 'selected' : ''}>软偏好：优先考虑这些城市</option><option value="required" ${p.cityConstraint === 'required' ? 'selected' : ''}>硬要求：仅接受这些城市</option></select></label>
        <label class="field"><span>毕业时间</span><input type="month" name="graduationDate" value="${e(p.graduationDate)}"></label>
        <label class="field"><span>学历</span><select name="degree"><option value="">尚未填写</option>${['高中', '中专', '大专', '本科', '硕士', '博士', '其他'].map(x => `<option ${p.degree === x ? 'selected' : ''}>${e(x)}</option>`).join('')}</select></label>
        <label class="field"><span>专业</span><input name="major" maxlength="200" value="${e(p.major)}"></label>
      </div><div class="panel-heading"><h3>语言与资格证书</h3><button type="button" class="text-link" data-profile-action="add-language">添加语言 +</button></div><div class="wf-language-list">${(p.languages || []).map((l, i) => `<div class="wf-language-row" data-language="${i}"><label class="field"><span>语言</span><input name="languageName" maxlength="100" value="${e(l.name)}"></label><label class="field"><span>证书 / 资格</span><input name="languageQualification" maxlength="200" value="${e(l.qualification)}"></label><label class="field"><span>分数（选填）</span><input name="languageValue" type="number" min="0" step="any" value="${e(l.value ?? '')}"></label><button type="button" class="icon-button danger-link" data-profile-action="remove-language" aria-label="移除语言">×</button></div>`).join('') || '<p class="field-note">没有待确认的语言信息。</p>'}</div>
      <label class="consent"><input type="checkbox" name="confirmPreferences" ${p.confirmedAt ? 'checked' : ''}><span>我已核对以上偏好、教育信息与语言资格；修改后需要重新勾选。</span></label></section>
      <section class="panel wf-section"><div class="panel-heading"><h2>真实事实 <span>${profile.facts.length} / 80</span></h2><button type="button" class="text-link" data-profile-action="add-fact" ${profile.facts.length >= 80 ? 'disabled' : ''}>手工添加事实 +</button></div><p class="field-note">写清楚个人职责、所属项目与可核对的成果。模板示例不代表你的真实经历。编辑条目会清除该项确认。</p>
      <div class="wf-facts">${profile.facts.map(f => `<article class="wf-fact" data-fact="${e(f.id)}"><div class="wf-fact-top"><label class="field"><span>类型</span><select name="factKind">${Object.entries(kinds).map(([k, label]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${label}</option>`).join('')}</select></label><span class="badge ${f.status === 'confirmed' ? 'badge-green' : 'badge-slate'}" data-fact-badge>${f.status === 'confirmed' ? '已确认' : '草稿'}</span><button type="button" class="text-link danger-link" data-profile-action="remove-fact">删除条目</button></div><label class="field"><span>事实正文</span><textarea name="factText" rows="3" required maxlength="2400">${e(f.text)}</textarea></label>${sourceMarkup(f)}<small class="wf-source">事实 ID：${e(f.id)} · 所属经历：${e(f.entityKey || '未指定')}</small><label class="consent"><input type="checkbox" name="factConfirmed" ${f.status === 'confirmed' ? 'checked' : ''}><span>我确认这条事实真实，允许用于本次求职材料。</span></label></article>`).join('') || emptyState('底稿里还没有事实', '从简历导入，或手工补充一项真实教育、项目或技能经历。')}</div></section>
      <div class="wf-sticky-actions"><p class="form-error" data-profile-error role="alert"></p><button class="button button-primary" type="submit">保存底稿与确认状态</button><button class="button button-soft" type="button" data-profile-action="export">导出当前保存底稿</button>${profile.revision ? '<button class="text-link danger-link" type="button" data-profile-action="delete">删除当前底稿</button>' : ''}</div></form>
      <p class="data-note">删除当前底稿不会删除过去的评估、材料和投递快照。可在<a href="#/evaluations">评估记录</a>和<a href="#/applications">每份投递的材料与留档</a>中分别查看、导出与删除。完整账号资料可在<a href="#/settings">个人设置</a>导出。</p>`;
  }
  function markDirty() { dirty = true; const el = root.querySelector('[data-profile-state]'); if (el) el.textContent = '有未保存修改'; }
  root.addEventListener('input', onInput);
  root.addEventListener('change', onInput);
  function onInput(event) {
    if (!event.target.closest('#profile-form')) return;
    markDirty();
    const row = event.target.closest('[data-fact]');
    if (row && event.target.name !== 'factConfirmed') { row.querySelector('[name=factConfirmed]').checked = false; row.querySelector('[data-fact-badge]').textContent = '已修改 · 待确认'; }
    if ((event.target.closest('[data-preferences]') || event.target.closest('[data-language]')) && event.target.name !== 'confirmPreferences') {
      root.querySelector('[name=confirmPreferences]').checked = false; root.querySelector('[data-preference-badge]').textContent = '已修改 · 待确认';
    }
  }
  const onSubmit = event => { if (event.target.id !== 'profile-form') return; event.preventDefault(); run(async () => {
    if (busy) return; const draft = collect(), confirmedFactIds = draft.facts.filter(x => x.status === 'confirmed').map(x => x.id);
    if (draft.facts.some(x => Array.from(x.text).length > 1200)) throw new Error('单条事实最多 1,200 个 Unicode 码点，请精简后保存。');
    busy = true; const controls = [...root.querySelectorAll('#profile-form input,#profile-form select,#profile-form textarea,#profile-form button')]; controls.forEach(x => x.disabled = true);
    try {
      const result = await api('/candidate-profile', { method: 'PUT', signal, data: { revision: profile.revision, preferences: draft.preferences, facts: draft.facts, confirmPreferences: !!draft.preferences.confirmedAt, confirmedFactIds } });
      if (!live()) return; profile = clone(result); savedFactIds = new Set(profile.facts.map(f => f.id)); dirty = false; render(); toast('底稿与本人确认状态已保存。');
    } finally { busy = false; if (live()) controls.forEach(x => x.disabled = false); }
  }); };
  root.addEventListener('submit', onSubmit);
  const onClick = event => { const button = event.target.closest('[data-profile-action]'); if (!button || button.disabled) return;
    run(async () => {
      const action = button.dataset.profileAction;
      if (action === 'export') { const saved = await api('/candidate-profile', { signal }); if (live()) downloadJson(saved, 'Offerbiu-候选人底稿.json'); return; }
      if (action === 'delete') {
        if (!confirm('删除当前底稿？过去评估、材料和投递快照仍含历史资料，需要到对应记录分别删除。')) return;
        await api('/candidate-profile', { method: 'DELETE', signal }); if (!live()) return;
        profile = await api('/candidate-profile', { signal }); dirty = false; render(); toast('已删除当前底稿。历史记录仍可分别管理。'); return;
      }
      if (action === 'import') {
        const resume = resumes.find(x => x.id === root.querySelector('#profile-resume').value); if (!resume) throw new Error('请先选择一份已保存简历。');
        button.disabled = true;
        let preview; try { preview = await api('/candidate-profile/import', { method: 'POST', signal, data: { resumeId: resume.id, resumeRevision: resume.revision, profileRevision: profile.revision } }); } finally { if (live()) button.disabled = false; }
        if (!live()) return;
        dialog('合并简历导入预览', `<p class="modal-description">来自「${e(resume.title)}」V${resume.revision}。导入项均为草稿，请主动选择需要的内容。可用单项替换保留其他已确认事实。</p><div class="wf-import-preview">${preview.facts.map(f => `<article class="wf-fact" data-import-fact="${e(f.id)}"><strong>${e(kinds[f.kind])}</strong><p>${e(f.text)}</p><label class="field"><span>如何处理</span><select><option value="">跳过此项</option><option value="add">添加为新草稿</option>${profile.facts.map(old => `<option value="${e(old.id)}">替换：${e(old.text.slice(0, 50))}</option>`).join('')}</select></label><small>${e(f.source?.field)}</small></article>`).join('') || '<p>该简历没有可导入的经历。</p>'}</div><label class="consent"><input type="checkbox" id="use-import-preferences"><span>以这份简历的候选偏好替换当前偏好（需要重新确认）：${e([...(preview.preferences.targetRoles || []), ...(preview.preferences.preferredCities || []), preview.preferences.degree, preview.preferences.major, preview.preferences.graduationDate].filter(Boolean).join(' / ') || '无已填写偏好')}</span></label><p class="form-error" role="alert"></p><div class="modal-actions"><button class="button button-soft" data-close-dialog>取消</button><button class="button button-primary" id="apply-profile-import">将所选项放入底稿</button></div>`, modal => {
          modal.querySelector('#apply-profile-import').addEventListener('click', () => {
            if (!live()) return; const choices = [...modal.querySelectorAll('[data-import-fact]')].map(row => ({ id: row.dataset.importFact, action: row.querySelector('select').value }));
            const replaced = choices.filter(x => x.action && x.action !== 'add').map(x => x.action);
            if (new Set(replaced).size !== replaced.length) { modal.querySelector('.form-error').textContent = '同一条原事实只能被替换一次，请调整选择。'; return; }
            const current = collect(); current.facts = current.facts.filter(x => !replaced.includes(x.id));
            const merged = mergeProfileImport(current, preview, choices.filter(x => x.action).map(x => x.id), modal.querySelector('#use-import-preferences').checked);
            if (merged.facts.length > 80) { modal.querySelector('.form-error').textContent = '合并后超过 80 条，请减少选中项。'; return; }
            profile = merged; dirty = true; modal.close(); render(); toast('预览已合并到未保存草稿，请核对、确认并保存。');
          });
        }, 'modal-wide'); return;
      }
      profile = collect();
      if (action === 'add-fact') { if (profile.facts.length >= 80) throw new Error('最多保存 80 条事实。'); const id = 'fact_' + crypto.randomUUID(); profile.facts.push({ id, kind: 'other', entityKey: 'manual_' + crypto.randomUUID(), text: '', status: 'draft', confirmedAt: null, source: { type: 'manual' } }); }
      if (action === 'remove-fact') profile.facts = profile.facts.filter(x => x.id !== button.closest('[data-fact]').dataset.fact);
      if (action === 'add-language') { profile.preferences.languages.push({ name: '', qualification: '', value: null }); profile.preferences.confirmedAt = null; }
      if (action === 'remove-language') { profile.preferences.languages.splice(Number(button.closest('[data-language]').dataset.language), 1); profile.preferences.confirmedAt = null; }
      dirty = true; render();
    });
  };
  root.addEventListener('click', onClick); render();
  return { isDirty: () => dirty, destroy() { alive = false; root.removeEventListener('input', onInput); root.removeEventListener('change', onInput); root.removeEventListener('click', onClick); root.removeEventListener('submit', onSubmit); } };
}
