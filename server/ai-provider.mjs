import dns from 'node:dns/promises';
import net from 'node:net';
import { demand, text, HttpError } from './security.mjs';

export const PROVIDERS = {
  deepseek: {
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-flash', 'deepseek-v4-pro'],
    defaultModel: 'deepseek-flash',
    extra: { thinking: { type: 'disabled' } },
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  custom: {
    label: '自定义（OpenAI 兼容）',
    baseUrl: '',
    models: [],
    defaultModel: '',
    extra: {},
    keyUrl: '',
  },
};

// The base URL is user supplied, so it must not be usable to reach the local
// machine or a private network from the server process. Hostname string checks
// alone are not enough: resolve DNS and reject every returned address.
function normalizeIp(address) {
  const value = String(address || '').toLowerCase();
  const dotted = value.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1];
  const hexMapped = value.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (hexMapped) {
    const hi = Number.parseInt(hexMapped[1], 16);
    const lo = Number.parseInt(hexMapped[2], 16);
    return `${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`;
  }
  return value;
}

const ipv6Global = new net.BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Reserved = new net.BlockList();
for (const [network, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) ipv6Reserved.addSubnet(network, prefix, 'ipv6');

export function isPrivateIp(address) {
  const ip = normalizeIp(address);
  if (net.isIPv4(ip)) {
    const [a, b, c] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || b === 0 || b === 2 || (b === 88 && c === 99))) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // carrier-grade NAT
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (net.isIPv6(ip)) {
    // Global unicast only. Link-local, unique-local, documentation, 6to4 and multicast stay blocked.
    return !ipv6Global.check(ip, 'ipv6') || ipv6Reserved.check(ip, 'ipv6');
  }
  return true;
}

function isPrivateHost(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (net.isIP(host)) return isPrivateIp(host);
  return false;
}

export async function guardBaseUrl(value) {
  const raw = text(value, 300);
  demand(raw, 400, '请填写接口地址。');
  let url;
  try { url = new URL(raw); } catch { throw new HttpError(400, '接口地址不是有效的网址。'); }
  demand(url.protocol === 'https:', 400, '接口地址必须使用 https。');
  demand(!url.username && !url.password, 400, '接口地址不能包含账号密码。');
  demand(!isPrivateHost(url.hostname), 400, '接口地址不能指向本机或内网。');
  let records;
  try {
    records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new HttpError(400, '接口地址无法解析，请检查域名。');
  }
  demand(records.length, 400, '接口地址无法解析，请检查域名。');
  demand(records.every(record => !isPrivateIp(record.address)), 400, '接口地址不能指向本机或内网。');
  return (url.origin + url.pathname).replace(/\/+$/, '');
}

export async function resolveTarget(config) {
  const provider = PROVIDERS[config?.provider] ? config.provider : 'deepseek';
  const meta = PROVIDERS[provider];
  const model = text(config?.model, 80) || (provider === 'deepseek' ? process.env.DEEPSEEK_MODEL : '') || meta.defaultModel;
  if (provider === 'deepseek') demand(meta.models.includes(model), 400, '请选择当前支持的模型。');
  else demand(model, 400, '请填写模型名称。');
  let baseUrl = meta.baseUrl;
  if (provider === 'custom') {
    demand(config?.base_url, 503, '请先在设置中填写自定义接口地址。', 'AI_NOT_CONFIGURED');
    baseUrl = await guardBaseUrl(config.base_url);
  }
  return { provider, model, baseUrl, label: meta.label, url: baseUrl + '/chat/completions', extra: meta.extra };
}
