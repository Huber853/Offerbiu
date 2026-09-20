import crypto from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { db, STORAGE } from './db.mjs';
import { normalizeDesign } from '../shared/templates.mjs';
import { normalizeMedia, safeImageData, PORTRAIT_BYTES, GALLERY_LIMIT, RESUME_FILE_LIMIT } from '../shared/resume-media.mjs';

const scrypt = promisify(crypto.scrypt);
export const now = () => new Date().toISOString();
export const id = () => crypto.randomUUID();
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

export class HttpError extends Error { constructor(status, message, code = '') { super(message); this.status = status; this.code = code; } }
export function demand(condition, status, message, code) { if (!condition) throw new HttpError(status, message, code); }
export function text(value, max = 2000) { return typeof value === 'string' ? value.trim().slice(0, max) : ''; }

export async function passwordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(password, salt, 64);
  return `${salt}:${derived.toString('hex')}`;
}
export async function passwordMatches(password, encoded) {
  const [salt, hash] = encoded.split(':');
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === derived.length && crypto.timingSafeEqual(derived, expected);
}

export function getSession(req) {
  const raw = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith('offerbiu_session='))?.slice(17);
  if (!raw || !/^[a-f0-9]{64}$/.test(raw)) return null;
  return db.prepare(`SELECT s.*, u.name, u.email FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(sha256(raw), Date.now()) || null;
}
export function createSession(userId, res) {
  const token = crypto.randomBytes(32).toString('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)').run(sha256(token), userId, csrf, Date.now() + 7 * 86400000);
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `offerbiu_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800${secure}`);
  return csrf;
}
export function clearSession(session, res) {
  if (session) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(session.token_hash);
  res.setHeader('Set-Cookie', `offerbiu_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
}

const keyFile = path.join(STORAGE, '.encryption-key');
if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile, crypto.randomBytes(32), { flag: 'wx', mode: 0o600 });
const encryptionKey = fs.readFileSync(keyFile);
demand(encryptionKey.length === 32, 500, '本机加密文件不完整，请从备份恢复。');
export function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.');
}
export function decrypt(value) {
  const [iv, tag, data] = value.split('.').map(s => Buffer.from(s, 'base64'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}

const rates = new Map();
export function rateLimit(key, limit, periodMs) {
  const time = Date.now();
  let record = rates.get(key);
  if (!record || record.until <= time) { record = { count: 0, until: time + periodMs }; rates.set(key, record); }
  record.count += 1;
  demand(record.count <= limit, 429, '操作比较频繁，请稍后再试。');
}
setInterval(() => { const time = Date.now(); for (const [key, val] of rates) if (val.until < time) rates.delete(key); db.prepare('DELETE FROM sessions WHERE expires_at<?').run(time); }, 60000).unref();

export function sanitizeResume(value) {
  demand(value && typeof value === 'object' && !Array.isArray(value), 400, '简历内容格式不正确。');
  const basics = {};
  for (const key of ['name', 'headline', 'email', 'phone', 'city', 'website', 'summary']) basics[key] = text(value.basics?.[key], key === 'summary' ? 6000 : 300);
  const result = { basics, skills: text(value.skills, 8000), awards: text(value.awards, 8000) };
  if (value.design) result.design = normalizeDesign(value.design);
  if (value.media) {
    demand(typeof value.media === 'object' && !Array.isArray(value.media), 400, '图片内容格式不正确。');
    const media=value.media;
    demand(!media.portrait?.src || safeImageData(media.portrait.src,PORTRAIT_BYTES),400,'头像须为有效 JPG、PNG 或 WebP，压缩后不超过180 KB。');
    demand(!media.gallery || (Array.isArray(media.gallery) && media.gallery.length <= GALLERY_LIMIT),400,'最多添加3张作品图片。');
    for (const item of media.gallery || []) demand(safeImageData(item?.src),400,'作品图格式无效或超过300 KB。');
    result.media=normalizeMedia(media);
  }
  for (const section of ['education', 'experience', 'projects']) {
    demand(!value[section] || Array.isArray(value[section]), 400, '简历经历必须是列表。');
    result[section] = (value[section] || []).slice(0, 20).map(item => {
      const keys = section === 'education' ? ['school', 'degree', 'major', 'start', 'end', 'details'] : section === 'experience' ? ['company', 'role', 'start', 'end', 'details'] : ['name', 'role', 'start', 'end', 'details'];
      return Object.fromEntries(keys.map(key => [key, text(item?.[key], key === 'details' ? 12000 : 300)]));
    });
  }
  const { media, ...writing } = result;
  demand(JSON.stringify(writing).length <= 180000, 400, '简历文字内容过长，请精简后保存。');
  demand(Buffer.byteLength(JSON.stringify(result),'utf8') <= RESUME_FILE_LIMIT - 2000,400,'简历和图片合计过大，请减少图片后保存。');
  return result;
}
export function resumeField(data, field) {
  demand(/^(basics\.summary|skills|awards|(education|experience|projects)\.\d{1,2}\.details)$/.test(field), 400, '请选择可润色的简历模块。');
  const parts = field.split('.');
  let parent = data;
  for (const part of parts.slice(0, -1)) { parent = parent?.[part]; demand(parent && typeof parent === 'object', 400, '所选经历已不存在。'); }
  return { parent, key: parts.at(-1), value: text(parent?.[parts.at(-1)], 12000) };
}
