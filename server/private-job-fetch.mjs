import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import { demand, HttpError } from './security.mjs';
import { isPrivateIp } from './ai-provider.mjs';

export function safePublicIp(ip) {
  if (isPrivateIp(ip)) return false;
  if (net.isIPv4(ip)) {
    const [a,b,c] = ip.split('.').map(Number);
    return !(a === 192 && (b === 0 || b === 2 || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  // Only global unicast; reject mapped, transition, documentation and multicast ranges.
  if (!net.isIPv6(ip)) return false;
  const global = new net.BlockList(), reserved = new net.BlockList();
  global.addSubnet('2000::',3,'ipv6');
  for (const [network,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20]]) reserved.addSubnet(network,prefix,'ipv6');
  return global.check(ip,'ipv6') && !reserved.check(ip,'ipv6');
}
export function publicUrl(value) {
  let url; try { url = new URL(value); } catch { throw new HttpError(400, '请输入完整的 HTTPS 链接。'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  demand(url.protocol === 'https:' && !url.username && !url.password && (!url.port || url.port === '443'), 400, '只支持不含账号密码的公网 HTTPS 链接（443端口）。');
  demand(!/(^|\.)(localhost|local|internal|localhost\.localdomain)$/.test(host) && (net.isIP(host) ? safePublicIp(host) : host.includes('.')), 400, '不能访问本机、内网或保留地址。');
  return url;
}
function requestPage(url, address, signal, maximum) {
  return new Promise((resolve, reject) => {
    // Pin the validated address to the socket; never perform a second DNS lookup.
    const request = https.get(url, { agent: false, signal, headers: { 'User-Agent':'Offerbiu/1.0 private-job-preview', Accept:'text/html,text/plain', 'Accept-Encoding':'identity' },
      lookup(_host, options, callback) { callback(null, options.all ? [address] : address.address, address.family); } }, response => {
      if ([301,302,303,307,308].includes(response.statusCode)) { response.destroy(); resolve({status:response.statusCode,location:response.headers.location}); return; }
      if (response.statusCode !== 200) { response.destroy(); reject(new HttpError(422,'页面暂时无法读取，请粘贴正文或手动填写。')); return; }
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(response.headers['content-type'] || '') || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
        response.destroy(); reject(new HttpError(422,'仅支持未压缩的 HTML 或文本页面，请粘贴正文。')); return;
      }
      const parts=[]; let size=0;
      response.on('data', chunk => { size+=chunk.length; if(size>maximum) response.destroy(new HttpError(422,'页面过大，请粘贴适用岗位正文。')); else parts.push(chunk); });
      response.on('error',reject); response.on('end',()=>resolve({status:200,text:Buffer.concat(parts).toString('utf8')}));
    });
    request.on('error',reject);
  });
}
export async function fetchPublicPage(value, { signal, lookup = dns.lookup, request = requestPage, timeout = 8000, maximum = 512000 } = {}) {
  const deadline = AbortSignal.timeout(timeout), combined = signal ? AbortSignal.any([signal,deadline]) : deadline;
  const aborted = new Promise((_,reject)=>combined.addEventListener('abort',()=>reject(new HttpError(422,'链接读取已取消或超时，请手动填写。')),{once:true}));
  const work = async () => {
    let url=publicUrl(value);
    for(let redirects=0; redirects<=3; redirects++) {
      combined.throwIfAborted();
      const records=await lookup(url.hostname.replace(/^\[|\]$/g,''),{all:true,verbatim:true});
      demand(records.length && records.every(r=>safePublicIp(r.address)),400,'链接解析到了内网或保留地址，已停止读取。');
      combined.throwIfAborted();
      const response=await request(url,records[0],combined,maximum);
      if(response.status===200) return {url:url.href,text:response.text};
      demand(redirects<3 && response.location,422,'页面跳转过多或无效，请手动填写。');
      url=publicUrl(new URL(response.location,url).href);
    }
  };
  return Promise.race([work(),aborted]);
}
