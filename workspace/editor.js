import { api } from './api.js';
import { escape as e, icon, toast, dialog, time, downloadJson } from './ui.js';
import { resumeDocument, printResume } from './resume-renderer.js';
import { templates, sectionLabels, resumeText, normalizeDesign } from '/shared/templates.mjs';
import { normalizeMedia, safeImageData, PORTRAIT_BYTES, GALLERY_LIMIT, RESUME_FILE_LIMIT } from '/shared/resume-media.mjs';
import { prepareResumeImage } from './resume-images.js';

const fields = {
  education: [['school', '学校'], ['degree', '学历'], ['major', '专业'], ['start', '开始时间'], ['end', '结束时间'], ['details', '课程 / 成绩 / 相关经历']],
  experience: [['company', '公司 / 组织'], ['role', '岗位'], ['start', '开始时间'], ['end', '结束时间'], ['details', '你的职责、行动与成果']],
  projects: [['name', '项目名称'], ['role', '担任角色'], ['start', '开始时间'], ['end', '结束时间'], ['details', '项目背景、方法、贡献与结果']],
};
const placeholders = { school: '学校全称', degree: '本科 / 硕士 / 博士', major: '所学专业', company: '实习单位或组织', role: '你担任的角色', name: '项目名称', start: '2023.09', end: '2027.06 / 至今', details: '用真实经历描述：做了什么，如何完成，取得哪些可核实的结果。' };

export function mountEditor(container, initial, onSaved = () => {}, options = {}) {
  let resume = structuredClone(initial);
  resume.data.design = normalizeDesign(resume.data.design, resume.template);
  resume.data.media = normalizeMedia(resume.data.media);
  const local = !!options.local;
  const undoStack = [], redoStack = [];
  const snapshot = () => structuredClone({ title: resume.title, template: resume.template, data: resume.data });
  let lastSnapshot = snapshot(), previewSequence = 0, zoom = 'fit', draftStored = false, storageWarned = false, imageBusy = false;
  let dirty = false;
  let saving = false;
  let activeSection = 'basics';
  let generation = 0;
  let previewFrame = 0;
  let observer;
  let alive = true;
  function cacheDraft() {
    if (!local || !options.draftKey) return;
    try { sessionStorage.setItem(options.draftKey, JSON.stringify({ ...snapshot(), savedAt: Date.now() })); draftStored = true; }
    catch { draftStored = false; if (!storageWarned) toast('浏览器草稿空间不可用，请及时导出 JSON。', true); storageWarned = true; }
  }
  const setDirty = () => { undoStack.push(lastSnapshot); const cap = resume.data.media?.portrait?.src || resume.data.media?.gallery?.length ? 12 : 60; while (undoStack.length > cap) undoStack.shift(); redoStack.length = 0; lastSnapshot = snapshot(); generation++; dirty = true; cacheDraft(); status(); };
  function historyStep(redo = false) {
    const from = redo ? redoStack : undoStack, to = redo ? undoStack : redoStack;
    if (!from.length || saving) return;
    to.push(snapshot()); Object.assign(resume, from.pop()); lastSnapshot = snapshot(); generation++; dirty = true; cacheDraft(); render();
  }
  const get = path => path.split('.').reduce((obj, key) => obj?.[key], resume.data);
  const set = (path, value) => { const parts = path.split('.'); let obj = resume.data; for (const part of parts.slice(0, -1)) obj = obj[part]; obj[parts.at(-1)] = value; };

  function input(path, label, placeholder = '', multiline = false) {
    const limit = path === 'basics.summary' ? 6000 : ['skills','awards'].includes(path) ? 8000 : 12000;
    return `<label class="field ${multiline ? 'field-wide' : ''}"><span>${e(label)}</span>${multiline ? `<textarea data-field="${e(path)}" rows="6" maxlength="${limit}" placeholder="${e(placeholder)}">${e(get(path))}</textarea>` : `<input data-field="${e(path)}" maxlength="300" value="${e(get(path))}" placeholder="${e(placeholder)}">`}</label>`;
  }
  function sectionForm() {
    if (activeSection === 'images') return imageForm();
    if (activeSection === 'basics') return `<div class="form-grid">${input('basics.name', '姓名', '你的真实姓名')}${input('basics.headline', '求职方向', '如：产品经理 / 数据分析师')}${input('basics.email', '邮箱', 'name@example.com')}${input('basics.phone', '手机', '便于联系的号码')}${input('basics.city', '意向城市', '如：上海、杭州')}${input('basics.website', '作品集 / 个人主页', '公开作品链接')}${input('basics.summary', '个人简介', '概括与你的目标岗位相关的能力与经历。', true)}</div>`;
    if (activeSection === 'skills' || activeSection === 'awards') return input(activeSection, sectionLabels[activeSection], activeSection === 'skills' ? '写下真实掌握的工具、技术、语言和熟练程度，每行一项。' : '填写奖项 / 证书名称、颁发机构、时间；没有则留空。', true);
    return (resume.data[activeSection] || []).map((item, index) => `<div class="entry-form"><div class="entry-form-heading"><strong>${e(sectionLabels[activeSection])} ${index + 1}</strong><button class="icon-button danger-link" data-remove-entry="${index}" aria-label="移除这条经历">${icon('trash')}</button></div><div class="form-grid">${fields[activeSection].map(([key, label]) => input(`${activeSection}.${index}.${key}`, label, placeholders[key], key === 'details')).join('')}</div></div>`).join('') + `<button class="button button-dashed" id="add-entry">${icon('plus')} 添加一条${e(sectionLabels[activeSection])}</button>`;
  }
  function status() {
    const label = container.querySelector('#save-state');
    if (label) { label.textContent = saving ? '正在保存…' : local ? '浏览器会话草稿 · 请导出或存入账号' : dirty ? '有未保存的修改' : `已保存 · V${resume.revision}`; label.classList.toggle('unsaved', dirty && !local); }
    const btn = container.querySelector('#save-resume'); if (btn) btn.disabled = saving;
    const undo = container.querySelector('#editor-undo'), redo = container.querySelector('#editor-redo');
    if (undo) undo.disabled = !undoStack.length || saving; if (redo) redo.disabled = !redoStack.length || saving;
  }
  async function updatePreview() {
    if (!alive) return;
    const sequence = ++previewSequence, frame = container.querySelector('#resume-preview');
    try {
      const document = await resumeDocument(resume.data, resume.template, resume.title, true);
      if (!alive || sequence !== previewSequence || !frame.isConnected) return;
      frame.onload = () => {
        if (!alive) return;
        const doc = frame.contentDocument;
        doc.addEventListener('input', event => {
          const path = event.target.dataset.resumeField; if (!path) return;
          const max = path === 'basics.summary' ? 6000 : ['skills', 'awards'].includes(path) ? 8000 : path.endsWith('.details') ? 12000 : 300;
          set(path, event.target.innerText.slice(0, max)); setDirty(); renderForm(); fitPreview();
        });
        doc.addEventListener('focusin', event => {
          const path = event.target.dataset.resumeField;
          if (path) { activeSection = path.startsWith('media.') ? 'images' : path.split('.')[0]; syncTabs(); renderForm(); }
        });
        doc.addEventListener('click', event => { if (event.target.closest('.resume-portrait, .resume-work-image img')) { activeSection='images';syncTabs();renderForm(); } });
        doc.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveAction(); } });
        doc.addEventListener('paste', event => {
          if (!event.target.dataset.resumeField) return;
          event.preventDefault(); const text = event.clipboardData.getData('text/plain');
          const selection = doc.getSelection(); if (!selection.rangeCount) return;
          const range = selection.getRangeAt(0); range.deleteContents(); const node = doc.createTextNode(text); range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection.removeAllRanges(); selection.addRange(range);
          event.target.dispatchEvent(new Event('input', { bubbles: true }));
        });
        fitPreview();
      };
      frame.srcdoc = document;
    } catch (error) { if (alive) toast(error.message, true); }
  }
  function fitPreview() {
    if (!alive) return;
    const viewport = container.querySelector('.paper-viewport');
    const frame = container.querySelector('#resume-preview');
    const sheet = frame?.contentDocument?.querySelector('.resume-sheet');
    if (!viewport || !sheet) return;
    const scale = zoom === 'fit' ? Math.min(1, Math.max(.25, (viewport.clientWidth - 40) / 794)) : Number(zoom);
    frame.style.width = '794px'; frame.style.height = Math.ceil(sheet.scrollHeight) + 'px'; frame.style.transform = `scale(${scale})`;
    const stage = container.querySelector('.paper-stage'); stage.style.width = 794 * scale + 'px'; stage.style.height = Math.ceil(sheet.scrollHeight * scale) + 'px';
    container.querySelector('#paper-size').textContent = 'A4 · 实际分页以打印预览为准';
  }
  function queuePreview() { cancelAnimationFrame(previewFrame); previewFrame = requestAnimationFrame(updatePreview); }
  function renderForm() {
    const form = container.querySelector('#section-form'); form.innerHTML = sectionForm();
    if (activeSection === 'images') wireImages(form);
    form.oninput = event => {
      if (!event.target.dataset.field) return;
      set(event.target.dataset.field, event.target.value); setDirty(); queuePreview();
    };
    form.querySelector('#add-entry')?.addEventListener('click', () => {
      if (resume.data[activeSection].length >= 20) return toast('每类最多保存 20 条经历。', true);
      resume.data[activeSection].push(Object.fromEntries(fields[activeSection].map(([key]) => [key, '']))); setDirty(); renderForm(); queuePreview();
    });
    form.querySelectorAll('[data-remove-entry]').forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.removeEntry);
      if (Object.values(resume.data[activeSection][index]).some(Boolean) && !confirm('移除这条经历？保存后可通过历史版本恢复。')) return;
      resume.data[activeSection].splice(index, 1); setDirty(); renderForm(); queuePreview();
    }));
  }

  function imageForm() {
    const {portrait,gallery}=resume.data.media;
    return `<div class="image-section"><div class="image-heading"><strong>简历头像</strong><span>可选 · 随模板自动排版</span></div><div class="portrait-upload-row"><div class="portrait-upload-preview">${portrait.src ? `<img src="${portrait.src}" alt="已上传的简历头像">` : '<span>PHOTO<br>上传头像</span>'}</div><div><label class="button button-primary button-small image-upload-button">${portrait.src ? '更换头像' : '选择头像'}<input type="file" id="portrait-file" accept="image/jpeg,image/png,image/webp" ${imageBusy?'disabled':''}></label>${portrait.src ? '<button class="text-link danger-link" id="remove-portrait" type="button">移除头像</button>' : ''}<p>JPG / PNG / WebP，单张不超过 8 MB。自动压缩后存入简历。</p></div></div>${portrait.src ? `<div class="photo-controls"><label>显示头像<input type="checkbox" id="photo-visible" ${portrait.visible?'checked':''}></label><label>照片形状<select id="photo-shape">${[['auto','跟随模板'],['circle','圆形'],['rounded','圆角证件照'],['square','方形证件照']].map(([v,label]) => `<option value="${v}" ${portrait.shape===v?'selected':''}>${label}</option>`).join('')}</select></label><label>显示方式<select id="photo-fit"><option value="cover" ${portrait.fit==='cover'?'selected':''}>填满相框</option><option value="contain" ${portrait.fit==='contain'?'selected':''}>完整显示</option></select></label><label>左右位置<input type="range" id="photo-x" min="0" max="100" value="${portrait.x}"></label><label>上下位置<input type="range" id="photo-y" min="0" max="100" value="${portrait.y}"></label></div>` : ''}<div class="image-heading"><strong>作品 / 证书配图</strong><span>${gallery.length} / ${GALLERY_LIMIT} 张</span></div><p class="image-note">在简历末尾添加作品图片，可在“排版与模块”中移动或隐藏整个模块。</p><div class="work-image-list">${gallery.map((item,index)=>`<article><img src="${item.src}" alt="作品图 ${index+1}"><label class="field"><span>图片说明</span><input data-field="media.gallery.${index}.caption" maxlength="300" value="${e(item.caption)}" placeholder="例如：项目界面、设计作品、证书"></label><div class="button-row"><button class="text-link" data-image-move="${index}" data-delta="-1" ${index===0?'disabled':''}>上移</button><button class="text-link" data-image-move="${index}" data-delta="1" ${index===gallery.length-1?'disabled':''}>下移</button><button class="text-link danger-link" data-image-remove="${index}">移除</button></div></article>`).join('')}</div><label class="button button-dashed image-upload-button">＋ 添加作品图片<input type="file" id="gallery-files" multiple accept="image/jpeg,image/png,image/webp" ${imageBusy||gallery.length>=GALLERY_LIMIT?'disabled':''}></label><p class="image-note">图片可撤销、替换，随简历版本与 PDF / HTML / JSON 一起保存和导出。AI 润色只发送文字段落。</p></div>`;
  }
  function wireImages(form) {
    const upload = async (event, portrait) => {
      const input=event.target,files=[...input.files]; if (!files.length || imageBusy) return;
      if (!portrait && resume.data.media.gallery.length+files.length>GALLERY_LIMIT) { input.value=''; return toast('作品图最多3张，请减少所选文件。',true); }
      imageBusy=true;input.disabled=true; const targetData=resume.data;
      try {
        toast('正在本地处理图片…');const pictures=[];
        for (const file of files.slice(0,portrait?1:GALLERY_LIMIT)) pictures.push(await prepareResumeImage(file,portrait));
        if (!alive) return;
        if (resume.data!==targetData) return toast('简历内容已切换，请重新选择图片。');
        if (portrait) Object.assign(resume.data.media.portrait,{src:pictures[0],visible:true,x:50,y:50});
        else resume.data.media.gallery.push(...pictures.map((src,index)=>({src,caption:files[index].name.replace(/\.[^.]+$/,'').slice(0,300)})));
        setDirty();queuePreview();toast(local?'图片已加入草稿，存入账号后持久保存。':'图片已加入，请保存简历。');
      } catch(error) { if(alive) toast(error.message,true); }
      finally { imageBusy=false; if(alive) renderForm(); }
    };
    form.querySelector('#portrait-file')?.addEventListener('change', event=>upload(event,true));
    form.querySelector('#gallery-files')?.addEventListener('change', event=>upload(event,false));
    form.querySelector('#remove-portrait')?.addEventListener('click',()=>{resume.data.media.portrait.src='';setDirty();renderForm();queuePreview();});
    for (const key of ['visible','shape','fit','x','y']) form.querySelector('#photo-'+key)?.addEventListener('change',event=>{resume.data.media.portrait[key]=key==='visible'?event.target.checked:['x','y'].includes(key)?Number(event.target.value):event.target.value;setDirty();queuePreview();});
    form.querySelectorAll('[data-image-remove]').forEach(button=>button.addEventListener('click',()=>{resume.data.media.gallery.splice(Number(button.dataset.imageRemove),1);setDirty();renderForm();queuePreview();}));
    form.querySelectorAll('[data-image-move]').forEach(button=>button.addEventListener('click',()=>{const index=Number(button.dataset.imageMove),to=index+Number(button.dataset.delta),list=resume.data.media.gallery;[list[index],list[to]]=[list[to],list[index]];setDirty();renderForm();queuePreview();}));
  }
  async function save() {
    if (saving) throw new Error('正在保存，请稍候。');
    if (local) { cacheDraft(); if (!draftStored) throw new Error('浏览器草稿保存失败，请导出 JSON 或存入账号。'); dirty = false; status(); return resume; }
    if (!dirty) return resume;
    saving = true; status();
    const savingGeneration = generation;
    const draft = structuredClone(resume);
    try {
      const updated = await api('/resumes/' + resume.id, { method: 'PUT', data: { title: draft.title, template: draft.template, data: draft.data, revision: draft.revision } });
      if (savingGeneration === generation) { resume = updated; dirty = false; }
      else { resume.revision = updated.revision; resume.updated_at = updated.updated_at; }
      onSaved(updated); return updated;
    } finally { saving = false; status(); }
  }
  async function saveAction() { try { await save(); toast(local ? '草稿已保存在当前浏览器会话。' : '简历已保存到数据库。'); } catch (err) { toast(err.message, true); } }

  async function versionHistory() {
    const versions = await api('/resumes/' + resume.id + '/versions');
    dialog('简历版本记录', `<p class="modal-description">恢复会生成新版本，不会删除后续历史。</p><div class="version-list">${versions.map(v => `<div class="version-row"><span class="version-number">V${v.revision}</span><div><strong>${e(v.title)}</strong><small>${e(v.reason)} · ${time(v.created_at)}</small></div><button class="button button-small button-soft" data-restore="${v.revision}" ${v.revision === resume.revision ? 'disabled' : ''}>${v.revision === resume.revision ? '当前版本' : '恢复'}</button></div>`).join('')}</div>`, el => {
      el.querySelectorAll('[data-restore]').forEach(btn => btn.addEventListener('click', async () => {
        if (dirty && !confirm('当前有未保存修改。确定用这个历史版本替换编辑区？')) return;
        btn.disabled = true;
        try {
          resume = await api('/resumes/' + resume.id + '/restore', { method: 'POST', data: { currentRevision: resume.revision, revision: Number(btn.dataset.restore) } });
          dirty = false; render(); el.close(); toast('已恢复，并保留为新版本。'); onSaved(resume);
        } catch (err) { btn.disabled = false; toast(err.message, true); }
      }));
    });
  }
  async function showPolish() {
    if (local) { toast('先点击“存入我的简历”，再使用已连接的 AI 服务润色。'); return; }
    const [settings, applications] = await Promise.all([api('/settings/ai'), api('/applications')]);
    if (!settings.configured) {
      dialog('先连接 AI 服务', '<p class="modal-description">在设置中填写你的 API 密钥（可选 DeepSeek 或任意 OpenAI 兼容接口）。密钥保存在后端，页面不会回显；配置后即可润色真实经历。</p><a class="button button-primary" href="#/settings" id="go-settings">前往设置 →</a>', el => el.querySelector('#go-settings').addEventListener('click', () => el.close())); return;
    }
    const options = [];
    if (resume.data.basics.summary) options.push(['basics.summary', '个人简介']);
    for (const section of ['education', 'experience', 'projects']) resume.data[section].forEach((item, index) => { if (item.details) options.push([`${section}.${index}.details`, `${sectionLabels[section]} · ${item.school || item.company || item.name || index + 1}`]); });
    if (resume.data.skills) options.push(['skills', '专业技能']); if (resume.data.awards) options.push(['awards', '荣誉证书']);
    if (!options.length) { toast('先填写个人简介或一段真实经历，再使用 AI 润色。', true); return; }
    const preferred = options.find(([path]) => path.startsWith(activeSection))?.[0] || options[0][0];
    const uniqueJobs = [...new Map(applications.map(a => [a.job.id, a.job])).values()];
    dialog('AI 润色这一段', `<div id="polish-content"><p class="modal-description">围绕真实经历优化表达。不会自动发送姓名、手机、邮箱，也不会直接覆盖简历。</p><form id="polish-form"><label class="field"><span>选择模块</span><select name="field">${options.map(([value, label]) => `<option value="${e(value)}" ${value === preferred ? 'selected' : ''}>${e(label)}</option>`).join('')}</select></label><label class="field"><span>目标岗位（来自我的投递）</span><select name="jobId"><option value="">不指定岗位</option>${uniqueJobs.map(j => `<option value="${e(j.id)}">${e(j.company)} · ${e(j.title)}</option>`).join('')}</select></label><label class="field"><span>润色方向</span><select name="tone"><option value="professional">表达更专业、清晰</option><option value="concise">精简重复，突出重点</option><option value="star">围绕情境、行动、结果组织</option></select></label><div class="original-preview"><span>即将发送的原文</span><p id="polish-original">${e(get(preferred))}</p></div><label class="consent"><input type="checkbox" name="consent" required><span>同意将这段文字及所选岗位要求发送给所选 AI 服务商。若段落含个人敏感信息，请先删去。调用可能消耗你的 API 余额。</span></label><div class="modal-actions"><span class="muted">${e(settings.model)}</span><button class="button button-primary" type="submit">${icon('ai')} ${dirty ? '先保存，再润色' : '开始润色'}</button></div><p class="form-error" role="alert"></p></form></div>`, el => {
      const form = el.querySelector('form');
      form.elements.field.addEventListener('change', () => { el.querySelector('#polish-original').textContent = get(form.elements.field.value); });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        const btn = form.querySelector('button[type=submit]'); btn.disabled = true; btn.textContent = 'AI 正在润色…'; form.querySelector('.form-error').textContent = '';
        try {
          await save();
          const report = await api('/ai/polish', { method: 'POST', data: { resumeId: resume.id, revision: resume.revision, field: values.field, jobId: values.jobId || null, tone: values.tone, consent: values.consent === 'on' } });
          if (!alive || !el.open) { toast('润色完成，可在 AI 记录中查看。'); return; }
          el.querySelector('#polish-content').innerHTML = `<div class="polish-comparison"><section><h3>原文 · V${report.resume_revision}</h3><p>${e(report.original)}</p></section><section class="revised-text"><h3>润色建议</h3><p>${e(report.revised)}</p></section></div><div class="ai-reasons"><h3>为什么这样改</h3><ul>${report.changes.map(s => `<li>${e(s)}</li>`).join('')}</ul>${report.questions.length ? `<h3>建议你补充的事实</h3><ul>${report.questions.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>${report.match ? `<div class="ai-reasons"><h3>岗位匹配分析 · ${report.match.score} 分</h3>${report.match.advice ? `<p>${e(report.match.advice)}</p>` : ''}${report.match.matched.length ? `<h3>简历已具备</h3><ul>${report.match.matched.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}${report.match.missing.length ? `<h3>岗位要求但尚未体现</h3><ul>${report.match.missing.map(s => `<li>${e(s)}</li>`).join('')}</ul>` : ''}</div>` : ''}<p class="modal-description">请核对数字、经历与职责。采纳后生成新版本，原版本仍可恢复。</p><div class="modal-actions"><button class="button button-soft" id="copy-revised">复制建议</button><button class="button button-primary" id="apply-revised">采纳到简历 ${icon('check')}</button></div>`;
          el.querySelector('#copy-revised').addEventListener('click', async () => { try { await navigator.clipboard.writeText(report.revised); toast('已复制。'); } catch { toast('请选中润色文本后手动复制。', true); } });
          el.querySelector('#apply-revised').addEventListener('click', async event => {
            event.currentTarget.disabled = true;
            try { await save(); resume = await api('/ai/reports/' + report.id + '/apply', { method: 'POST', data: { revision: resume.revision } }); dirty = false; render(); el.close(); onSaved(resume); toast('已采纳，保存为 V' + resume.revision); }
            catch (err) { toast(err.message, true); if (el.open) el.querySelector('#apply-revised').disabled = false; }
          });
        } catch (err) { if (el.open && form.isConnected) { form.querySelector('.form-error').textContent = err.message; btn.disabled = false; btn.textContent = '重新润色'; } else toast(err.message, true); }
      });
    }, 'modal-wide');
  }

  function syncTabs() { container.querySelectorAll('[data-section]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.section === activeSection))); }
  function starter() {
    dialog('用真实资料生成初稿', `<p class="modal-description">填写后自动排版，已有经历会保留。你可以随后在纸面或左侧继续编辑。</p><form id="starter-form"><div class="form-grid">${[['name','姓名'],['headline','求职方向'],['email','邮箱'],['phone','电话']].map(([key,label]) => `<label class="field"><span>${label}</span><input name="${key}" maxlength="300" value="${e(resume.data.basics[key])}" ${key === 'name' ? 'required' : ''}></label>`).join('')}<label class="field"><span>学校</span><input name="school" maxlength="300" value="${e(resume.data.education[0]?.school || '')}"></label><label class="field"><span>专业</span><input name="major" maxlength="300" value="${e(resume.data.education[0]?.major || '')}"></label><label class="field field-wide"><span>个人简介 / 求职优势</span><textarea name="summary" rows="3" maxlength="6000">${e(resume.data.basics.summary)}</textarea></label><label class="field field-wide"><span>专业技能</span><textarea name="skills" rows="3" maxlength="8000">${e(resume.data.skills)}</textarea></label></div><div class="modal-actions"><button class="button button-primary" type="submit">生成可编辑简历 →</button></div></form>`, el => {
      el.querySelector('form').addEventListener('submit', event => {
        event.preventDefault(); const values = Object.fromEntries(new FormData(event.currentTarget));
        for (const key of ['name','headline','email','phone','summary']) resume.data.basics[key] = values[key];
        resume.data.skills = values.skills;
        if (values.school || values.major) {
          resume.data.education[0] ||= { school: '', degree: '', major: '', start: '', end: '', details: '' };
          Object.assign(resume.data.education[0], { school: values.school, major: values.major });
        }
        if (resume.title === '我的校招简历') resume.title = `${values.name} · ${values.headline || '校招简历'}`;
        setDirty(); render(); el.close(); toast('初稿已生成，继续补充你的真实经历。');
      });
    }, 'modal-wide');
  }
  function layoutPanel() {
    const d = resume.data.design, template = templates.find(t => t.id === resume.template) || templates[0];
    return `<details class="studio-design"><summary>排版与模块 <span>颜色 · 字号 · 顺序</span></summary><div class="design-controls"><label>主题色<input id="design-accent" type="color" value="${d.accent || template.accent}"></label><label>字号<select id="design-font">${[9,10,11,12,13].map(v => `<option value="${v}" ${d.fontSize === v ? 'selected' : ''}>${v} pt</option>`).join('')}</select></label><label>行距<select id="design-leading">${[1.3,1.5,1.65,1.8,2].map(v => `<option value="${v}" ${d.lineHeight === v ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>段间距<input id="design-spacing" type="range" min="10" max="28" value="${d.spacing}"></label></div><div class="studio-order">${d.order.map((key,index) => `<div><label><input type="checkbox" data-visible="${key}" ${d.hidden.includes(key) ? '' : 'checked'}>${key === 'summary' ? '个人简介' : key === 'images' ? '作品展示' : sectionLabels[key]}</label><button type="button" data-order="${key}" data-delta="-1" aria-label="上移${key}" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-order="${key}" data-delta="1" aria-label="下移${key}" ${index === d.order.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div><button id="reset-design" class="text-link" type="button">恢复默认排版</button></details>`;
  }
  function render() {
    observer?.disconnect();
    resume.data.design = normalizeDesign(resume.data.design, resume.template);
    resume.data.media = normalizeMedia(resume.data.media);
    lastSnapshot = snapshot();
    const selected = templates.find(t => t.id === resume.template) || templates[0];
    container.innerHTML = `<div class="editor-page studio-page"><div class="studio-banner"><span>RESUME STUDIO / 简历工作室</span><p>写下经历，让每一页都更接近下一份机会。</p><a href="#/templates">浏览模板 ↗</a></div><div class="editor-heading"><div><a class="back-link" href="#/resumes">← 简历中心</a><div class="editor-title-line"><input class="title-input" id="resume-title" aria-label="简历名称" value="${e(resume.title)}" maxlength="100"><span class="save-state" id="save-state"></span></div></div><div class="editor-actions"><button class="button button-soft button-small" id="starter">快速生成</button>${!local ? '<button class="button button-soft button-small" id="resume-history">版本记录</button>' : ''}<button class="button button-soft button-small" id="resume-ai">${icon('ai')} AI 润色</button><button class="button button-primary button-small" id="save-resume">${local ? '保存草稿' : '保存简历'} ${icon('check')}</button>${local ? '<button class="button button-primary button-small" id="save-account">存入我的简历 ↗</button>' : ''}</div></div><div class="studio-commandbar"><div><button class="button button-soft button-small" id="editor-undo">↶ 撤销</button><button class="button button-soft button-small" id="editor-redo">↷ 重做</button><span>直接点击纸面文字编辑</span></div><div><button class="text-link" id="import-draft">导入 JSON</button><button class="text-link" id="export-json">导出 JSON</button><button class="text-link" id="export-html">导出网页</button><button class="button button-primary button-small" id="print-resume">导出 PDF / 打印</button></div></div><div class="editor-layout"><section class="editor-form-panel"><div class="editor-form-top"><strong>内容与排版</strong><span>左侧填写，也可以直接编辑右侧文字</span></div><div class="editor-section-tabs" role="tablist" aria-label="简历模块">${Object.entries(sectionLabels).map(([key,label]) => `<button role="tab" aria-selected="${key === activeSection}" data-section="${key}">${label}</button>`).join('')}</div><div id="section-form"></div>${layoutPanel()}<div class="editor-help">空白模块不导出。隐藏模块保留内容，重新勾选即可恢复。</div></section><section class="editor-preview-panel"><div class="preview-toolbar"><label><span>模板</span><select id="template-select">${templates.map(t => `<option value="${t.id}" ${resume.template === t.id ? 'selected' : ''}>${e(t.name)}</option>`).join('')}</select></label><label><span>缩放</span><select id="preview-zoom">${[['fit','适应宽度'],['.75','75%'],['1','100%']].map(([v,label]) => `<option value="${v}" ${zoom === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label></div><div class="paper-viewport studio-viewport"><div class="paper-stage"><iframe id="resume-preview" title="可编辑简历 A4 预览" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></div></div><div class="studio-preview-footer"><span id="paper-size">A4 · 正在排版</span><span>${selected.source ? `<a href="${selected.source}" target="_blank" rel="noopener noreferrer">${selected.collection ? 'ResumeCollection · '+selected.number : selected.license+' 开源模板'} · 网页适配 ↗</a>` : 'Offerbiu 原创排版'}</span></div></section></div><input id="studio-import-file" type="file" accept="application/json,.json" hidden></div>`;
    container.querySelector('#resume-title').addEventListener('input', event => { resume.title = event.target.value; setDirty(); });
    container.querySelector('#template-select').addEventListener('change', event => { resume.template = event.target.value; resume.data.design.accent = ''; setDirty(); render(); });
    container.querySelectorAll('[data-section]').forEach(button => button.addEventListener('click', () => { activeSection = button.dataset.section; syncTabs(); renderForm(); }));
    container.querySelector('#save-resume').addEventListener('click', saveAction);
    container.querySelector('#save-account')?.addEventListener('click', () => options.onSaveAccount?.(snapshot()));
    container.querySelector('#starter').addEventListener('click', starter);
    container.querySelector('#editor-undo').addEventListener('click', () => historyStep());
    container.querySelector('#editor-redo').addEventListener('click', () => historyStep(true));
    container.querySelector('#resume-ai').addEventListener('click', () => showPolish().catch(err => toast(err.message, true)));
    container.querySelector('#resume-history')?.addEventListener('click', () => versionHistory().catch(err => toast(err.message, true)));
    container.querySelector('#preview-zoom').addEventListener('change', event => { zoom = event.target.value; fitPreview(); });
    for (const [id,key] of [['design-accent','accent'],['design-font','fontSize'],['design-leading','lineHeight'],['design-spacing','spacing']]) container.querySelector('#'+id).addEventListener('change', event => { resume.data.design[key] = key === 'accent' ? event.target.value : Number(event.target.value); setDirty(); queuePreview(); });
    container.querySelectorAll('[data-visible]').forEach(input => input.addEventListener('change', () => { const hidden = new Set(resume.data.design.hidden); input.checked ? hidden.delete(input.dataset.visible) : hidden.add(input.dataset.visible); resume.data.design.hidden = [...hidden]; setDirty(); queuePreview(); }));
    container.querySelectorAll('[data-order]').forEach(button => button.addEventListener('click', () => { const order = resume.data.design.order, index = order.indexOf(button.dataset.order), to = index + Number(button.dataset.delta); [order[index],order[to]] = [order[to],order[index]]; setDirty(); render(); container.querySelector('.studio-design').open = true; }));
    container.querySelector('#reset-design').addEventListener('click', () => { resume.data.design = normalizeDesign({},resume.template); setDirty(); render(); });
    container.querySelector('#export-json').addEventListener('click', () => downloadJson({ format: 'offerbiu-resume-v1', ...snapshot() }, (resume.title || '简历')+'.json'));
    container.querySelector('#export-html').addEventListener('click', async () => { try { const html = await resumeDocument(resume.data,resume.template,resume.title); const url = URL.createObjectURL(new Blob([html],{type:'text/html;charset=utf-8'})); const a = document.createElement('a'); a.href = url; a.download = (resume.title || '简历')+'.html'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); } catch (error) { toast(error.message,true); } });
    container.querySelector('#print-resume').addEventListener('click', () => { try { if (!resumeText(resume.data)) return toast('先填写简历内容再导出。',true); printResume(resume.data,resume.template,resume.title); } catch(error) { toast(error.message,true); } });
    container.querySelector('#import-draft').addEventListener('click', () => container.querySelector('#studio-import-file').click());
    container.querySelector('#studio-import-file').addEventListener('change', async event => {
      const file = event.target.files?.[0]; if (!file) return;
      try {
        if (file.size > RESUME_FILE_LIMIT) throw new Error('含图片的简历 JSON 需小于 2 MB。');
        const draft = JSON.parse(await file.text());
        if (draft.format !== 'offerbiu-resume-v1' || !draft.data?.basics || !['education','experience','projects'].every(k => Array.isArray(draft.data[k]))) throw new Error('请选择本工作台导出的 JSON 简历。');
        const text = value => typeof value === 'string' ? value : '';
        const data = { basics: Object.fromEntries(['name','headline','email','phone','city','website','summary'].map(k => [k,text(draft.data.basics[k]).slice(0,k==='summary'?6000:300)])), skills:text(draft.data.skills).slice(0,8000),awards:text(draft.data.awards).slice(0,8000) };
        for (const key of ['education','experience','projects']) data[key] = draft.data[key].slice(0,20).map(item => Object.fromEntries(fields[key].map(([name]) => [name,text(item?.[name]).slice(0,name==='details'?12000:300)])));
        if (draft.data.media?.portrait?.src && !safeImageData(draft.data.media.portrait.src,PORTRAIT_BYTES)) throw new Error('导入头像格式不正确或超过180 KB。');
        if (draft.data.media?.gallery && (!Array.isArray(draft.data.media.gallery) || draft.data.media.gallery.length > GALLERY_LIMIT || draft.data.media.gallery.some(item=>!safeImageData(item?.src)))) throw new Error('导入作品图片无效，最多3张，每张300 KB以内。');
        data.media = normalizeMedia(draft.data.media);
        resume.template = templates.some(t => t.id === draft.template) ? draft.template : 'classic'; data.design = normalizeDesign(draft.data.design,resume.template); resume.title = text(draft.title).slice(0,100)||'导入的简历'; resume.data=data; setDirty(); render(); toast('已导入编辑区，可撤销本次替换。');
      } catch(error) { toast(error.message,true); }
    });
    renderForm(); updatePreview(); status();
    if ('ResizeObserver' in window) { observer = new ResizeObserver(fitPreview); observer.observe(container.querySelector('.editor-preview-panel')); }
  }
  render();
  return { get dirty() { return dirty && (!local || !draftStored); }, get id() { return resume.id; }, get route() { return local ? '/studio/' + (initial.template || 'classic') : '/resume/' + resume.id; }, markSaved() { dirty = false; }, destroy() { alive = false; observer?.disconnect(); cancelAnimationFrame(previewFrame); } };
}
