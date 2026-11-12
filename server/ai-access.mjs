import { db } from './db.mjs';

export function serverKeyAllowlist() {
  return [...new Set(String(process.env.OFFERBIU_SERVER_KEY_EMAILS || '').split(',').map(item => item.trim().toLowerCase()).filter(Boolean))];
}

export function listensOnLoopback() {
  const host = String(process.env.HOST || '127.0.0.1').replace(/^\[|\]$/g, '').toLowerCase();
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

export function publicSiteConfigured() {
  return String(process.env.APP_ORIGIN || '').split(',').map(item => item.trim()).filter(Boolean).some(origin => {
    try {
      const host = new URL(origin).hostname.replace(/^\[|\]$/g, '').toLowerCase();
      return host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
    } catch { return true; }
  });
}

/** local-shared keeps the historical single-machine default. allowlist and personal-only do not. */
export function serverKeyPolicy() {
  if (serverKeyAllowlist().length) return 'allowlist';
  if (!listensOnLoopback() || publicSiteConfigured()) return 'personal-only';
  return 'local-shared';
}

export function userEmail(userId) {
  return String(db.prepare('SELECT email FROM users WHERE id=?').get(userId)?.email || '').toLowerCase();
}

export function serverDeepSeekKeyFor(userId) {
  const key = process.env.DEEPSEEK_API_KEY || process.env.AI_API_KEY || '';
  if (!key) return '';
  const allow = serverKeyAllowlist();
  if (allow.length) return allow.includes(userEmail(userId)) ? key : '';
  return serverKeyPolicy() === 'local-shared' ? key : '';
}
