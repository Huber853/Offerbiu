"""Public, concrete 2027 jobs from the employer's portal and NWU only.

No applications are submitted. Anonymous NWU requests match its public frontend.
"""
import base64
import concurrent.futures
import datetime as dt
import hashlib
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from bs4 import BeautifulSoup

ROOT=Path(__file__).resolve().parents[1]
STAMP=dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
RAW=ROOT/'data/sources'/f'{STAMP[:10]}-official'
RAW.mkdir(parents=True,exist_ok=True)
SCHOOL='1917e634-eee1-1358-537d-7e36f6f41777'
# The board is ordered newest first and only postings published inside the current
# 2027 cohort window carry per-job cohort evidence, so paging stops once a whole
# page predates the window instead of walking the full archive.
NWU_CUTOFF=int(dt.datetime(2026,8,1,tzinfo=dt.timezone(dt.timedelta(hours=8))).timestamp())
NWU_PAGE_SIZE=200
NWU_MAX_PAGES=60
MANIFEST=[]
REJECTED=[]

def read(url,name,payload=None,headers=None):
    path=RAW/name
    if path.exists(): raw=path.read_bytes()
    else:
        req=urllib.request.Request(url,data=payload,headers={'User-Agent':'Mozilla/5.0',**(headers or {})})
        for attempt in range(2):
            try:
                with urllib.request.urlopen(req,timeout=25) as response: raw=response.read()
                path.write_bytes(raw);break
            except urllib.error.HTTPError: raise
            except (urllib.error.URLError,TimeoutError):
                if attempt:raise
                time.sleep(1)
    observed=dt.datetime.fromtimestamp(path.stat().st_mtime,dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
    MANIFEST.append(dict(url=url,file=str(path.relative_to(ROOT)).replace('\\','/'),sha256=hashlib.sha256(raw).hexdigest(),collected_at=observed))
    return raw

def clean(value):
    return BeautifulSoup(str(value or '').replace('\\n','\n'),'html.parser').get_text(' ',strip=True)

def iso(value):
    if not value:return None
    try:
        if isinstance(value,(int,float)):
            return dt.datetime.fromtimestamp(value/(1000 if value>1e11 else 1),dt.timezone(dt.timedelta(hours=8))).date().isoformat()
        return dt.date.fromisoformat(str(value)[:10]).isoformat()
    except (ValueError,OverflowError,OSError): return None

def base(company,key,title,cities,url,source_type):
    return dict(id=key,external_id=key.split(':')[-1],company=company,title=title,cities=cities,cohort=2027,
                category='其他岗位',record_type='job',listing_kind='official_post' if source_type=='employer_official' else 'nwu_post',
                source_type=source_type,source_name=company+'官方招聘网站' if source_type=='employer_official' else '西北大学就业信息网',
                source_url=url,cohort_evidence_url=url,apply_url=url,direct_apply_verified=True,
                source_policy='official-nwu-v1',catalog_status='active',collected_at=STAMP,link_checked_at=STAMP,
                base_scope='job' if cities else 'unspecified',base_note='岗位详情明确列出的工作地点。' if cities else '该岗位没有明确公布工作地点。',
                employment_type='全职校招',batch='秋招',program='2027届校园招聘',deadline=None,salary=None,education=None,headcount=None,
                published_at=None,updated_at=None,description='',requirements='',notes='',status='采集时岗位在列；实际投递以来源页面为准')

def kingdom():
    origin='https://szkingdom.zhiye.com'
    html=read(origin+'/campus/jobs','kingdom.html').decode('utf-8-sig')
    global_data=json.loads(re.search(r'var BSGlobal = (\{.*?\});',html,re.S).group(1))
    payload={'PageIndex':0,'PageSize':20,'Category':[2],'PortalId':global_data['PortalId'],
             'DisplayFields':['JobAdName','Category','Kind','LocId','PostDate','Degree','Salary'],'SpecialType':0,'KeyWords':''}
    headers={'Content-Type':'application/json','Referer':origin+'/campus/jobs'}
    first=json.loads(read(origin+'/api/Jobad/GetJobAdPageList','kingdom-list-0.json',json.dumps(payload).encode(),headers))
    listed=list(first['Data'])
    for n in range(1,(first['Count']+19)//20):
        payload['PageIndex']=n
        listed+=json.loads(read(origin+'/api/Jobad/GetJobAdPageList',f'kingdom-list-{n}.json',json.dumps(payload).encode(),headers))['Data']
    result=[]
    for item in listed:
        if not re.search(r'2027|27届',item.get('JobAdName','')) or '实习' in item.get('JobAdName','') or item.get('Kind')!='全职':continue
        query=urllib.parse.urlencode({'jobAdId':item['Id'],'category':2,'displayFields':json.dumps(['JobAdName','LocId','Degree','Duty','Require'])})
        detail=json.loads(read(origin+'/api/JobAd/GetJobAdInfo?'+query,'kingdom-detail-'+item['Id']+'.json',headers={'Referer':origin+'/campus/jobs'}))
        d=detail.get('Data') or {}
        if detail.get('Code')!=200 or d.get('Status')==2 or d.get('JobAdName')!=item['JobAdName']:
            REJECTED.append({'source':'金证科技','title':item['JobAdName'],'reason':'岗位详情不匹配或已关闭'});continue
        locations=d.get('LocNames') or item.get('LocNames') or []
        cities=[x.split('·')[-1].removesuffix('市') for x in locations]
        url=origin+'/campus/detail?jobAdId='+item['Id']
        row=base('金证科技','kingdom:'+item['Id'],d['JobAdName'],cities,url,'employer_official')
        row.update(industry='互联网与软件',description=clean(d.get('Duty') or item['Duty']),requirements=clean(d.get('Require') or item['Require']),
                   education=d.get('Degree') or item.get('Degree'),salary=d.get('Salary') or item.get('Salary'),
                   published_at=iso(item['PostDate']),updated_at=iso(item.get('ChangeDate')),external_id=item['Id'],
                   source_file=str((RAW/('kingdom-detail-'+item['Id']+'.json')).relative_to(ROOT)).replace('\\','/'),
                   cohort_evidence='企业校园招聘栏目具体岗位标题明确标注2027届校招。',
                   notes='使用官网前端生成的单岗位详情路由与真实GUID，详情页提供投递入口。登录后由用户本人提交。学历摘要与要求如有冲突，以任职要求为准。')
        if '硕士及以上' in row['requirements'] and row['education']=='本科':row['education']='硕士及以上（任职要求）；官网摘要另标本科'
        result.append(row)
    return result

def nwu():
    conf=read('https://jczx.nwu.edu.cn/js/config.js','nwu-config.txt').decode()
    user=re.search(r'apiuser\s*=\s*"([^"]+)"',conf).group(1)
    password=re.search(r'apipass\s*=\s*"([^"]+)"',conf).group(1)
    fallback='Baisc '+base64.b64encode((user+':'+password).encode()).decode()
    common={'login_user_id':1,'login_admin_school_code':'10697','login_admin_school_id':SCHOOL}
    lock={'value':None,'at':0.0}
    def auth():
        # 2026-09: the public frontend stopped sending the static portal credentials
        # as the auth header and now exchanges them for a short lived lock at
        # /wx/getselock, which is what business requests carry. The static header is
        # kept only as a fallback so an unchanged deployment still works.
        if lock['value'] and time.time()-lock['at']<240:return lock['value']
        exchange=urllib.request.Request('https://a.jiuyeb.cn/mobile.php/wx/getselock?'+urllib.parse.urlencode(common),
            headers={'User-Agent':'Mozilla/5.0','Referer':'https://jczx.nwu.edu.cn/','token':''})
        try:
            with urllib.request.urlopen(exchange,timeout=25) as response:payload=json.loads(response.read())
            lock['value']=(payload.get('data') or {}).get('lock') or fallback
        except Exception:lock['value']=fallback
        lock['at']=time.time()
        return lock['value']
    def request(endpoint,body,name):
        form={**body,**common}
        return json.loads(read('https://a.jiuyeb.cn/mobile.php'+endpoint,name,
            urllib.parse.urlencode(form).encode(),{'Referer':'https://jczx.nwu.edu.cn/','auth':auth()}))
    def page(n):
        try:return request('/job/getlist',{'jobtype':1,'isunion':2,'school_id':SCHOOL,'page':n,'size':NWU_PAGE_SIZE},f'nwu-list-{n}.json')['data']['list']
        except Exception as error:
            REJECTED.append(dict(source='西北大学',page=n,reason=str(error)));return []
    listed=[]
    for n in range(1,NWU_MAX_PAGES+1):
        chunk=page(n)
        if not chunk:break
        listed+=chunk
        if all((j.get('addtime') or 0)<NWU_CUTOFF for j in chunk):break
        time.sleep(0.2)
    unique={j['job_id']:j for j in listed if j.get('school_id')==SCHOOL and j.get('jobtype')==1 and (j.get('addtime') or 0)>=NWU_CUTOFF}
    def detail(j):
        title=j['work_name']
        if re.search(r'类岗位$|类$|校园招聘|招聘简章|招聘公告|招募计划|全球校招|科学研究$|校招岗位|储备人才$',title):
            REJECTED.append(dict(source='西北大学',title=title,reason='名称为招聘计划或宽泛类别'));return None
        try:
            response=request('/job/detail',{'id':j['id']},'nwu-detail-'+j['id']+'.json')
            d=response.get('data') or {};job=d.get('jobInfo') or {}
            text=clean(d.get('remarks') or job.get('remarks'));compact=re.sub(r'\s+','',text)
            evidence=re.search(r'.{0,40}(?:2027.{0,45}(?:毕业|应届|届)|(?:毕业|应届).{0,45}2027|27届).{0,65}',compact)
            if not evidence or d.get('school_id')!=SCHOOL or d.get('isdeliver')!=1 or d.get('status')!=1:
                REJECTED.append(dict(source='西北大学',title=title,company=j['com_id_name'],reason='缺少岗位级2027届依据或投递不可用'));return None
            end=iso(job.get('end_time'))
            if end and end<STAMP[:10]:return None
            city=job.get('city_id_name') or j.get('city_id_name')
            cities=[city.removesuffix('市')] if city and city!='暂无' else []
            url='https://jczx.nwu.edu.cn/Zhaopin/zhiweiDetail.html?jobtype=1&id='+j['id']
            row=base(j['com_id_name'],'nwu:'+j['id'],title,cities,url,'nwu_official')
            row.update(industry=job.get('business_name') or d.get('business_name') or '其他行业',
                       category_raw=job.get('cate_id1_name') or j.get('dalei_id_name'),
                       description=text,requirements='学历：'+(job.get('xueli_id_name') or '详见岗位要求')+'。其余条件见岗位正文。',
                       education=job.get('xueli_id_name'),published_at=iso(d.get('addtime')),deadline=end,
                       cohort_evidence=evidence.group(0),external_id=j['id'],source_school_id=SCHOOL,
                       source_file=str((RAW/('nwu-detail-'+j['id']+'.json')).relative_to(ROOT)).replace('\\','/'),
                       notes='西北大学就业网单岗位发布，带“投递简历”入口，可能需要登录校内账号。只读取公开岗位，不读取学生简历、不代投递。工作城市取岗位字段。')
            low,high=job.get('salary_floor',0),job.get('salay_ceil',0)
            row['salary']=f'{low}–{high} 元/月' if low and high else f'{low} 元/月起' if low else None
            row['headcount']=job.get('person_count')
            return row
        except Exception as error:
            REJECTED.append(dict(source='西北大学',title=title,reason=str(error)));return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        return [row for row in pool.map(detail,unique.values()) if row]

if __name__=='__main__':
    rows=kingdom()+nwu()
    (RAW/'accepted.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (RAW/'manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
    (RAW/'excluded.json').write_text(json.dumps(REJECTED,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'accepted':len(rows),'employer':sum(r['source_type']=='employer_official' for r in rows),'nwu':sum(r['source_type']=='nwu_official' for r in rows),'excluded':len(REJECTED)},ensure_ascii=False))
