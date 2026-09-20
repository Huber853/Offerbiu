"""Read public employer career pages; preserve provenance; no login or third-party feed.
Run: python scripts/collect-jobs.py
"""
import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import math
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'data'
STAMP = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
DAY = STAMP[:10]
RAW = DATA / 'sources' / DAY
RAW.mkdir(parents=True, exist_ok=True)
RECEIPTS = []

def read(url, name, form=None):
    body = urllib.parse.urlencode(form).encode() if form else None
    req = urllib.request.Request(url, data=body, headers={
        'User-Agent': 'Mozilla/5.0',
        'Referer': 'https://talent.baidu.com/jobs/list' if 'talent.baidu.com' in url else 'https://join.tencentmusic.com/campus/post',
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Accept': 'application/json,text/html;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=30) as res:
        payload = res.read()
        status = res.status
    (RAW / name).write_bytes(payload)
    RECEIPTS.append({'url': url, 'method': 'POST' if form else 'GET', 'request_form': form,
                     'file': str((RAW / name).relative_to(ROOT)).replace('\\', '/'),
                     'sha256': hashlib.sha256(payload).hexdigest(), 'http_status': status, 'collected_at': STAMP})
    return payload.decode('utf-8')

def clean(value):
    s = str(value or '').replace('\\n', '\n').replace('\\u002F', '/')
    s = re.sub(r'<(?:br\s*/?|/p|/div)>', '\n', s, flags=re.I)
    return html.unescape(re.sub(r'<[^>]+>', '', s)).strip()

def calendar_date(value):
    """Store only explicit dates; never turn labels such as 一周前 into made-up dates."""
    raw = clean(value)
    try:
        return dt.date.fromisoformat(raw).isoformat() if raw else None
    except ValueError:
        return None

def base(company, external_id, title, cities, category, url):
    return {'id': f'{company}-{external_id}', 'company': company, 'external_id': str(external_id),
            'title': clean(title), 'cities': cities, 'category': category or '综合', 'cohort': 2027,
            'employment_type': '全职校招', 'source_url': url, 'apply_url': url,
            'source_type': 'employer_official', 'status': '采集时官网在列', 'collected_at': STAMP,
            'deadline': None, 'salary': None, 'education': None, 'headcount': None,
            'published_at': None, 'updated_at': None, 'description': '', 'requirements': '',
            'cohort_evidence_url': '', 'cohort_evidence': '', 'notes': '',
            'record_type': 'job', 'listing_kind': 'official_post',
            'industry': '互联网与软件' if company == '百度' else '游戏与文娱',
            'base_scope': 'job' if cities else 'unspecified', 'batch': '秋招'}

def baidu():
    landing = read('https://talent.baidu.com/jobs/list?recruitType=GRADUATE', 'baidu-cohort.html')
    if '全球2027届毕业生' not in landing:
        raise RuntimeError('Baidu campus cohort is no longer explicitly 2027; refusing import.')
    endpoint = 'https://talent.baidu.com/httservice/getPostListNew'
    def page(n):
        raw = json.loads(read(endpoint, f'baidu-page-{n:02d}.json', {'recruitType': 'GRADUATE', 'pageSize': 10, 'curPage': n, 'keyWord': '', 'projectType': ''}))
        if raw.get('status') != 'ok':
            raise RuntimeError(f'Baidu page {n}: {raw.get("message", "unavailable")}')
        return raw['data']
    first = page(1)
    items = list(first.get('list', []))
    for n in range(2, math.ceil(int(first['total']) / 10) + 1):
        time.sleep(.16)
        items.extend(page(n).get('list', []))
    result = []
    for item in items:
        post_id = item['postId']
        row = base('百度', post_id, item['name'], [x.strip() for x in re.split('[、,，/]', clean(item.get('workPlace'))) if x.strip()], item.get('postType'), f'https://talent.baidu.com/jobs/detail/GRADUATE/{post_id}')
        row.update(description=clean(item.get('workContent')), requirements=clean(item.get('serviceCondition')),
                   education=item.get('education') or None, headcount=item.get('recruitNum') or None,
                   published_at=calendar_date(item.get('publishDate')), updated_at=calendar_date(item.get('updateDate')),
                   published_at_raw=clean(item.get('publishDate')) or None, updated_at_raw=clean(item.get('updateDate')) or None,
                   program='2027 校园招聘 · ' + (item.get('projectType') or '校招'),
                   cohort_evidence_url='https://talent.baidu.com/jobs/list?recruitType=GRADUATE',
                   cohort_evidence='官网 GRADUATE 列表明确：面向全球2027届毕业生，毕业时间2026-09-01至2027-08-31。',
                   notes='按官方 postId 去重；多个工作城市不拆分计数。未公布截止时间与薪资。')
        result.append(row)
    return result

def tme():
    faq = read('https://join.tencentmusic.com/campus/faq/', 'tme-cohort.html')
    master = read('https://join.tencentmusic.com/master/', 'tme-master-cohort.html')
    if '2027' not in faq or '2027' not in master:
        raise RuntimeError('TME cohort evidence unavailable; refusing import.')
    endpoint = 'https://join.tencentmusic.com/api/uc-job/list'
    first = json.loads(read(endpoint, 'tme-page-01.json'))['data']
    items = list(first['items'])
    for n in range(2, int(first['_meta']['page_count']) + 1):
        time.sleep(.16)
        items.extend(json.loads(read(endpoint + f'?page={n}', f'tme-page-{n:02d}.json'))['data']['items'])
    selected = {str(x['id']): x for x in items if int(x.get('job_type', 0)) in (10, 40)}
    def detail(kv):
        external_id, listed = kv
        j = json.loads(read(f'https://join.tencentmusic.com/api/uc-job/info?id={external_id}', f'tme-detail-{external_id}.json'))
        if str(j.get('code')) != '200':
            raise RuntimeError(f'TME detail {external_id} unavailable')
        item = j['data']
        row = base('腾讯音乐', external_id, item['name'], [x['label'] for x in item.get('work_city', [])], item.get('jobf_descr'), f'https://join.tencentmusic.com/campus/post-details?id={external_id}')
        doctorate = int(item.get('job_type', 0)) == 40
        row.update(description=clean(item.get('duty')), requirements=clean(item.get('requirement')),
                   program='2027 技术大咖' if doctorate else '2027 校园招聘', department=item.get('setid_descr') or '',
                   education='博士' if doctorate else None, published_at=calendar_date(item.get('date')),
                   published_at_raw=clean(item.get('date')) or None,
                   cohort_evidence_url='https://join.tencentmusic.com/master/' if doctorate else 'https://join.tencentmusic.com/campus/faq/',
                   cohort_evidence='2027 官方招聘项目：毕业时间2026年1月—2027年12月；技术大咖限定博士，应届生项目按岗位要求。',
                   notes='官网复用部分历年岗位编号；date 是接口原始日期，不冒充2026年新发布。岗位当前属于2027项目；官方说明招满即止。')
        return row
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return list(pool.map(detail, selected.items()))

def main():
    all_jobs = baidu() + tme()
    previous_path = DATA / 'jobs-2027.json'
    previous = json.loads(previous_path.read_text(encoding='utf-8')) if previous_path.exists() else {}
    merged = {r['id']: r for r in previous.get('jobs', [])}
    for row in all_jobs:
        old = merged.get(row['id'], {})
        for field in ['record_type', 'listing_kind', 'industry', 'directions', 'batch', 'base_scope', 'base_note', 'source_name']:
            if field in old: row[field] = old[field]
        if 'category_raw' in old:
            row['category_raw'], row['category'] = row['category'], old['category']
            row['cities_raw'] = row['cities']
            row['cities'] = [city.removesuffix('市') for city in row['cities']]
        merged[row['id']] = row
    jobs = list(merged.values())
    jobs.sort(key=lambda x: (x.get('updated_at') or x.get('published_at') or '', x['id']), reverse=True)
    companies = {name: sum(j['company'] == name for j in jobs) for name in sorted({j['company'] for j in jobs})}
    bundle = {**{k:v for k,v in previous.items() if k != 'jobs'}, 'schema_version': previous.get('schema_version', 1), 'collected_at': STAMP, 'count': len(jobs), 'companies': companies,
              'job_count': sum(j.get('record_type') != 'campaign' for j in jobs),
              'campaign_count': sum(j.get('record_type') == 'campaign' for j in jobs), 'company_count': len(companies),
              'scope': previous.get('scope', '2027届全职校园招聘；不含日常实习。'),
              'limitations': previous.get('limitations', '这是采集快照，不是实时招聘状态保证。薪资和截止时间缺失时保留空值。'),
              'jobs': jobs}
    DATA.mkdir(parents=True, exist_ok=True)
    # Replace atomically only after both sources completed; keep previous usable file on failure.
    # Collection writes candidates only. Publication is governed by the shared
    # source policy and per-job application-link checks in publish-direct-jobs.py.
    destination = DATA / 'official-portal-candidates.json'
    draft = DATA / 'official-portal-candidates.pending.json'
    draft.write_text(json.dumps(bundle, ensure_ascii=False, indent=2), encoding='utf-8')
    draft.replace(destination)
    (RAW / 'manifest.json').write_text(json.dumps(RECEIPTS, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'count': len(jobs), 'companies': companies, 'collected_at': STAMP, 'file': str(destination), 'next': 'python scripts/publish-direct-jobs.py'}, ensure_ascii=False))

if __name__ == '__main__':
    main()
