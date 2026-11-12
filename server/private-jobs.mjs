import { db, transaction } from './db.mjs';
import { demand, id, now, sha256 } from './security.mjs';
import { normalizeText, countText, isCalendarDate, canonicalJson } from '../shared/job-workflow.mjs';
import { privatePayload, resolveJob } from './job-targets.mjs';
import { fetchPublicPage, publicUrl } from './private-job-fetch.mjs';

// Short-lived preview evidence preserves the actual input separately from editable
// fields, without creating a job before confirmation. It never grants official trust.
const previews=new Map();

const fields = {company:200,title:300,description:12000,requirements:12000,deadline:10,channel:100,source_url:2000,apply_url:2000,source_id:200,notes:3000,original_text:24000};
function string(value,max,trim=true) { demand(value == null || typeof value==='string',400,'文字字段格式不正确。'); const normalized=normalizeText(value||''),s=trim?normalized.trim():normalized; demand(countText(s)<=max&&!s.includes('\0'),400,'字段过长或包含无效字符。'); return s; }
function normalize(body) {
  demand(body&&typeof body==='object'&&!Array.isArray(body),400,'私人岗位格式不正确。');
  const result=Object.fromEntries(Object.entries(fields).map(([key,max])=>[key,string(body[key],max,key!=='original_text')]));
  demand(body.cities==null||Array.isArray(body.cities)&&body.cities.length<=20,400,'城市应为最多20项的列表。');
  result.cities=[...new Set((body.cities||[]).map(v=>string(v,80)).filter(Boolean))];
  result.cohort=body.cohort==null||body.cohort===''?null:Number(body.cohort);
  demand(result.cohort===null||Number.isInteger(result.cohort)&&result.cohort>=2000&&result.cohort<=2100,400,'届别需为年份或留空。');
  demand(!result.deadline||isCalendarDate(result.deadline),400,'截止日期需为有效日期或留空。');
  for(const key of ['source_url','apply_url']) if(result[key]) result[key]=publicUrl(result[key]).href;
  demand(result.company||result.title||result.source_url||result.apply_url||result.description||result.requirements||result.original_text,400,'请至少填写一个岗位字段、链接或原文。');
  demand(countText(result.description+'\n'+result.requirements)<=24000,400,'岗位正文总计最多24000字。');
  result.content_quality={level:result.description&&result.requirements?'complete':result.description||result.requirements?'partial':result.source_url||result.apply_url?'reference_only':'unknown',reason:'本人保存的私人资料，完整度按已填写字段判断；来源和适用性仍须核实。'};
  // Client and extraction outputs can never confer official evidence or trusted hard gates.
  result.eligibility_constraints=[];
  result.availability={state:'unknown',reason:'私人来源未经官方核验。'};
  return result;
}
export function normalizedUrl(value) {
  try { const u=new URL(value); for(const key of [...u.searchParams.keys()]) if(/^(utm_|spm$|from$|ref$|source$|tracking)/i.test(key)) u.searchParams.delete(key); u.searchParams.sort(); u.pathname=u.pathname.replace(/\/+$/,'')||'/'; return u.href; } catch {return '';}
}
const compact = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\s\p{P}]/gu,'');
export function duplicateJobs(userId, body, excludeId='') {
  const draft=normalize(body), urls=[draft.source_url,draft.apply_url].map(normalizedUrl).filter(Boolean);
  const candidates=db.prepare('SELECT * FROM private_jobs WHERE user_id=?').all(userId).map(privatePayload);
  // Public candidates are always identified as public; reuse never copies them to private storage.
  candidates.push(...db.prepare('SELECT payload FROM jobs WHERE catalog_active=1').all().map(r=>({...JSON.parse(r.payload),job_type:'public'})));
  return candidates.filter(j=>j.id!==excludeId).flatMap(job=>{
    const sources=job.sources||[], otherUrls=[job.source_url,job.apply_url,...sources.flatMap(s=>[s.source_url,s.apply_url])].map(normalizedUrl).filter(Boolean);
    // IDs belong to the listing source; a shared ATS apply host is not its namespace.
    const hosts=record=>{try{return [new URL(record.source_url||record.apply_url).hostname];}catch{return [];}};
    const sourceMatch=draft.source_id&&[{source_id:job.source_id||job.external_id,source_url:job.source_url,apply_url:job.apply_url},...sources]
      .some(record=>record.source_id===draft.source_id&&hosts(record).some(host=>hosts(draft).includes(host)));
    const strong=urls.some(url=>otherUrls.includes(url))||sourceMatch;
    const company=compact(draft.company), title=compact(draft.title), jc=compact(job.company), jt=compact(job.title);
    const weak=company&&title&&jc&&jt&&(company===jc||Math.min(company.length,jc.length)>=4&&(company.includes(jc)||jc.includes(company)))&&(title===jt||Math.min(title.length,jt.length)>=4&&(title.includes(jt)||jt.includes(title)))&&(!draft.cities.length||!job.cities?.length||draft.cities.some(c=>job.cities.some(d=>compact(c).replace(/市$/,'')===compact(d).replace(/市$/,''))));
    return strong||weak?[{id:job.id,company:job.company,title:job.title,cities:job.cities,job_type:job.job_type,archived_at:job.archived_at||null,strength:strong?'strong':'weak',reason:strong?'规范化链接或同来源岗位编号相同':'公司、职位和城市相近，请人工核对'}]:[];
  }).sort((a,b)=>Number(b.strength==='strong')-Number(a.strength==='strong')).slice(0,30);
}
const decode = value => value.replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const code=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return code>0&&code<=0x10ffff?String.fromCodePoint(code):'';}).replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&lt;/gi,'<').replace(/&gt;/gi,'>').replace(/&quot;/gi,'"').replace(/&#39;/g,"'");
export function extractText(original) {
  const result={original_text:original,company:'',title:'',cities:[],cohort:null,description:'',requirements:'',deadline:'',channel:'',source_url:'',apply_url:'',notes:'',source_id:''};
  let section=''; const body=[],requirements=[];
  const scalar={公司:'company',公司名称:'company',企业:'company',职位:'title',职位名称:'title',岗位:'title',岗位名称:'title',城市:'cities',工作地点:'cities',届别:'cohort',截止日期:'deadline',投递渠道:'channel',来源链接:'source_url',投递链接:'apply_url',岗位编号:'source_id'};
  for(const line of original.split('\n')) {
    const match=line.trim().match(/^([^:：]{1,12})[:：]\s*(.*)$/);
    if(match&&scalar[match[1]]) { const key=scalar[match[1]], value=match[2].trim(); if(key==='cities')result[key]=value.split(/[、,/，]/).map(s=>s.trim()).filter(Boolean); else if(key==='cohort')result[key]=/^20\d{2}(?:届)?$/.test(value)?Number(value.slice(0,4)):null; else if(key==='deadline')result[key]=isCalendarDate(value)?value:''; else if(['source_url','apply_url'].includes(key)){try{result[key]=publicUrl(value).href;}catch{}} else result[key]=value; continue; }
    const heading=line.trim().match(/^(岗位职责|工作职责|职位描述|岗位描述|任职要求|岗位要求|职位要求)\s*[:：]?\s*(.*)$/);
    if(heading){section=/要求/.test(heading[1])?'requirements':'description';if(heading[2])(section==='requirements'?requirements:body).push(heading[2]);continue;}
    (section==='requirements'?requirements:body).push(line);
  }
  result.description=body.join('\n').trim().slice(0,12000);result.requirements=requirements.join('\n').trim().slice(0,12000);return result;
}
export async function previewPrivateJob(userId, body, options={}) {
  const mode=body.mode||'manual';demand(['manual','text','url'].includes(mode),400,'导入方式不正确。');
  let original=string(body.text,24000,false),url='',warning='',method=mode,pageHtml='';
  if(mode==='url') {
    url=string(body.url,2000);
    try { const page=await fetchPublicPage(url,options); demand(typeof page.text==='string'&&!page.text.includes('\0'),422,'页面不是可用的岗位文本。'); pageHtml=page.text; original=decode(page.text.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1\s*>/gi,'').replace(/<\/(?:p|div|li|h[1-6]|section)>|<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'')).replace(/[ \t]+/g,' ').trim().slice(0,24000);method='public_https_text'; }
    catch { warning='未能读取公开页面。可以只保存链接，或粘贴正文后再预览；不会绕过登录或访问内网。';method='url_only'; }
  }
  const draft=mode==='manual'?{...body.fields,original_text:original}:extractText(original);
  const jdText=(draft.description||'')+(draft.requirements||''),hasJobText=/负责|参与|熟悉|掌握|具备|本科|硕士|工作经验|开发|维护|设计|分析/.test(jdText);
  const loginWall=/<input\b[^>]*\btype\s*=\s*['"]?password/i.test(pageHtml)&&jdText.length<120
    || /登录后(?:查看|访问|继续)|(?:请|需要|须|需先|必须)先?登录|登录以查看|验证后查看|sign in to|log in to/i.test(original)&&(!hasJobText||jdText.length<60);
  if(mode==='url'&&method==='public_https_text'&&(!/^(?:岗位职责|工作职责|职位描述|岗位描述|任职要求|岗位要求|职位要求)\s*[:：]?/m.test(original)||jdText.trim().length<12||loginWall)) {
    draft.description='';draft.requirements='';method='url_reference';warning='页面未识别出明确岗位职责或任职要求，可能是登录页、动态页面或导航内容。已保留原文供核对，请粘贴具体 JD；也可以仅保存链接。';
  }
  if(url) {try {draft.source_url=publicUrl(url).href;}catch {draft.source_url='';warning='该链接不符合公网 HTTPS 要求，请手动填写岗位内容。';}}
  const shortened=[];
  for(const [key,maximum] of Object.entries(fields))if(typeof draft[key]==='string'&&countText(draft[key])>maximum){draft[key]=Array.from(draft[key]).slice(0,maximum).join('');shortened.push(key);}
  if(Array.isArray(draft.cities)){if(draft.cities.length>20||draft.cities.some(city=>countText(city)>80))shortened.push('cities');draft.cities=draft.cities.slice(0,20).map(city=>Array.from(city).slice(0,80).join(''));}
  if(countText((draft.description||'')+(draft.requirements||''))>23990){draft.requirements=Array.from(draft.requirements||'').slice(0,Math.max(0,23990-countText(draft.description||''))).join('');shortened.push('requirements');}
  if(shortened.length)warning+=(warning?' ':'')+'部分提取字段过长，已缩短供编辑；原始输入单独保留，请核对后保存。';
  for(const [key,value] of previews)if(value.expires<Date.now())previews.delete(key);
  while(previews.size>=500)previews.delete(previews.keys().next().value);
  const previewId=id();previews.set(previewId,{userId,original_text:original,source_url:draft.source_url||'',method,captured_at:now(),expires:Date.now()+30*60*1000});
  return {draft,warning,previewId,provenance:{method,reviewed:false},duplicates:Object.values(draft).some(v=>typeof v==='string'&&v.trim())?duplicateJobs(userId,draft):[]};
}
function appendRevision(userId, jobId, revision, payload, reason, time) { db.prepare('INSERT INTO private_job_revisions(job_id,user_id,revision,payload,reason,created_at) VALUES(?,?,?,?,?,?)').run(jobId,userId,revision,JSON.stringify(payload),reason,time); }
const source = (draft,time,preview) => ({source_url:draft.source_url,apply_url:draft.apply_url,captured_url:preview?.source_url||null,source_id:draft.source_id,channel:draft.channel,original_text:preview?.original_text??draft.original_text,captured_at:preview?.captured_at||time,provenance:preview?.method||'user_supplied',verified_official:false});
export function savePrivateJob(userId, body, jobId=null) {
  const draft=normalize(body);
  demand(body.confirmed===true,400,'请核对预览字段，并确认这是私人资料。');
  const requestKey = !jobId && body.requestId || null;
  demand(requestKey===null||typeof requestKey==='string'&&/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(requestKey),400,'requestId 必须是 UUID。');
  const requestHash=sha256(canonicalJson({draft,duplicateAction:body.duplicateAction||null,duplicateId:body.duplicateId||null,previewId:body.previewId||null}));
  return transaction(()=>{
    if(requestKey){const old=db.prepare('SELECT * FROM private_job_requests WHERE user_id=? AND request_key=?').get(userId,requestKey);if(old){demand(old.request_hash===requestHash,409,'同一 requestId 已用于不同岗位内容。','IDEMPOTENCY_CONFLICT');return {...resolveJob(userId,old.job_id),replayed:true};}}
    const preview=body.previewId?previews.get(body.previewId):null;
    if(body.previewId)demand(preview?.userId===userId&&preview.expires>Date.now(),409,'原始预览已过期，请重新预览后保存。','PREVIEW_EXPIRED');
    const remember=job=>{if(requestKey)db.prepare('INSERT INTO private_job_requests(user_id,request_key,request_hash,job_id) VALUES(?,?,?,?)').run(userId,requestKey,requestHash,job.id);return job;};
    const existing=jobId?resolveJob(userId,jobId):null;
    demand(!jobId||jobId.startsWith('private:'),400,'只能修改私人岗位。');
    if(existing)demand(body.revision===existing.revision,409,'私人岗位版本已变化，请刷新。','REVISION_CONFLICT');
    const duplicates=duplicateJobs(userId,draft,jobId||'');
    if(!existing&&(duplicates.length||['reuse','add_source'].includes(body.duplicateAction))) {
      demand(['reuse','add_source','keep_separate'].includes(body.duplicateAction),409,'发现可能重复岗位，请选择复用、补充来源或保留独立岗位。','DUPLICATE_REVIEW_REQUIRED');
      if(body.duplicateAction!=='keep_separate') {
        const candidate=duplicates.find(j=>j.id===body.duplicateId);demand(candidate,409,'重复项已变化，请重新核对。');
        const target=resolveJob(userId,candidate.id);
        if(body.duplicateAction==='reuse')return remember({...target,reused:true});
        demand(candidate.job_type==='private',400,'公共岗位不能由私人资料改写；可复用或保留独立私人岗位。');
        demand(!target.archived_at,409,'请先恢复该私人岗位，再补充来源。');
        const row=db.prepare('SELECT payload FROM private_jobs WHERE id=? AND user_id=?').get(target.id,userId);
        const payload=JSON.parse(row.payload),time=now();
        demand((payload.sources||[]).length<50,400,'来源记录最多50项。');
        payload.sources=[...(payload.sources||[]),source(draft,time,preview)];
        db.prepare('UPDATE private_jobs SET payload=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(payload),time,target.id,userId);
        appendRevision(userId,target.id,target.revision+1,payload,'add_source',time);return remember({...resolveJob(userId,target.id),addedSource:true});
      }
    }
    const time=now(),key=jobId||'private:'+id(),revision=(existing?.revision||0)+1;
    const payload={...draft,sources:existing?.sources||[source(draft,time,preview)],confirmed_at:time};
    if(existing)db.prepare('UPDATE private_jobs SET payload=?,revision=?,updated_at=? WHERE id=? AND user_id=?').run(JSON.stringify(payload),revision,time,key,userId);
    else db.prepare('INSERT INTO private_jobs(id,user_id,revision,payload,created_at,updated_at) VALUES(?,?,1,?,?,?)').run(key,userId,JSON.stringify(payload),time,time);
    appendRevision(userId,key,revision,payload,existing?'edit':'created',time);return remember(resolveJob(userId,key));
  });
}
export function archivePrivateJob(userId,jobId,body) {
  demand(typeof body.archived==='boolean',400,'归档状态格式不正确。');
  return transaction(()=>{
    const job=resolveJob(userId,jobId);demand(job.job_type==='private',400,'只能归档私人岗位。');demand(job.revision===body.revision,409,'私人岗位版本已变化，请刷新。');
    const time=now(),archived=body.archived?time:null,payload=JSON.parse(db.prepare('SELECT payload FROM private_jobs WHERE id=? AND user_id=?').get(jobId,userId).payload);
    db.prepare('UPDATE private_jobs SET archived_at=?,revision=revision+1,updated_at=? WHERE id=? AND user_id=?').run(archived,time,jobId,userId);
    appendRevision(userId,jobId,job.revision+1,{...payload,archived_at:archived},body.archived?'archived':'restored',time);return resolveJob(userId,jobId);
  });
}
export function listPrivateJobs(userId,query={}) {
  const q=string(query.q,100).toLowerCase(),archive=query.archived||'active';demand(['active','archived','all'].includes(archive),400,'归档筛选不正确。');
  const offset=Number(query.offset||0),limit=Number(query.limit||20);demand(Number.isInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,400,'分页参数不正确。');
  const items=db.prepare('SELECT * FROM private_jobs WHERE user_id=? ORDER BY updated_at DESC,id').all(userId).map(privatePayload).filter(j=>(archive==='all'||Boolean(j.archived_at)===(archive==='archived'))&&(!q||[j.company,j.title,j.cities.join(' '),j.description,j.requirements,j.notes].join(' ').toLowerCase().includes(q)));
  return {items:items.slice(offset,offset+limit),total:items.length,offset,limit};
}
export function privateJobHistory(userId,jobId) { resolveJob(userId,jobId);return db.prepare('SELECT revision,payload,reason,created_at FROM private_job_revisions WHERE user_id=? AND job_id=? ORDER BY revision DESC').all(userId,jobId).map(r=>({...r,payload:JSON.parse(r.payload)})); }
