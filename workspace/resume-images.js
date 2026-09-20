import { PORTRAIT_BYTES, GALLERY_BYTES } from '/shared/resume-media.mjs';

export async function prepareResumeImage(file, portrait = false) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('请选择 JPG、PNG 或 WebP 图片。');
  if (file.size > 8 * 1024 * 1024) throw new Error('原始图片不能超过 8 MB。');
  const url = URL.createObjectURL(file), image = new Image();
  try {
    await new Promise((resolve,reject) => { image.onload=resolve; image.onerror=() => reject(new Error('无法读取这张图片，请换一张。')); image.src=url; });
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error('图片尺寸过大，请先缩小至 4000 万像素以内。');
    const max = portrait ? 800 : 1400, limit = portrait ? PORTRAIT_BYTES : GALLERY_BYTES;
    let scale = Math.min(1,max / Math.max(image.naturalWidth,image.naturalHeight));
    const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d');
    if (!ctx) throw new Error('当前浏览器无法处理图片。');
    for (let attempt=0;attempt<4;attempt++) {
      canvas.width=Math.max(1,Math.round(image.naturalWidth*scale)); canvas.height=Math.max(1,Math.round(image.naturalHeight*scale));
      ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);
      for (const quality of [.9,.8,.7,.6]) {
        const src=canvas.toDataURL('image/jpeg',quality);
        if (src.length <= Math.ceil(limit/3)*4+23) return src;
      }
      scale*=.75;
    }
    throw new Error('图片压缩后仍过大，请选择较小的图片。');
  } finally { URL.revokeObjectURL(url); }
}
