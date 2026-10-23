import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { sourcePolicy,isDeadlineExpired } from '../server/job-policy.mjs';

export function classifyEvidence(job,{status,url,text=''}) {
  const source=new URL(job.source_url);
  const target=new URL(url||job.source_url);
  const same=source.href===target.href;
  if(!same) return {state:'unknown',reason:'页面跳转，未确认同一岗位',evidence_quote:null};
  if(status===410) return {state:'closed',reason:'原岗位返回 410 Gone',evidence_quote:'HTTP 410'};
  if(status!==200) return {state:'unknown',reason:'HTTP '+status+'，不能据此判定下架',evidence_quote:null};
  const clean=String(text).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/g,' ');
  const index=clean.indexOf(job.title);
  if(index<0) return {state:'unknown',reason:'响应没有可确认的具体岗位标题',evidence_quote:null};
  const near=clean.slice(Math.max(0,index-80),index+1600);
  const closed=near.match(/职位已关闭|岗位已下线|职位已下架|该岗位停止招聘|该职位招聘已结束/);
  if(closed) return {state:'closed',reason:'同岗位页面明确显示关闭',evidence_quote:near.slice(Math.max(0,closed.index-40),closed.index+80)};
  const apply=near.match(/立即申请|投递简历|申请职位|申请该岗位/);
  if(apply) return {state:'available',reason:'同岗位标题及申请入口文字可定位',evidence_quote:near.slice(Math.max(0,apply.index-60),apply.index+80)};
  return {state:'unknown',reason:'可以定位岗位标题，尚无明确在招证据',evidence_quote:near.slice(0,200)};
}
export function selectExamples(jobs,limit=20) {
  const eligible=jobs.filter(j=>j.id&&j.source_url&&!isDeadlineExpired(j.deadline));
  const selected=[],ids=new Set(),companies=new Set(),categories=new Set();
  const take=j=>{if(selected.length<limit&&!ids.has(j.id)){selected.push(j);ids.add(j.id);companies.add(j.company);categories.add(j.category);}};
  for(const j of eligible) if(!categories.has(j.category)) take(j);
  for(const j of eligible) if(!companies.has(j.company)) take(j);
  for(const j of eligible) take(j);
  return selected;
}
async function probe(job) {
  let url=job.source_url;
  const checked_at=new Date().toISOString();
  try {
    let response;
    for(let hop=0;hop<4;hop++) {
      const target=new URL(url);
      if(target.protocol!=='https:'||target.username||target.password||!sourcePolicy.sources.some(r=>r.host===target.hostname))
        throw new Error('跳转离开已登记官方域名');
      response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(12000),headers:{'User-Agent':'Offerbiu public job evidence checker/1.0','Accept':'text/html,application/json'}});
      if(response.status>=300&&response.status<400&&response.headers.get('location')) {url=new URL(response.headers.get('location'),url).href;continue;}
      break;
    }
    const body=await response.text();
    const result=classifyEvidence(job,{status:response.status,url,text:body});
    return {job_id:job.id,company:job.company,title:job.title,source_url:job.source_url,
      availability:{...result,checked_at,method:'public_page_text',http_status:response.status,evidence_url:url,
        last_available_at:result.state==='available'?checked_at:null},
      content_quality:job.content_quality||{level:'unknown',reason:'完整度需按岗位正文及适用引用人工审核'}};
  } catch(error) {
    return {job_id:job.id,company:job.company,title:job.title,source_url:job.source_url,
      availability:{state:'unknown',checked_at,method:'public_page_text',http_status:null,evidence_url:url,evidence_quote:null,last_available_at:null,reason:error.name==='TimeoutError'?'公开页面请求超时':String(error.message).slice(0,160)},
      content_quality:job.content_quality||{level:'unknown',reason:'尚未人工审核正文完整度'}};
  }
}
async function main() {
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
  const args=process.argv.slice(2);
  const option=(name,fallback)=>{const i=args.indexOf(name);return i>=0?args[i+1]:fallback;};
  const limit=Math.min(20,Math.max(1,Number(option('--limit',20))||20));
  const input=path.resolve(option('--input',path.join(root,'data','jobs-2027.json')));
  const out=path.resolve(option('--out',path.join(root,'data','sources',new Date().toISOString().slice(0,10)+'-workflow','evidence-check.json')));
  const bundle=JSON.parse(fs.readFileSync(input,'utf8'));
  const jobs=selectExamples(bundle.jobs,limit);
  const results=new Array(jobs.length);
  let next=0;
  await Promise.all(Array.from({length:Math.min(4,jobs.length)},async()=>{
    for(;;){const i=next++;if(i>=jobs.length)return;results[i]=await probe(jobs[i]);}
  }));
  fs.mkdirSync(path.dirname(out),{recursive:true});
  const report={checked_at:new Date().toISOString(),catalog_collected_at:bundle.collected_at,scope:'公开页面可访问性及同岗位证据；未自动发布；unknown 不等于关闭',results};
  fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output:out,count:results.length,states:results.reduce((a,r)=>(a[r.availability.state]=(a[r.availability.state]||0)+1,a),{})}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) await main();
