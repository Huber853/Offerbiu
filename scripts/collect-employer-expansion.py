"""Collect concrete graduate vacancies from reviewed employer-owned portals.

Read-only anonymous recruitment requests; never submits applications.
Each title must explicitly identify the 2027 cohort, and detail content must
contain an application entry. Locations are never expanded into extra jobs.
"""
import concurrent.futures
import argparse
import datetime as dt
import gzip
import importlib.util
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('direct', ROOT/'scripts/collect-direct-jobs.py')
direct = importlib.util.module_from_spec(spec)
spec.loader.exec_module(direct)
parser = argparse.ArgumentParser()
parser.add_argument('--batch', default=direct.STAMP[:10], help='Evidence snapshot date, YYYY-MM-DD')
args = parser.parse_args()
if not re.fullmatch(r'\d{4}-\d{2}-\d{2}', args.batch): parser.error('Invalid batch date')
direct.RAW = ROOT/'data/sources'/f'{args.batch}-employers'
direct.RAW.mkdir(parents=True, exist_ok=True)
REJECTED = []
SITES = [
    ('kedacom', '苏州科达', '电子与智能制造', 'https://kedacom.zhiye.com/Campus', 'zpdetail'),
    ('jingce', '精测电子', '电子与智能制造', 'https://jingce.zhiye.com/Campus', 'zpdetail'),
    ('telink', '泰凌微电子', '半导体与芯片', 'https://telink.zhiye.com/Campus', 'zpdetail'),
    ('smic', '中芯国际', '半导体与芯片', 'https://smics.zhiye.com/campus/', 'campusxq'),
    ('eswin', '奕斯伟计算', '半导体与芯片', 'https://eswinchipch.zhiye.com/campus', 'campusxq'),
    ('gtgroup', '绿城中国', '建筑与房地产', 'https://gtgroup.zhiye.com/Campus', 'zpdetail'),
]

def read(url, name, payload=None, headers=None):
    raw = direct.read(url, name, payload, headers)
    return gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw

def soup(url, name):
    return BeautifulSoup(read(url, name), 'html.parser')

def observed(name):
    return dt.datetime.fromtimestamp((direct.RAW/name).stat().st_mtime, dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')

def cities(value):
    result = []
    for location in re.split(r'[,，、;；/]', value or ''):
        pieces = [p.strip() for p in re.split(r'[-·]', location) if p.strip()]
        if not pieces: continue
        city = next((p for p in pieces if p.endswith(('市', '自治州', '地区'))), pieces[0])
        city = city.removesuffix('市')
        if city and city not in result: result.append(city)
    return result

def field(box, name):
    for li in box.select('li'):
        text = li.get_text(' ', strip=True)
        m = re.match(re.escape(name)+r'\s*[：:]\s*(.*)', text, re.S)
        if m:
            value=m.group(1).strip()
            # Older Beisen templates put the label and value in adjacent li's.
            if not value and 'ntitle' in li.get('class', []):
                sibling=li.find_next_sibling('li')
                if sibling and 'ntitle' not in sibling.get('class', []):
                    value=sibling.get_text(' ',strip=True)
            return value
    return None

def parse_detail(site, job):
    key, company, industry, listing, route = site
    external_id, url = job
    name = f'{key}-detail-{external_id}.html'
    try:
        s = soup(url, name)
        title_node = s.select_one('.boxSupertitle span, .xqtitle h2, h2.xqtitle')
        if not title_node: raise ValueError('没有识别到单岗位标题')
        title = title_node.get_text(' ', strip=True)
        if not re.search(r'2027|27届', title) or re.search(r'实习|校园大使|招聘公告|招募计划', title):
            raise ValueError('非明确2027届全职具体岗位')
        detail = s.select_one('.xiangqingtext')
        if detail:
            text = detail.get_text('\n', strip=True)
            body, _, requirements = text.partition('任职资格：')
            body = body.removeprefix('工作职责：').strip()
            box = title_node
            while box.parent and not box.select_one('.xiangqingtext'): box = box.parent
        else:
            box = s.select_one('.xqbox, .zwr')
            sections = box.select('.xqm, .xwm') if box else []
            if len(sections) < 2: raise ValueError('未识别职责与要求')
            body, requirements = [x.get_text('\n', strip=True) for x in sections[:2]]
        if not body or not requirements: raise ValueError('职责或要求为空')
        if not re.search('现在申请|立即申请|我要申请|立即投递', box.get_text(' ', strip=True)):
            raise ValueError('详情无投递入口')
        if field(box, '工作性质') not in (None, '', '全职'): raise ValueError('非全职')
        loc = field(box, '工作地点')
        row = direct.base(company, f'{key}:{external_id}', title, cities(loc), url, 'employer_official')
        row.update(external_id=external_id, industry=industry, description=body, requirements=requirements,
            collected_at=observed(name),link_checked_at=observed(name),
            cities_raw=[loc] if loc else [], education=field(box, '职位学历'), salary=field(box, '薪资范围'),
            headcount=field(box, '招聘人数'), category_raw=field(box, '职位类别') or '',
            published_at=direct.iso(field(box, '发布时间')), updated_at=direct.iso((field(box, '更新时间') or '').replace('.', '-')),
            source_file=str((direct.RAW/name).relative_to(ROOT)).replace('\\', '/'),
            cohort_evidence='企业校园招聘单岗位标题明确标注2027：'+title,
            notes='企业专属招聘站的真实岗位编号；详情页含申请按钮，登录后由本人投递。')
        row['deadline'] = direct.iso(field(box, '截止时间'))
        if row['deadline'] and row['deadline'] < direct.STAMP[:10]: raise ValueError('已超过官网截止日期')
        return row
    except Exception as error:
        REJECTED.append(dict(company=company, url=url, reason=str(error)))
        return None

def ssr(site):
    key, company, industry, listing, route = site
    origin = 'https://'+urllib.parse.urlparse(listing).hostname
    pending = [(listing, key+'.html')]
    visited = set()
    jobs = {}
    while pending and len(visited) < 40:
        url, name = pending.pop(0)
        if url in visited: continue
        visited.add(url)
        try: s = soup(url, name)
        except Exception as error:
            REJECTED.append(dict(company=company, url=url, reason=str(error))); continue
        for a in s.select('a[href]'):
            href = urllib.parse.urljoin(origin, a['href']); u = urllib.parse.urlparse(href)
            if u.hostname != urllib.parse.urlparse(origin).hostname: continue
            if u.path == '/campusxq' and route == 'campusxq':
                jid = urllib.parse.parse_qs(u.query).get('jobId', [''])[0]
                if jid and re.search('2027|27届', a.get_text()): jobs[jid] = origin+'/campusxq?jobId='+jid
            elif re.fullmatch(r'/zpdetail/\d+', u.path) and route == 'zpdetail':
                if re.search('2027|27届', a.get_text()): jobs[u.path.rsplit('/',1)[1]] = origin+u.path
            if '下一页' in a.get_text() and 'PageIndex=' in u.query:
                page = urllib.parse.parse_qs(u.query).get('PageIndex', ['0'])[0]
                if page.isdigit() and int(page) > 1: pending.append((href, f'{key}-page-{page}.html'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        rows = [r for r in pool.map(lambda j: parse_detail(site, j), jobs.items()) if r]
    print(json.dumps({'company':company,'listed':len(jobs),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

def cnnc():
    origin='https://cnnc.zhiye.com'
    html=read(origin+'/Campus','cnnc.html').decode('utf-8-sig')
    config=json.JSONDecoder().raw_decode(html.split('var BSGlobal =',1)[1].lstrip())[0]
    payload={'PageIndex':0,'PageSize':20,'Category':[2],'PortalId':config['PortalId'],
             'DisplayFields':['JobAdName','Category','Kind','LocId','Org','PostDate','Degree'], 'SpecialType':0,'KeyWords':'2027'}
    headers={'Content-Type':'application/json','Referer':origin+'/Campus'}
    first=json.loads(read(origin+'/api/Jobad/GetJobAdPageList','cnnc-list-0.json',json.dumps(payload).encode(),headers))
    listed=list(first['Data'])
    for page in range(1,(first['Count']+19)//20):
        payload['PageIndex']=page
        listed+=json.loads(read(origin+'/api/Jobad/GetJobAdPageList',f'cnnc-list-{page}.json',json.dumps(payload).encode(),headers))['Data']
    def detail(item):
        jid=item['Id'];name=f'cnnc-detail-{jid}.json'
        try:
            if item.get('Kind')!='全职' or re.search(r'实习|校园大使|招聘公告|类(?:\(J\d+\))?$',item['JobAdName']):return None
            query=urllib.parse.urlencode({'jobAdId':jid,'category':2,'displayFields':json.dumps(['JobAdName','LocId','Degree','Duty','Require'])})
            result=json.loads(read(origin+'/api/JobAd/GetJobAdInfo?'+query,name,headers=headers))
            d=result.get('Data') or {}
            if result.get('Code')!=200 or d.get('Status')!=1 or d.get('JobAdName')!=item['JobAdName']:raise ValueError('岗位详情不匹配或关闭')
            evidence=re.search(r'.{0,35}2027.{0,50}',d['JobAdName']+' '+direct.clean(d.get('Require')))
            if not evidence: raise ValueError('岗位缺少2027届依据')
            url=origin+'/campus/detail?jobAdId='+jid
            row=direct.base('中核集团','cnnc:'+jid,d['JobAdName'],cities(','.join(d.get('LocNames') or item.get('LocNames') or [])),url,'employer_official')
            row.update(external_id=jid,industry='能源与电力',employer_unit=d.get('Org') or item.get('Org'),
                collected_at=observed(name),link_checked_at=observed(name),
                description=direct.clean(d.get('Duty') or item.get('Duty')),requirements=direct.clean(d.get('Require') or item.get('Require')),
                education=d.get('Degree') or item.get('Degree'),salary=d.get('Salary') or item.get('Salary'),
                published_at=direct.iso(item.get('PostDate')),updated_at=direct.iso(item.get('ChangeDate')),
                source_file=str((direct.RAW/name).relative_to(ROOT)).replace('\\','/'),
                cities_raw=d.get('LocNames') or item.get('LocNames') or [],
                cohort_evidence='中核集团单岗位标题或任职要求：'+evidence.group(0),
                company_nature='央企及所属企业',company_nature_source='https://www.cnnc.com.cn/',
                notes='中核集团官方招聘门户，招聘单位以岗位所列成员单位为准；真实GUID直达官方岗位详情与投递入口。')
            if not row['description'] or not row['requirements']:raise ValueError('正文不完整')
            return row
        except Exception as error:
            REJECTED.append(dict(company='中核集团',id=jid,reason=str(error)));return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: rows=[r for r in pool.map(detail,listed) if r]
    print(json.dumps({'company':'中核集团','listed':len(listed),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

def boc():
    portal='https://campus.chinahr.com/pages/2027-boc/'
    html=read(portal,'boc.html').decode('utf-8-sig')
    config=json.JSONDecoder().raw_decode(html.split('window.chinahr_cmp_json_data =',1)[1].lstrip())[0]
    jobs_config=config['jobs']
    query=urllib.parse.urlencode({'token':jobs_config['token'],'page':1,'pageSize':10000})
    result=json.loads(read('https://ats.chinahr.com/api/job/list?'+query,'boc-alljobs.json'))
    if result.get('code')!=1: raise ValueError('中国银行官方岗位列表读取失败')
    companies=json.loads(read('https://ats.chinahr.com/api/company/list?'+query,'boc-companies.json'))
    orgs={r['id']:r for r in companies.get('retMsg',[])}
    project='6a82a408f6bf3d0ac213d518'
    def detail(item):
        jid=item['id'];url='https://applyjob.chinahr.com/apply/job/wish/'+jid
        try:
            text=direct.clean(item['jobDesc'])
            if '2027' not in text or item.get('isShow')!=1 or item.get('isStart')!=1 or item.get('experience')!='应届毕业生':return None
            if re.search('实习|专项计划岗位',item['name']):return None
            deadline=direct.iso(item.get('applyEndTime'))
            if deadline and deadline<direct.STAMP[:10]:return None
            # The campaign's public jobs component generates this exact URL.
            # Its login redirect must retain this job AND the BOC campaign ID.
            checkfile=direct.RAW/f'boc-redirect-{jid}.json'
            if checkfile.exists(): check=json.loads(checkfile.read_text(encoding='utf-8'))
            else:
                with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=25) as response:
                    destination=response.url
                    response.read()
                check={'url':url,'destination':destination,'checked_at':direct.STAMP}
                checkfile.write_text(json.dumps(check,ensure_ascii=False),encoding='utf-8')
            decoded=urllib.parse.unquote(check['destination'])
            if urllib.parse.urlparse(check['destination']).hostname!='user.chinahr.com' or ('jobId='+jid) not in decoded or ('projectId='+project) not in decoded:
                raise ValueError('单岗位登录回跳未保留本岗位及中国银行项目ID')
            locations=list(dict.fromkeys((r.get('city') or r.get('province')) for r in item.get('workPlaceList',[]) if r.get('city') or r.get('province')))
            row=direct.base('中国银行','boc:'+jid,item['name'],locations,url,'employer_official')
            body,_,requirements=text.partition('招聘条件及要求：')
            org=orgs.get(item['companyId']);units=[];visited=set()
            while org and org['id'] not in visited and org['id']!=jobs_config['firstId']:
                visited.add(org['id'])
                if org['name']!=item['name']: units.insert(0,org['name'])
                org=orgs.get(org.get('parentId'))
            row.update(external_id=jid,industry='银行与金融',company_nature='国有银行',
                employer_unit=' / '.join(units) or item.get('companyName'),official_job_code=item.get('jobNo'),source_project_id=project,
                description=body.removeprefix('职位介绍：').strip(),requirements=requirements.strip() or text,
                cities_raw=[item.get('address')],education=item.get('education'),headcount=item.get('recruitNumber'),
                published_at=None,deadline=deadline,link_checked_at=check['checked_at'],collected_at=observed('boc-alljobs.json'),
                cohort_evidence='岗位要求明确引用《中国银行股份有限公司2027年全球校园招聘条件》。',cohort_evidence_url=portal,
                source_file=str((direct.RAW/'boc-alljobs.json').relative_to(ROOT)).replace('\\','/'),
                source_authorization_url='https://www.boc.cn/big5/aboutboc/bi4/202609/t20260903_25689311.html',
                notes='中国银行官网公告指定的招聘系统；此链接直接选择该岗位，登录后继续投递。已核对回跳岗位ID及本届招聘项目ID。各分行同名岗位按官网独立ID保留，不拆分多城市岗位。')
            return row
        except Exception as error:
            REJECTED.append(dict(company='中国银行',id=jid,reason=str(error)));return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool: rows=[r for r in pool.map(detail,result['retMsg']) if r]
    print(json.dumps({'company':'中国银行','listed':len(result['retMsg']),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

if __name__=='__main__':
    rows=cnnc()
    for site in SITES: rows.extend(ssr(site))
    rows.extend(boc())
    rows=list({r['id']:r for r in rows}.values())
    for name,data in [('accepted.json',rows),('manifest.json',direct.MANIFEST),('excluded.json',REJECTED)]:
        (direct.RAW/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'accepted':len(rows),'excluded':len(REJECTED)},ensure_ascii=False))
