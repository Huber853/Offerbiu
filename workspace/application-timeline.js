import { api } from './api.js';
import { escape as e } from './ui.js';
import { statuses } from '/shared/templates.mjs';

const formatter = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
function eventTime(value) {
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) ? formatter.format(stamp) : '时间未记录';
}
function statusChange(from, to) {
  if (!to) return '';
  const label = id => statuses.find(s => s.id === id)?.label || '未知状态';
  return `状态：${from ? label(from) + ' → ' : ''}${label(to)}`;
}
function describe({ kind, payload: p }) {
  if (kind === 'saved') return ['加入投递清单'];
  if (kind === 'status_changed') return ['变更投递状态', statusChange(p.from, p.to)];
  if (kind === 'task_created') return [
    '创建关联待办', [p.task_kind, p.title].filter(Boolean).join(' · '),
    p.due_at ? `计划时间：${eventTime(p.due_at)}` : '暂未排期',
  ];
  if (kind === 'submission_recorded') return [
    '记录投递留档', p.sequence && `第 ${p.sequence} 次留档`,
    p.submittedAt && `本人确认的投递时间：${eventTime(p.submittedAt)}`,
    p.channel && `渠道：${p.channel === 'official_portal' ? '官方投递入口' : p.channel}`,
    p.resumeRevision && `使用简历 V${p.resumeRevision}`, statusChange(p.from, p.to),
  ];
  if (kind === 'updated') return [
    '更新投递记录', statusChange(p.status_from, p.status_to),
    (p.resume_bound === true || p.resume_bound === '是') && `绑定简历快照${p.resume_revision ? ' · V' + p.resume_revision : ''}`,
    (p.resume_bound === false || p.resume_bound === '否') && '解除简历快照绑定',
    Object.hasOwn(p, 'applied_at') ? (p.applied_at ? `投递时间：${eventTime(p.applied_at)}` : '清空投递时间') : p.applied_at_set && '更新投递时间',
    Object.hasOwn(p, 'next_date') && (p.next_date ? `下次跟进：${eventTime(p.next_date)}` : '清空下次跟进时间'),
    p.notes_changed && '更新备注',
  ];
  return ['记录进展'];
}

export function mountApplicationTimeline(container, applicationId, { signal } = {}) {
  container.innerHTML = '<details class="application-timeline"><summary>进展时间线</summary><div class="application-timeline-body"></div></details>';
  const details = container.firstElementChild, body = details.lastElementChild;
  const active = () => details.isConnected && !signal?.aborted && (details.closest('dialog')?.open ?? true);
  let loading = false, loaded = false;
  async function load() {
    if (loading || loaded || !active()) return;
    loading = true;
    body.innerHTML = '<p role="status">正在读取进展记录…</p>';
    try {
      const events = await api(`/applications/${encodeURIComponent(applicationId)}/events`, { signal });
      if (!active()) return;
      body.innerHTML = events.length ? `<ol tabindex="0" aria-label="从新到旧的进展记录">${events.map(event => {
        const [title, ...notes] = describe(event);
        return `<li><strong>${e(title)}</strong><time datetime="${e(event.created_at)}">${e(eventTime(event.created_at))}</time>${notes.filter(Boolean).map(note => `<p>${e(note)}</p>`).join('')}</li>`;
      }).join('')}</ol>` : '<p role="status">暂无已记录的进展。之后的变更会在这里显示。</p>';
      loaded = true;
    } catch (error) {
      if (!active() || error.name === 'AbortError') return;
      body.innerHTML = '<p role="status">进展记录加载失败。 <button type="button" class="text-link">重试</button></p>';
      body.querySelector('button').addEventListener('click', load);
    } finally { loading = false; }
  }
  details.addEventListener('toggle', () => { if (details.open) load(); });
}
