export const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function parsedDate(value) {
  if (value == null || value === '' || (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date))) return null;
  const result = new Date(value);
  return Number.isFinite(result.getTime()) ? result : null;
}
const dateFormatter = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFormatter = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
export const date = value => {
  const parsed = parsedDate(value);
  if (parsed) return dateFormatter.format(parsed);
  // Relative source labels describe the collection snapshot, not today's date.
  const raw = typeof value === 'string' ? value.trim() : '';
  if (/^(?:[一二三四五六七八九十百两\d]+(?:分钟|小时|天|周|个月|月|年)前|刚刚|今天|昨天|前天)$/.test(raw)) return '采集时：' + raw;
  return '未公布';
};
export const time = value => { const parsed = parsedDate(value); return parsed ? timeFormatter.format(parsed) : '未安排'; };
export const localDateInput = value => {
  const d = parsedDate(value);
  if (!d) return '';
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
const paths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  jobs: '<rect x="3" y="7" width="18" height="14" rx="3"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12a22 22 0 0 0 18 0M10 12v3h4v-3"/>',
  applications: '<path d="M4 5h16M4 12h10M4 19h7m6-2 3 3 4-5"/>',
  resumes: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 0v6h6M8 13h8M8 17h5"/>',
  templates: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M10 9v12"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4M17 3v4M3 11h18M8 15h2M14 15h2M8 18h2"/>',
  ai: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4M18 4h4"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="currentColor" stroke="none"/><circle cx="16" cy="17" r="3" fill="currentColor" stroke="none"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>', plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>', check: '<path d="m5 12 4 4L19 6"/>',
  link: '<path d="M14 3h7v7M10 14 21 3M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v5h14v-5"/>',
  trash: '<path d="M3 6h18M8 6V3h8v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  logout: '<path d="M9 3H4v18h5M10 12h11m-4-4 4 4-4 4"/>',
};
export function icon(name, cls = '') { return `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.resumes}</svg>`; }
export function safeUrl(value) { try { const u = new URL(value); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } }
export function companyLogo(name) {
  const text = String(name || '公司');
  const color = [...text].reduce((sum, char) => sum + char.codePointAt(0), 0) % 5;
  return `<span class="company-logo logo-tone-${color}" aria-hidden="true">${escape(text === '腾讯音乐' ? '♫' : text.slice(0, 2))}</span>`;
}
export function emptyState(title, description, action = '') { return `<div class="empty-state"><span class="empty-icon">${icon('resumes')}</span><h3>${escape(title)}</h3><p>${escape(description)}</p>${action}</div>`; }
export function toast(message, error = false) {
  const region = document.getElementById('toast-region'); const el = document.createElement('div'); el.className = 'toast' + (error ? ' toast-error' : ''); el.textContent = message; region.append(el); window.dispatchEvent(new CustomEvent('offerbiu:feedback', { detail: { message, error } })); setTimeout(() => el.remove(), 4600);
}
export function loading() { return '<div class="loading-view"><span class="loader"></span><p>正在加载…</p></div>'; }
export function downloadJson(data, name) { const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
export function statusBadge(status, statuses) { const s = statuses.find(item => item.id === status) || statuses[0]; return `<span class="badge badge-${s.color}"><i></i>${escape(s.label)}</span>`; }
export function dialog(title, content, setup, className = '') {
  const el = document.getElementById('app-dialog');
  if (el.open) el.close();
  el.className = className;
  el.innerHTML = `<div class="modal-heading"><h2 id="dialog-heading">${escape(title)}</h2><button class="icon-button" data-close-dialog aria-label="关闭">${icon('close')}</button></div>${content}`;
  el.querySelector('[data-close-dialog]').addEventListener('click', () => el.close());
  el.onclick = event => { if (event.target !== el) return; const r = el.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) el.close(); };
  el.showModal(); setup?.(el); return el;
}
