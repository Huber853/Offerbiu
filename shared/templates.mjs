export const templates = [
  { id: 'classic', name: '经典蓝', tag: '通用 / 产品 / 运营', description: '蓝色章节线与清晰信息层级，适合大多数校招岗位。', accent: '#365cf5' },
  { id: 'minimal', name: '极简黑白', tag: '打印 / 职能 / 金融', description: '纯黑白、单栏排版，减少视觉干扰，突出经历本身。', accent: '#182238' },
  { id: 'technical', name: '技术清晰版', tag: '研发 / 算法 / 数据', description: '项目经历前置，以清晰的结构展示技术能力与贡献。', accent: '#157e78' },
  { id: 'even', name: 'Even · 留白叙事', tag: '产品 / 数据 / 通用', description: '浅灰抬头、侧边章节标题与宽松留白，中文 A4 适配版。', accent: '#0073aa', source: 'https://github.com/rbardini/jsonresume-theme-even', author: 'Rafael Bardini', license: 'MIT' },
  { id: 'class', name: 'Class · 蓝调名片', tag: '市场 / 运营 / 商务', description: '深蓝姓名区搭配清晰的经历层级，中文 A4 适配版。', accent: '#13509b', source: 'https://github.com/jsonresume/jsonresume-theme-class', author: 'James Spencer / JSON Resume Contributors', license: 'MIT' },
  { id: 'classy', name: 'Classy · 经典刊物', tag: '职能 / 咨询 / 金融', description: '居中姓名、克制的黑白章节与编辑式排版，中文 A4 适配版。', accent: '#333333', source: 'https://github.com/JaredCubilla/jsonresume-theme-classy', author: 'Jared Cubilla', license: 'MIT' },
  ...[
    ['004','collection-coral','珊瑚红 · 人物名片','运营 / 商务 / 应届生','#ef6262','coral','circle','浅灰侧栏、环形头像与珊瑚红章节，突出人物和经历。'],
    ['005','collection-navy','海军蓝 · 专业双栏','市场 / 产品 / 管理','#23465f','navy','square','深蓝信息侧栏、方形照片和细线章节，清晰区分个人信息与经历。'],
    ['018','collection-slate','石墨灰 · 产品档案','产品 / 项目 / 咨询','#354251','slate','circle','石墨色边线、居中头像与灰色信息分区，强调项目履历。'],
    ['022','collection-jade','宝石绿 · 清爽双栏','职能 / 教育 / 通用','#29b280','jade','circle','绿色标题、圆形头像与浅灰侧栏，适合清晰温和的个人表达。'],
    ['023','collection-mist','雾蓝 · 细线履历','研发 / 设计 / 应届生','#729aa6','mist','square','取原版雾蓝边框与双线章节，简化装饰，保留宽阔单栏内容。'],
  ].map(([number,id,name,tag,accent,layout,photoShape,description]) => ({id,name,tag,accent,layout,photoShape,description,
    source:'https://github.com/mmmlllnnn/ResumeCollection/tree/main/'+encodeURIComponent('1.中文简历')+'/'+number,
    author:'ResumeCollection / mln',license:'MIT（仓库声明）',collection:true,number,
    licenseUrl:'/assets/resume-templates/collection/LICENSE',reference:'/assets/resume-templates/collection/'+number+'/reference.jpg'})),
];

export const resumeSections = ['summary', 'education', 'experience', 'projects', 'skills', 'awards', 'images'];
export function normalizeDesign(value = {}, template = 'classic') {
  const safe = value && typeof value === 'object' ? value : {};
  const bound = (x, fallback, min, max) => Number.isFinite(Number(x)) ? Math.min(max, Math.max(min, Number(x))) : fallback;
  const defaults = template === 'technical' ? ['summary', 'education', 'projects', 'experience', 'skills', 'awards', 'images'] : resumeSections;
  return { accent: /^#[0-9a-f]{6}$/i.test(safe.accent) ? safe.accent : '', fontSize: bound(safe.fontSize, 10, 9, 13),
    lineHeight: bound(safe.lineHeight, 1.65, 1.3, 2), spacing: bound(safe.spacing, 18, 10, 28),
    order: [...new Set([...(Array.isArray(safe.order) ? safe.order.filter(s => resumeSections.includes(s)) : []), ...defaults])],
    hidden: Array.isArray(safe.hidden) ? [...new Set(safe.hidden.filter(s => resumeSections.includes(s)))] : [] };
}

export function sampleResume() {
  const data = blankResume();
  data.basics = { name: '你的姓名', headline: '目标岗位 · 2027 届', email: 'name@example.com', phone: '联系号码', city: '意向城市', website: '', summary: '用一两句话概括与你的目标岗位相关的真实能力、经验与求职方向。此内容仅作模板排版示例。' };
  data.education = [{ school: '你的学校', degree: '本科', major: '所学专业', start: '入学时间', end: '毕业时间', details: '填写与你求职方向相关的课程、成绩或学习成果。' }];
  data.experience = [{ company: '实习单位 / 组织', role: '岗位名称', start: '开始时间', end: '结束时间', details: '• 工作背景：描述你参与的具体任务。\n• 个人行动：写清楚你采取的方法与承担的职责。\n• 工作成果：填写有依据的结果或反馈。' }];
  data.projects = [{ name: '项目名称', role: '你的角色', start: '开始时间', end: '结束时间', details: '介绍项目目标、使用的工具、个人贡献与可验证的成果。' }];
  data.skills = '专业技能 · 工具与方法\n语言能力 · 真实熟练程度'; data.awards = '奖项 / 证书名称 · 获得时间';
  return data;
}

export function blankResume() {
  return {
    basics: { name: '', headline: '', email: '', phone: '', city: '', website: '', summary: '' },
    education: [{ school: '', degree: '', major: '', start: '', end: '', details: '' }],
    experience: [{ company: '', role: '', start: '', end: '', details: '' }],
    projects: [{ name: '', role: '', start: '', end: '', details: '' }],
    skills: '', awards: '',
  };
}

export const sectionLabels = { basics: '基本信息', education: '教育经历', experience: '实习 / 工作', projects: '项目经历', skills: '专业技能', awards: '荣誉证书', images: '头像 / 作品图' };

export function resumeText(data, includeContacts = true) {
  const d = data || blankResume();
  const lines = [];
  if (includeContacts) lines.push([d.basics?.name, d.basics?.headline, d.basics?.email, d.basics?.phone, d.basics?.city, d.basics?.website].filter(Boolean).join(' | '));
  else if (d.basics?.headline) lines.push('求职方向：' + d.basics.headline);
  if (d.basics?.summary) lines.push('个人简介\n' + d.basics.summary);
  for (const key of ['education', 'experience', 'projects']) {
    for (const item of d[key] || []) {
      const heading = [item.school || item.company || item.name, item.degree, item.major || item.role, [item.start, item.end].filter(Boolean).join(' — ')].filter(Boolean).join(' | ');
      if (heading || item.details) lines.push(sectionLabels[key] + '\n' + heading + '\n' + (item.details || ''));
    }
  }
  if (d.skills) lines.push('专业技能\n' + d.skills);
  if (d.awards) lines.push('荣誉证书\n' + d.awards);
  return lines.join('\n\n').trim();
}

export const statuses = [
  { id: 'saved', label: '待投递', color: 'slate' }, { id: 'applied', label: '已投递', color: 'blue' },
  { id: 'assessment', label: '笔试中', color: 'amber' }, { id: 'interview', label: '面试中', color: 'purple' },
  { id: 'offer', label: '已获 Offer', color: 'green' }, { id: 'closed', label: '已结束', color: 'slate' },
];
