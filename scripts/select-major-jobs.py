"""Select the postings that fit an information management / information systems background.

Read-only view over data/jobs-2027.json: nothing here changes the catalog or the
source policy. The output is a shortlist by relevance tier for one major, produced
by title keywords instead of a hand written list so it can be regenerated after
every collection batch.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'data/jobs-2027.json'

TIERS = [
    ('A 核心对口', r'需求分析|实施顾问|实施工程|ERP|管理软件|信息化|数字化|系统运维|运维工程|售前|解决方案|产品经理|产品专员|数据开发|数据分析|数据治理|BI工程|系统集成|IT咨询|技术顾问|业务分析'),
    ('B 紧密相关', r'项目管理|供应链|物流|计划(管理|专员|工程)|采购|仓储|财务(系统|信息化|共享)|审计(信息|系统)|风控|系统|软件|技术|运营(分析|支持)|技术支持|信息安全|网络安全|数据库|测试|数据'),
    ('C 管培与职能', r'管培生|管理培训生|储备(干部|人才)|综合管理|人力资源|行政'),
]

# Hardware, process and teaching roles are excluded even when a broad keyword matches.
EXCLUDE = r'工艺|设备|机械|结构|模具|电气工程|硬件|射频|模拟电路|版图|光学|声学|材料|化工|焊接|涂装|装配|质量工程|临床|医药代表|护士|教师|主讲|讲师|客服|主播|摄影|平面设计|原画|动画|特效|美术|服装|厨师|保安|司机|施工|土建|测绘'

jobs = json.loads(SEED.read_text(encoding='utf-8'))['jobs']
buckets = defaultdict(list)
for job in jobs:
    title = job.get('title') or ''
    if re.search(EXCLUDE, title):
        continue
    for tier, pattern in TIERS:
        if re.search(pattern, title):
            buckets[tier].append(job)
            break

summary = {'total_jobs': len(jobs), 'tiers': {}}
for tier, _ in TIERS:
    rows = buckets[tier]
    companies = Counter(row['company'] for row in rows)
    lines = []
    for row in sorted(rows, key=lambda r: (r['company'], r['title'])):
        lines.append({'company': row['company'], 'title': row['title'], 'cities': row.get('cities'),
                      'industry': row.get('industry'), 'category': row.get('category'),
                      'education': row.get('education'), 'apply_url': row.get('apply_url')})
    summary['tiers'][tier] = {'count': len(rows), 'companies': len(companies),
                              'top_companies': companies.most_common(15), 'jobs': lines}

(ROOT / 'data/imis-related-jobs.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')

report = ['# 信息管理与信息系统 对口岗位速查', '',
          f'数据口径：`data/jobs-2027.json` 共 {len(jobs)} 条岗位，按标题关键词分层筛选（已剔除工艺/设备/硬件/设计/教学等方向）。',
          '链接均为企业官方单岗位投递页。', '']
for tier, _ in TIERS:
    block = summary['tiers'][tier]
    report.append(f'## {tier}（{block["count"]} 条 / {block["companies"]} 家公司）')
    report.append('')
    report.append('| 公司 | 代表岗位 | 城市 | 行业 |')
    report.append('| --- | --- | --- | --- |')
    seen = set()
    for row in block['jobs']:
        if row['company'] in seen:
            continue
        seen.add(row['company'])
        cities = '、'.join(row['cities'] or []) or '未注明'
        report.append(f'| {row["company"]} | {row["title"]} | {cities} | {row.get("industry") or ""} |')
        if len(seen) >= 40:
            break
    report.append('')
(ROOT / 'docs/imis-job-guide.md').write_text('\n'.join(report), encoding='utf-8')

print(json.dumps({tier: summary['tiers'][tier]['count'] for tier, _ in TIERS}, ensure_ascii=False))
for tier, _ in TIERS:
    print(tier, [f'{name}:{count}' for name, count in summary['tiers'][tier]['top_companies'][:8]])
