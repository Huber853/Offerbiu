import { escape } from './ui.js';
import { templates, normalizeDesign } from '/shared/templates.mjs';
import { normalizeMedia } from '/shared/resume-media.mjs';

function field(value, path, tag, cls, edit, placeholder = '') {
  return `<${tag} class="${cls}"${edit ? ` contenteditable="plaintext-only" data-resume-field="${path}" data-placeholder="${placeholder}" aria-label="${placeholder || path}" spellcheck="false"` : ''}>${escape(value || '')}</${tag}>`;
}
function section(key, title, body) { return body ? `<section class="resume-section" data-resume-section="${key}"><h2 class="resume-section-title">${title}</h2><div class="resume-section-content">${body}</div></section>` : ''; }
function entries(items, kind, edit) {
  return (items || []).map((item, index) => {
    if (!Object.values(item).some(Boolean)) return '';
    const key = kind === 'education' ? 'school' : kind === 'experience' ? 'company' : 'name';
    const path = `${kind}.${index}.`;
    const sub = kind === 'education'
      ? ['degree','major'].filter(key => edit || item[key]).map(key => field(item[key], path + key, 'span', '', edit, key === 'degree' ? '学历' : '专业')).join(' · ')
      : field(item.role, path + 'role', 'span', '', edit, '角色');
    const dates = ['start','end'].filter(key => edit || item[key]).map(key => field(item[key],path + key,'span','',edit,key === 'start' ? '开始时间' : '结束时间')).join(' — ');
    return `<div class="resume-entry"><div class="resume-entry-heading">${field(item[key], path + key, 'strong', '', edit, '名称')}${dates ? `<time>${dates}</time>` : ''}</div>${sub ? `<div class="resume-entry-sub">${sub}</div>` : ''}${item.details || edit ? field(item.details, path + 'details', 'p', 'resume-body-copy', edit, '填写具体行动与成果') : ''}</div>`;
  }).join('');
}
export function resumeMarkup(data, template = 'classic', preview = true, options = {}) {
  const selected = templates.find(t => t.id === template) || templates[0];
  const design = normalizeDesign(data.design, selected.id), basics = data.basics || {};
  const media = normalizeMedia(data.media);
  const contact = ['phone', 'email', 'city', 'website'].filter(key => basics[key]).map(key => field(basics[key], 'basics.' + key, 'span', '', preview)).join('');
  const blocks = {
    summary: section('summary', '个人简介', basics.summary ? field(basics.summary, 'basics.summary', 'p', 'resume-body-copy', preview) : ''),
    education: section('education', '教育经历', entries(data.education, 'education', preview)),
    experience: section('experience', '实习 / 工作经历', entries(data.experience, 'experience', preview)),
    projects: section('projects', '项目经历', entries(data.projects, 'projects', preview)),
    skills: section('skills', '专业技能', data.skills ? field(data.skills, 'skills', 'p', 'resume-body-copy', preview) : ''),
    awards: section('awards', '荣誉证书', data.awards ? field(data.awards, 'awards', 'p', 'resume-body-copy', preview) : ''),
    images: section('images','作品展示',media.gallery.map((item,index) => `<figure class="resume-work-image"><img src="${item.src}" alt="${escape(item.caption || '作品图片')}">${item.caption || preview ? field(item.caption,`media.gallery.${index}.caption`,'figcaption','resume-image-caption',preview,'为图片补充说明') : ''}</figure>`).join('')), 
  };
  const order = design.order.filter(key => !design.hidden.includes(key));
  const style = `--resume-accent:${design.accent || selected.accent};--resume-size:${design.fontSize}pt;--resume-leading:${design.lineHeight};--resume-gap:${design.spacing}px`;
  const shape = media.portrait.shape === 'auto' ? selected.photoShape || 'rounded' : media.portrait.shape;
  const photo = media.portrait.src && media.portrait.visible
    ? `<div class="resume-portrait portrait-${shape}"><img src="${media.portrait.src}" alt="简历头像" style="object-fit:${media.portrait.fit};object-position:${media.portrait.x}% ${media.portrait.y}%"></div>`
    : selected.collection && (preview || options.sample) && media.portrait.visible ? `<div class="resume-portrait portrait-${shape} portrait-placeholder" aria-label="头像位置"><span>上传头像</span></div>` : '';
  const identity = `<div class="resume-identity">${field(basics.name,'basics.name','h1','resume-name',preview,'你的姓名')}${basics.headline || preview ? field(basics.headline,'basics.headline','p','resume-headline',preview,'填写求职方向') : ''}</div>`;
  const contacts = `<div class="resume-contact">${contact}</div>`;
  const empty = preview ? '<p class="resume-placeholder">从左侧填写内容，或点击“快速生成”开始。已有文字可以直接在纸面上修改。</p>' : '';
  if (['coral','navy','slate','jade'].includes(selected.layout)) {
    const asideKeys = new Set(['skills']);
    const aside = order.filter(key => asideKeys.has(key)).map(key => blocks[key]).join('');
    const content = order.filter(key => !asideKeys.has(key)).map(key => blocks[key]).join('');
    return `<article class="resume-sheet resume-collection resume-template-${selected.id}" style="${style}"><div class="collection-ribbon" aria-hidden="true">PERSONAL RESUME</div><div class="collection-columns"><aside class="collection-sidebar">${photo}${selected.layout !== 'navy' ? identity : ''}${contacts}${aside}</aside><main class="collection-main">${selected.layout === 'navy' ? `<header class="resume-header">${identity}</header>` : ''}${content || empty}</main></div></article>`;
  }
  return `<article class="resume-sheet resume-template-${selected.id}" style="${style}"><header class="resume-header ${photo ? 'has-portrait' : ''}"><div>${identity}${contacts}</div>${photo}</header><div class="resume-body-content">${order.map(key => blocks[key]).join('') || empty}</div></article>`;
}
let cssPromise;
export async function resumeDocument(data, template, title, preview = false) {
  cssPromise ||= fetch('/workspace/resume.css').then(r => { if (!r.ok) throw new Error('模板样式加载失败'); return r.text(); }).catch(error => { cssPromise = null; throw error; });
  const css = await cssPromise;
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; form-action 'none'; base-uri 'none'"><title>${escape(title || '我的简历')}</title><style>html,body{margin:0;background:white}${css}</style></head><body>${resumeMarkup(data, template, preview)}</body></html>`;
}
export function printResume(data, template, title) {
  const popup = window.open('', '_blank');
  if (!popup) throw new Error('浏览器阻止了打印窗口，请允许此站点弹出窗口后重试。');
  popup.document.write(`<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escape(title || '我的简历')}</title><link rel="stylesheet" href="${location.origin}/workspace/resume.css"></head><body>${resumeMarkup(data, template, false)}</body></html>`);
  popup.document.close();
  popup.addEventListener('load', () => { popup.focus(); popup.print(); }, { once: true });
}
