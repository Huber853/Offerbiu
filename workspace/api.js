let csrf = null;
export function setCsrf(value) { csrf = value; }
export async function api(path, { method = 'GET', data, signal, timeout } = {}) {
  const aiOperation = method === 'POST' && (/^\/(?:job-evaluations|applications\/[^/]+\/materials|materials\/[^/]+\/review)$/.test(path) || path === '/ai/polish');
  const limit = timeout ?? (aiOperation ? 105000 : 30000);
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort(); else signal?.addEventListener('abort', forwardAbort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limit);
  try {
    const response = await fetch('/api' + path, { method, credentials: 'same-origin', signal: controller.signal,
      headers: { ...(method !== 'GET' ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf || '' } : {}) },
      ...(method !== 'GET' ? { body: JSON.stringify(data || {}) } : {}),
    });
    let result;
    try { result = await response.json(); } catch (error) { if (controller.signal.aborted) throw error; throw new Error('服务未返回有效数据，请确认使用的是完整项目的启动入口。'); }
    if (!response.ok) { const err = new Error(result.error || '操作未完成。'); err.status = response.status; err.code = result.code; err.details = result.details; throw err; }
    return result;
  } catch (error) {
    if (timedOut) { const err = new Error('本次等待已超时。材料生成或留档请先按请求编号找回成功结果，再主动重试。'); err.code = 'REQUEST_TIMEOUT'; throw err; }
    if (controller.signal.aborted || error.name === 'AbortError') { const err = new Error('本次请求已取消。'); err.name = 'AbortError'; throw err; }
    if (error instanceof TypeError) throw new Error('连接中断，请确认后端服务正在运行；未保存的内容请先导出。');
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', forwardAbort); }
}
