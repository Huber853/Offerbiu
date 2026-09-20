let csrf = null;
export function setCsrf(value) { csrf = value; }
export async function api(path, { method = 'GET', data, signal } = {}) {
  let response;
  try {
    response = await fetch('/api' + path, { method, credentials: 'same-origin', signal,
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(data || {}) } : {}),
    });
  } catch (error) { if (error.name === 'AbortError') throw error; throw new Error('连接中断，请确认后端服务正在运行；未保存的内容请先导出。'); }
  let result;
  try { result = await response.json(); } catch { throw new Error('服务未返回有效数据，请确认使用的是完整项目的启动入口。'); }
  if (!response.ok) { const err = new Error(result.error || '操作未完成。'); err.status = response.status; err.code = result.code; throw err; }
  return result;
}
