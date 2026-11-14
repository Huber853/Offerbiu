import fs from 'node:fs';
import { getProfile, createProfileRedactor } from './candidate-profile.mjs';
import { HttpError } from './security.mjs';

export const hrResumeSkillPrompt = fs.readFileSync(new URL('./prompts/hr-resume-skill.txt', import.meta.url), 'utf8').trim();

const VERB_LADDER = [
  { rank: 1, label: '支持/协助', pattern: /(?<!不)(?:支持|协助)/u },
  { rank: 2, label: '参与', pattern: /(?<!未)参与/u },
  { rank: 3, label: '负责', pattern: /(?<!不)负责(?!人)/u },
  { rank: 4, label: '推动', pattern: /(?<!不)推动/u },
  { rank: 5, label: '主导', pattern: /(?<!不)主导/u },
];

const BOUNDED_PHRASES = ['精通', '专家', '独立负责', '全面负责', '领导', '带领', '从零到一', '架构师', '总监', '经理', '主管', '负责人', '组长', '显著', '大幅', '成功上线', '生产环境', '商业化', '百万', '千万', '亿级', '高并发', '高可用', '分布式', '熟练掌握', '赋能', '闭环', '抓手', '沉淀', '拉通', '雅思', '托福'];

function reject(message) {
  throw new HttpError(502, message, 'AI_OUTPUT_INVALID');
}

function normalizeDigits(value) {
  return value.replace(/[０-９]/g, char => String.fromCharCode(char.charCodeAt(0) - 0xFF10 + 0x30)).replace(/％/g, '%');
}

function numericClaims(value) {
  const normalized = normalizeDigits(value).replace(/\d{4}[-/.年]\d{1,2}(?:[-/.月]\d{1,2}日?)?月?/g, match => {
    const parts = match.match(/\d+/g);
    return parts[0] + '-' + parts.slice(1).map(part => part.padStart(2, '0')).join('-');
  });
  return new Set([
    ...(normalized.match(/\d{4}-\d{2}(?:-\d{2})?/g) || []),
    ...(normalized.match(/\d+(?:[.,]\d+)*(?:\s*%)?/g) || []).map(part => part.replace(/\s/g, '')),
    ...(normalizeDigits(value).match(/(?:第)?[零〇一二两三四五六七八九十百千万亿]+(?:年|月|日|天|人|个|项|次|倍|分|名|周|小时|分钟|元|条|家|所|套|份|万|亿)/g) || []),
  ]);
}

function latinTokens(value) {
  return new Set((value.match(/[A-Za-z][A-Za-z\d]*(?:[.+#/-][A-Za-z\d+#]+)*/g) || []).map(token => token.toLowerCase()));
}

function entityClaims(value) {
  return (value.match(/[\p{Script=Han}A-Za-z0-9·]{2,40}(?:大学|学院|公司|集团|研究院|实验室|学校)/gu) || [])
    .map(entity => entity.replace(/^(?:曾就读于|曾任职于|曾实习于|曾工作于|就读于|毕业于|任职于|实习于|工作于|就职于|服务于|来自|加入|负责|协助|参与|曾在|在|于|为)/u, ''));
}

function verbHits(value) {
  return VERB_LADDER.filter(item => new RegExp(item.pattern.source, item.pattern.flags).test(value));
}

/** Confirmed profile facts the polish call may use. Contact text is removed first. */
export function confirmedFactSnippets(userId) {
  const profile = getProfile(userId);
  const redact = createProfileRedactor(userId);
  const snippets = [];
  let used = 0;
  for (const fact of profile.facts || []) {
    if (fact?.status !== 'confirmed' || typeof fact.text !== 'string') continue;
    const safe = redact(fact.text).replace(/[ \t\f\v]+/g, ' ').trim().slice(0, 500);
    if (!safe) continue;
    if (snippets.length >= 40 || used + safe.length > 6000) break;
    snippets.push({ id: String(fact.id).slice(0, 80), kind: String(fact.kind || '').slice(0, 40), text: safe });
    used += safe.length;
  }
  return snippets;
}

/**
 * Reject a proposed paragraph that adds metrics, tools, employers, or a stronger
 * contribution verb than the selected text and confirmed facts support.
 * Job-description text is intentionally not evidence.
 */
export function screenPolishRevision(original, revised, extraEvidence = []) {
  const evidence = [original, ...extraEvidence].filter(item => typeof item === 'string').join('\n');
  const evidenceNumbers = numericClaims(evidence);
  for (const claim of numericClaims(revised)) {
    if (!evidenceNumbers.has(claim)) reject('润色建议写入了原文和已确认事实里没有的数字，未保存，简历未改。');
  }
  const allowedRank = verbHits(evidence).reduce((rank, item) => Math.max(rank, item.rank), 0);
  const raised = verbHits(revised).filter(item => item.rank > allowedRank);
  if (raised.length) reject(`润色建议把职责动词提高到「${raised.map(item => item.label).join('、')}」，超过原文和已确认事实允许的强度（支持/协助 < 参与 < 负责 < 推动 < 主导）。未保存，简历未改。`);
  for (const phrase of BOUNDED_PHRASES) {
    if (revised.includes(phrase) && !evidence.includes(phrase)) reject(`润色建议使用了证据之外的表述「${phrase}」。未保存，简历未改。`);
  }
  const knownTokens = latinTokens(evidence);
  for (const token of latinTokens(revised)) {
    if (!knownTokens.has(token)) reject(`润色建议写入了证据之外的工具或英文专名「${token}」。未保存，简历未改。`);
  }
  for (const claim of entityClaims(revised)) {
    if (claim && !evidence.includes(claim) && !entityClaims(evidence).includes(claim)) reject(`润色建议写入了证据之外的学校或公司「${claim}」。未保存，简历未改。`);
  }
}
