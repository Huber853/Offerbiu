import fs from 'node:fs';

export const sourcePolicy = JSON.parse(fs.readFileSync(new URL('../data/job-source-policy.json', import.meta.url), 'utf8'));
export function acceptsJob(job) {
  if (job.source_policy !== sourcePolicy.version || job.record_type !== 'job' || Number(job.cohort) !== sourcePolicy.cohort || job.direct_apply_verified !== true || job.catalog_status !== 'active') return false;
  if (!job.external_id || !job.title || !job.description || !job.cohort_evidence || /实习生|实习岗位|招聘公告|招募计划/.test(job.title)) return false;
  try {
    const source = new URL(job.source_url), apply = new URL(job.apply_url), evidence = new URL(job.cohort_evidence_url);
    const rule = sourcePolicy.sources.find(r => r.host === source.hostname && r.source_type === job.source_type);
    if (!rule || (rule.company && rule.company !== job.company)) return false;
    if (![source, apply, evidence].every(u => u.protocol === 'https:' && !u.username && !u.password)) return false;
    if (![source, apply].every(u => u.hostname === rule.host)) return false;
    if (evidence.hostname !== rule.host && !rule.evidence_urls?.includes(evidence.href)) return false;
    if (rule.project_id && (job.source_project_id !== rule.project_id || job.source_authorization_url !== rule.authorization_url)) return false;
    if (job.source_type === 'nwu_official' && job.source_school_id !== sourcePolicy.school_id) return false;
    return [source, apply].every(u => {
      if (!new RegExp(rule.path_pattern).test(u.pathname)) return false;
      const routeId = rule.id_fragment_pattern ? u.hash.slice(1).match(new RegExp(rule.id_fragment_pattern))?.[1]
        : rule.id_path_pattern ? u.pathname.match(new RegExp(rule.id_path_pattern))?.[1]
        : rule.id_query ? u.searchParams.get(rule.id_query) : decodeURIComponent(u.pathname.split('/').pop());
      return routeId === String(job.external_id);
    });
  } catch { return false; }
}
