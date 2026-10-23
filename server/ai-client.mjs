import { db } from './db.mjs';
import { demand, decrypt, HttpError, sha256 } from './security.mjs';
import { PROVIDERS, resolveTarget } from './ai-provider.mjs';

const inflight = new Set();
const budgets = new Map();
function configured(userId) {
  const row = db.prepare('SELECT * FROM ai_settings WHERE user_id=?').get(userId);
  const provider = PROVIDERS[row?.provider] ? row.provider : 'deepseek';
  const model = row?.model || (provider === 'deepseek' ? process.env.DEEPSEEK_MODEL : '') || PROVIDERS[provider].defaultModel;
  const baseUrl = (provider === 'custom' ? row?.base_url || '' : PROVIDERS[provider].baseUrl).replace(/\/+$/, '');
  return { row, provider, model, baseUrl };
}
export async function getAiTarget(userId) {
  const {provider,model,baseUrl}=configured(userId);
  return { provider, model, baseUrl, endpointFingerprint:sha256(JSON.stringify([provider,baseUrl])) };
}
function takeBudget(userId) {
  const time=Date.now();
  const current=budgets.get(userId);
  const bucket=current && time-current.started<3600000 ? current : {started:time,count:0};
  demand(bucket.count<30,429,'本小时 AI 调用已达到 30 次，请稍后继续。','AI_BUDGET_EXCEEDED');
  bucket.count++;
  budgets.set(userId,bucket);
}
export async function callJson(userId,{ task,system,input,signal,maxTokens=6144,validate }={}) {
  demand(!inflight.has(userId),429,'上一项 AI 操作尚未结束，请稍候。','AI_BUSY');
  if(signal?.aborted) throw new HttpError(499,'操作已取消。','AI_CANCELLED');
  const config=configured(userId);
  const key=config.row?.key_encrypted ? decrypt(config.row.key_encrypted)
    : config.provider==='deepseek' ? process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '' : '';
  demand(key,503,'请先在个人设置为当前服务商配置 API 密钥。','AI_NOT_CONFIGURED');
  inflight.add(userId);
  try {
    const target=await resolveTarget({provider:config.provider,model:config.model,base_url:config.baseUrl});
    if(signal?.aborted) throw new HttpError(499,'操作已取消。','AI_CANCELLED');
    takeBudget(userId);
    const timeout=AbortSignal.timeout(90000);
    const combined=signal ? AbortSignal.any([signal,timeout]) : timeout;
    let response;
    try {
      response=await fetch(target.url,{
        method:'POST',redirect:'error',signal:combined,
        headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
        body:JSON.stringify({model:target.model,stream:false,...target.extra,max_tokens:maxTokens,
          response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(input)}]})
      });
    } catch(error) {
      if(combined.aborted) throw new HttpError(timeout.aborted ? 504 : 499,timeout.aborted ? 'AI 响应超时，请手动重试。' : '操作已取消。',timeout.aborted?'AI_TIMEOUT':'AI_CANCELLED');
      throw new HttpError(502,'暂时无法连接 AI 服务，已有内容已保留。','AI_UPSTREAM_ERROR');
    }
    if(!response.ok) throw new HttpError(502,response.status===429?'AI 服务商请求限流，请稍后重试。':'AI 服务暂不可用，请检查密钥和余额。',response.status===429?'AI_PROVIDER_RATE_LIMITED':'AI_UPSTREAM_ERROR');
    let result,data;
    try {
      result=await response.json();
      demand(result.choices?.[0]?.finish_reason==='stop',502,'AI 输出未完整结束，请精简内容后重试。','AI_OUTPUT_INVALID');
      const content=result.choices[0].message?.content;
      demand(typeof content==='string' && content.length>0 && Buffer.byteLength(content,'utf8')<=200000,502,'AI 输出为空或过长。','AI_OUTPUT_INVALID');
      data=JSON.parse(content);
      demand(data && typeof data==='object' && !Array.isArray(data),502,'AI 返回的 JSON 结构不正确。','AI_OUTPUT_INVALID');
      validate?.(data);
    } catch(error) {
      if(error instanceof HttpError) throw error;
      if(combined.aborted) throw new HttpError(timeout.aborted?504:499,'AI 响应已中止。',timeout.aborted?'AI_TIMEOUT':'AI_CANCELLED');
      throw new HttpError(502,'AI 返回的内容未通过结构校验，未修改已有资料。','AI_OUTPUT_INVALID');
    }
    if(signal?.aborted) throw new HttpError(499,'操作已取消。','AI_CANCELLED');
    return {data,usage:result.usage || null,provider:target.provider,model:target.model,
      endpointFingerprint:sha256(JSON.stringify([target.provider,target.baseUrl])),task};
  } finally { inflight.delete(userId); }
}
