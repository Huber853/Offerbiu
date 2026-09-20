export const RESUME_FILE_LIMIT = 2_000_000;
export const PORTRAIT_BYTES = 180_000;
export const GALLERY_BYTES = 300_000;
export const GALLERY_LIMIT = 3;

export function safeImageData(value, maxBytes = GALLERY_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 64) return '';
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || match[2].length % 4) return '';
  const bytes = match[2].length * 3 / 4 - (match[2].endsWith('==') ? 2 : match[2].endsWith('=') ? 1 : 0);
  if (bytes > maxBytes || bytes < 16) return '';
  try {
    const head = atob(match[2].slice(0, 64));
    const valid = match[1] === 'jpeg' ? head.startsWith('\xff\xd8\xff')
      : match[1] === 'png' ? head.startsWith('\x89PNG\r\n\x1a\n')
      : head.startsWith('RIFF') && head.slice(8,12) === 'WEBP';
    return valid ? value : '';
  } catch { return ''; }
}

export function normalizeMedia(value) {
  const input = value && typeof value === 'object' ? value : {};
  const photo = input.portrait && typeof input.portrait === 'object' ? input.portrait : {};
  const point = x => Number.isFinite(Number(x)) ? Math.max(0,Math.min(100,Number(x))) : 50;
  return { portrait: { src:safeImageData(photo.src, PORTRAIT_BYTES), visible:photo.visible !== false,
    shape:['auto','circle','rounded','square'].includes(photo.shape) ? photo.shape : 'auto',
    fit:photo.fit === 'contain' ? 'contain' : 'cover', x:point(photo.x), y:point(photo.y) },
    gallery: (Array.isArray(input.gallery) ? input.gallery : []).slice(0,GALLERY_LIMIT).map(item => ({
      src:safeImageData(item?.src), caption:typeof item?.caption === 'string' ? item.caption.slice(0,300) : ''
    })).filter(item => item.src) };
}
