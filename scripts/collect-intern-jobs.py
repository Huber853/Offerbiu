"""Collect official internship posts for employers already in the catalog.

Campus collection stays in the existing scripts. This runner keeps only rows
marked recruit_type=实习 and writes them to data/sources/<date>-interns/.
"""
import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('morebrands', ROOT / 'scripts' / 'collect-more-brands.py')
more = importlib.util.module_from_spec(spec)
spec.loader.exec_module(more)
f = more.f
STAMP = f.direct.STAMP
RAW = ROOT / 'data' / 'sources' / f'{STAMP[:10]}-interns'
RAW.mkdir(parents=True, exist_ok=True)
f.RAW = RAW

catalog = json.loads((ROOT / 'data' / 'jobs-2027.json').read_text(encoding='utf-8'))
existing_ids = {job['id'] for job in catalog['jobs']}
existing_external = {(job.get('company'), str(job.get('external_id'))) for job in catalog['jobs']}
skipped = []
rows = json.loads((RAW / 'accepted.json').read_text(encoding='utf-8')) if (RAW / 'accepted.json').exists() else []
for row in rows:
    existing_ids.add(row.get('id'))
    existing_external.add((row.get('company'), str(row.get('external_id'))))


def remember(source, reason):
    skipped.append({'source': source, 'reason': str(reason)[:500]})
    print(json.dumps({'source': source, 'skipped': str(reason)[:240]}, ensure_ascii=False), flush=True)


def keep(source, batch):
    accepted = []
    for row in batch or []:
        if not isinstance(row, dict) or row.get('recruit_type') != '实习':
            continue
        if row.get('id') in existing_ids or (row.get('company'), str(row.get('external_id'))) in existing_external:
            continue
        if not row.get('description') or not row.get('requirements') or not row.get('external_id'):
            continue
        accepted.append(row)
        existing_ids.add(row['id'])
        existing_external.add((row.get('company'), str(row.get('external_id'))))
    rows.extend(accepted)
    (RAW / 'accepted.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'source': source, 'internships': len(accepted), 'total': len(rows)}, ensure_ascii=False), flush=True)
    return accepted


def netease_daily():
    """网易招聘官网日常实习生 channel linked from the campus navigation."""
    endpoint = 'https://hr.163.com/api/hr163/position/queryPage'
    first = json.loads(f.read(endpoint, 'netease-hr-page-1.json', {'currentPage': 1, 'pageSize': 100, 'workType': 1}))['data']
    items = list(first.get('list') or [])
    for n in range(2, int(first.get('pages') or 1) + 1):
        page = json.loads(f.read(endpoint, f'netease-hr-page-{n}.json', {'currentPage': n, 'pageSize': 100, 'workType': 1}))['data']
        items += page.get('list') or []
    result = []
    for index, item in enumerate(items):
        if str(item.get('workType')) != '1':
            continue
        title = item.get('name') or ''
        if '兼职' in title:
            continue
        jid = item.get('id')
        url = f'https://hr.163.com/job-detail.html?id={jid}'
        # The list payload is the official posting body; source_file points at that page.
        page_no = 1 + index // 100
        row = f.make('网易', 'netease', jid, title, item.get('workPlaceNameList') or [], url,
                     item.get('description'), item.get('requirement'),
                     '网易招聘官网日常实习生渠道（workType=1）。', url, f'netease-hr-page-{page_no}.json',
                     industry='互联网与软件', category_raw=item.get('firstPostTypeName'),
                     program='日常实习生', batch='日常实习', employer_unit=item.get('productName') or item.get('firstDepName'),
                     education=item.get('reqEducationName') or None, headcount=item.get('recruitNum') or None,
                     updated_at=f.direct.iso(item.get('updateTime')), intern=True)
        if row:
            result.append(row)
    return result


def tme():
    endpoint = 'https://join.tencentmusic.com/api/uc-job/list'
    first = json.loads(f.read(endpoint, 'tme-page-1.json'))['data']
    items = list(first['items'])
    for n in range(2, int(first['_meta']['page_count']) + 1):
        items += json.loads(f.read(endpoint + f'?page={n}', f'tme-page-{n}.json'))['data']['items']
    selected = [item for item in items if int(item.get('job_type') or 0) == 30 and '实习' in (item.get('name') or '')]

    def detail(item):
        external_id = str(item['id'])
        name = f'tme-detail-{external_id}.json'
        payload = json.loads(f.read(f'https://join.tencentmusic.com/api/uc-job/info?id={external_id}', name))
        if str(payload.get('code')) != '200':
            return None
        data = payload.get('data') or {}
        if '实习' not in (data.get('name') or '') and '实习' not in (data.get('job_type_descr') or ''):
            return None
        url = 'https://join.tencentmusic.com/campus/post-details?id=' + external_id
        proof = '官网职位类型：' + (data.get('job_type_descr') or '实习') + '。'
        return f.make('腾讯音乐', 'tencentmusic', external_id, data.get('name'), [city.get('label') for city in data.get('work_city') or []],
                      url, data.get('duty'), data.get('requirement'), proof, url, name, industry='游戏与文娱',
                      program=data.get('job_type_descr') or '实习', employer_unit=data.get('setid_descr'), intern=True,
                      published_at=f.direct.iso(data.get('date')))

    return f.parallel(detail, selected, 4)


def baidu():
    landing = f.read('https://talent.baidu.com/jobs/list?recruitType=INTERN', 'baidu-intern.html')
    if '实习' not in landing.decode('utf-8', 'replace'):
        raise RuntimeError('百度实习列表页没有实习说明')
    endpoint = 'https://talent.baidu.com/httservice/getPostListNew'
    for recruit in ('INTERN', 'TRAINEE'):
        raw = json.loads(f.read(endpoint, f'baidu-{recruit.lower()}.json', {'recruitType': recruit, 'pageSize': 10, 'curPage': 1, 'keyWord': '', 'projectType': ''}))
        if raw.get('status') != 'ok':
            raise RuntimeError(raw.get('message') or raw.get('status') or '百度实习接口不可用')
    return []


def run_named(name, fn):
    try:
        keep(name, fn())
    except Exception as error:
        remember(name, error)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--companies', default='all')
    args = parser.parse_args()
    wanted = set(args.companies.split(',')) if args.companies != 'all' else None

    def enabled(name):
        return wanted is None or name in wanted

    for name, fn in [('alibaba', f.alibaba), ('oppo', f.oppo), ('vivo', f.vivo), ('netease', f.netease), ('mihoyo', f.mihoyo),
                     ('kuaishou', f.kuaishou), ('xiaohongshu', f.xhs), ('tencent', f.tencent), ('meituan', f.meituan),
                     ('huawei', more.huawei), ('pinduoduo', more.pinduoduo), ('bilibili', more.bilibili), ('didi', more.didi),
                     ('tencentmusic', tme), ('baidu', baidu), ('netease-daily', netease_daily)]:
        if enabled(name):
            run_named(name, fn)
    for site in f.FEISHU:
        label = site[1] + ':' + site[3]
        if not enabled(label) and not enabled(site[1]) and not enabled('feishu'):
            continue
        try:
            keep(site[0] + '/' + site[3], f.feishu(site, recruitment_ids=['202'], workers=4))
        except Exception as error:
            remember(site[0] + '/' + site[3], error)
    (RAW / 'manifest.json').write_text(json.dumps(f.MANIFEST, ensure_ascii=False, indent=2), encoding='utf-8')
    (RAW / 'skipped.json').write_text(json.dumps(skipped, ensure_ascii=False, indent=2), encoding='utf-8')
    counts = {}
    for row in rows:
        counts[row['company']] = counts.get(row['company'], 0) + 1
    summary = {'accepted': len(rows), 'companies': counts, 'skipped': skipped}
    (RAW / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(summary, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
