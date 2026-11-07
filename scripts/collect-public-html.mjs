import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { acceptsJob, sourcePolicy } from '../server/job-policy.mjs';
import { classifyEvidence } from './check-job-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAX_REQUESTS = Math.min(50, Math.max(1, Number(process.argv.find((arg, index, list) => list[index - 1] === '--max') || 50)));
const DELAY_MS = 700;
let requests = 0;
const failures = [];

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function clean(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;|&amp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function shanghaiNow() {
  return new Date(Date.now() + 8 * 3600000).toISOString().replace(/\.\d{3}Z$/, '+08:00');
}
function linksFrom(html, base) {
  const found = [];
  for (const match of String(html).matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.protocol !== 'https:' || url.pathname.toLowerCase().includes('/api/')) continue;
      url.hash = '';
      found.push(url.href);
    } catch { /* ignore malformed links */ }
  }
  return [...new Set(found)];
}
function ruleFor(url) {
  const parsed = new URL(url);
  return sourcePolicy.sources.find(rule => rule.host === parsed.hostname && rule.source_type === 'employer_official' && new RegExp(rule.path_pattern).test(parsed.pathname)) || null;
}
function externalId(url, rule) {
  const parsed = new URL(url);
  if (rule.id_query) return parsed.searchParams.get(rule.id_query) || '';
  if (rule.id_path_pattern) return parsed.pathname.match(new RegExp(rule.id_path_pattern))?.[1] || '';
  return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
}
export function titleFromPublicText(text) {
  const match = String(text || '').match(/【2027】[^。]{4,80}/);
  const title = match?.[0]?.replace(/\s+/g, ' ').trim() || '';
  if (title.length < 8 || /实习|校园大使|招聘公告|招募计划/.test(title) || !/2027/.test(title)) return '';
  return title;
}
function section(text, labels, stops) {
  for (const label of labels) {
    const at = text.indexOf(label);
    if (at < 0) continue;
    let rest = text.slice(at + label.length).replace(/^[:：\s]+/, '');
    let end = rest.length;
    for (const stop of stops) {
      const found = rest.indexOf(stop);
      if (found >= 0 && found < end) end = found;
    }
    const value = rest.slice(0, end).trim();
    if (value.length >= 20) return value.slice(0, 4000);
  }
  return '';
}
async function getHtml(url) {
  if (requests >= MAX_REQUESTS) throw new Error('已达到 50 次请求上限');
  if (new URL(url).pathname.toLowerCase().includes('/api/')) throw new Error('拒绝请求未作为公开页面的接口');
  if (requests) await sleep(DELAY_MS);
  requests += 1;
  const response = await fetch(url, {
    redirect: 'manual', signal: AbortSignal.timeout(10000),
    headers: { 'User-Agent': 'Offerbiu public HTML collector/1.0', Accept: 'text/html' },
  });
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, url, html: '', location: response.headers.get('location') || '' };
  }
  const html = await response.text();
  if (/验证码|access denied|访问过于频繁/i.test(html.slice(0, 800))) {
    throw new Error('页面返回访问限制');
  }
  return { status: response.status, url: response.url || url, html };
}

export async function collectPublicHtml(catalog) {
  const knownUrls = new Set(catalog.jobs.map(job => job.source_url));
  const knownKeys = new Set(catalog.jobs.map(job => {
    try { return new URL(job.source_url).hostname + ':' + job.external_id; } catch { return ''; }
  }));
  const prefixByHost = new Map();
  for (const job of catalog.jobs) {
    try {
      const host = new URL(job.source_url).hostname;
      if (!prefixByHost.has(host) && String(job.id).includes(':')) prefixByHost.set(host, String(job.id).split(':')[0]);
    } catch { /* skip bad legacy urls */ }
  }
  const seeds = ['smics.zhiye.com', 'gtgroup.zhiye.com', 'jczx.nwu.edu.cn', 'talent.baidu.com', 'join.qq.com'].map(host => catalog.jobs.find(job => {
    try { return new URL(job.source_url).hostname === host; } catch { return false; }
  })?.source_url).filter(Boolean);
  const detailUrls = [];
  const seen = new Set();
  for (const seed of seeds) {
    if (requests >= MAX_REQUESTS) break;
    try {
      const page = await getHtml(seed);
      if (page.status !== 200) { failures.push({ url: seed, reason: 'HTTP ' + page.status }); continue; }
      const host = new URL(seed).hostname;
      for (const link of linksFrom(page.html, seed)) {
        if (new URL(link).hostname !== host || seen.has(link) || knownUrls.has(link)) continue;
        const rule = ruleFor(link);
        if (!rule) continue;
        seen.add(link);
        detailUrls.push(link);
      }
      const listings = linksFrom(page.html, seed).filter(link => {
        try {
          const parsed = new URL(link);
          return parsed.hostname === host && !ruleFor(link) && /jobs|campus|list|zhiwei|recruit/i.test(parsed.pathname);
        } catch { return false; }
      }).slice(0, 2);
      for (const listing of listings) {
        if (requests >= MAX_REQUESTS) break;
        const listPage = await getHtml(listing);
        if (listPage.status !== 200) { failures.push({ url: listing, reason: '列表 HTTP ' + listPage.status }); continue; }
        for (const link of linksFrom(listPage.html, listing)) {
          if (new URL(link).hostname !== host || seen.has(link) || knownUrls.has(link) || !ruleFor(link)) continue;
          seen.add(link);
          detailUrls.push(link);
        }
      }
      if (!detailUrls.some(link => new URL(link).hostname === host)) failures.push({ url: seed, reason: '公开页面和站内列表链接都没有新的岗位地址' });
    } catch (error) {
      failures.push({ url: seed, reason: String(error.message || error).slice(0, 160) });
      if (String(error.message || error).includes('上限')) break;
    }
  }
  const added = [];
  const checkedAt = new Date().toISOString();
  for (const url of detailUrls) {
    if (requests >= MAX_REQUESTS || added.length >= 12) break;
    const rule = ruleFor(url);
    const id = externalId(url, rule);
    const key = new URL(url).hostname + ':' + id;
    if (!id || knownKeys.has(key)) continue;
    try {
      const page = await getHtml(url);
      if (page.status !== 200) { failures.push({ url, reason: '详情 HTTP ' + page.status }); continue; }
      const text = clean(page.html);
      const title = titleFromPublicText(text);
      if (!title) continue;
      const description = section(text, ['工作职责', '岗位职责', '职位描述'], ['任职要求', '任职资格', '职位要求', '现在申请', '返回职位']);
      const requirements = section(text, ['任职要求', '任职资格', '职位要求'], ['现在申请', '返回职位', '工作地点', '热招职位']);
      const evidence = (title + ' ' + requirements + ' ' + description).match(/.{0,40}(?:2027|27届).{0,80}/);
      if (!description || !requirements || !evidence) { failures.push({ url, reason: '页面正文缺少职责、要求或 2027 届依据' }); continue; }
      const place = text.match(/工作地点[:：]\s*([^。]{2,40})/)?.[1]?.trim() || '';
      const cities = place ? place.split(/[、,，/]/).map(item => item.trim()).filter(Boolean) : [];
      const company = rule.company || '';
      if (!company) { failures.push({ url, reason: '页面规则没有公司名，未猜测' }); continue; }
      const availability = classifyEvidence({ title, source_url: url }, { status: 200, url, text: page.html });
      const job = {
        id: `${prefixByHost.get(new URL(url).hostname) || 'html'}:${id}`,
        external_id: id, company, title, cities, category: '综合', industry: '', cohort: 2027,
        description, requirements, education: '', employment_type: '全职',
        cohort_evidence: evidence[0], cohort_evidence_url: url, source_url: url, apply_url: url,
        source_policy: sourcePolicy.version, source_type: rule.source_type, source_name: company + '公开招聘页',
        record_type: 'job', listing_kind: 'official_post', catalog_status: 'active', direct_apply_verified: true,
        base_scope: cities.length ? 'job' : 'unspecified', deadline: null, collected_at: shanghaiNow(),
        content_quality: { level: 'complete', reason: '正文摘自该公开 HTML 页面。', reviewed_at: checkedAt, reference_urls: [url] },
        availability: { ...availability, checked_at: checkedAt, method: 'public_page_text', http_status: 200, evidence_url: url, last_available_at: availability.state === 'available' ? checkedAt : null },
      };
      if (!acceptsJob(job)) { failures.push({ url, reason: '未通过现有来源规则' }); continue; }
      added.push(job);
      knownKeys.add(key);
      knownUrls.add(url);
    } catch (error) {
      failures.push({ url, reason: String(error.message || error).slice(0, 160) });
      if (String(error.message || error).includes('上限')) break;
    }
  }
  return { checkedAt, requests, added, failures, discovered: detailUrls.length };
}

async function main() {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'data', 'jobs-2027.json'), 'utf8'));
  const result = await collectPublicHtml(catalog);
  const summary = { checked_at: result.checkedAt, requests: result.requests, discovered: result.discovered, added: result.added.length, failures: result.failures, jobs: result.added.map(job => ({ id: job.id, title: job.title, url: job.source_url, availability: job.availability.state })) };
  console.log(JSON.stringify(summary));
  if (!process.argv.includes('--write') || !result.added.length) return;
  const dir = path.join(root, 'data', 'job-supplements');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '2026-11-07-public-html.json'), JSON.stringify({ checked_at: result.checkedAt, requests: result.requests, failures: result.failures, jobs: result.added }, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
