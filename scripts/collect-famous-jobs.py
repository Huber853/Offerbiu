"""Public employer graduate catalogs; no login, resume access or application.

Request contracts and detail routes come from each employer's published frontend.
Only project-confirmed 2027 full-time vacancies are admitted.
"""
import concurrent.futures
import argparse
import datetime as dt
import hashlib
import http.cookiejar
import importlib.util
import json
import math
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('direct',ROOT/'scripts/collect-direct-jobs.py')
direct=importlib.util.module_from_spec(spec);spec.loader.exec_module(direct)
RAW=ROOT/'data/sources'/f'{direct.STAMP[:10]}-brands'
RAW.mkdir(parents=True,exist_ok=True)
MANIFEST=[];FAILURES=[]
USER_AGENT='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'

def read(url,name,body=None,opener=None,headers=None):
    file=RAW/name
    if file.exists(): data=file.read_bytes()
    else:
        req=urllib.request.Request(url,data=json.dumps(body).encode() if body is not None else None,
            headers={'Content-Type':'application/json','User-Agent':USER_AGENT,'Referer':url.split('/api/')[0]+'/','Tenant-Id':'1000',**(headers or {})})
        with (opener.open(req,timeout=25) if opener else urllib.request.urlopen(req,timeout=25)) as response:data=response.read()
        file.write_bytes(data)
    MANIFEST.append({'url':url.split('?_csrf=')[0],'file':str(file.relative_to(ROOT)).replace('\\','/'),'sha256':hashlib.sha256(data).hexdigest(),
        'collected_at':dt.datetime.fromtimestamp(file.stat().st_mtime,dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')})
    return data

def api(url,name,body=None,opener=None,headers=None):
    # A few tenants emit JSON with raw control characters inside strings, which
    # strict mode rejects; retry leniently before letting the caller see a failure.
    data=read(url,name,body,opener,headers)
    try:return json.loads(data)
    except ValueError:return json.loads(data.decode('utf-8','replace'),strict=False)
def loc(value):
    if isinstance(value,str):value=re.split(r'[,，、;；/]',value)
    return list(dict.fromkeys(str(x).strip().removesuffix('市').replace('深圳总部','深圳') for x in value if x and str(x).strip()))
def make(company,prefix,jid,title,places,url,description,requirements,proof,proof_url,name,**extra):
    if re.search(r'实习|校园大使|测试职位|勿投递',title):return None
    if not description or not requirements or not re.search('2027|27届',proof):return None
    row=direct.base(company,prefix+':'+str(jid),title,loc(places),url,'employer_official')
    row.update(external_id=str(jid),description=direct.clean(description),requirements=direct.clean(requirements),
        industry='互联网与软件',company_nature='民营企业',cohort_evidence=proof,cohort_evidence_url=proof_url,
        source_file=str((RAW/name).relative_to(ROOT)).replace('\\','/'),
        notes='企业官方招聘系统公开岗位；按真实岗位ID去重，同岗位多城市不拆分。点击前往本岗位的详情及投递入口，可能需登录。')
    row.update(extra)
    observed=dt.datetime.fromtimestamp((RAW/name).stat().st_mtime,dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
    row.update(collected_at=observed,link_checked_at=observed)
    return row
def parallel(fn,items):
    def safe(item):
        try:return fn(item)
        except Exception as error:FAILURES.append({'item':str(item)[:150],'reason':str(error)});return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:return [r for r in pool.map(safe,items) if r]

def alibaba():
    origin='https://campus-talent.alibaba.com'
    op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    # Obtain a fresh anonymous anti-CSRF token through the normal public page.
    html=op.open(origin+'/',timeout=25).read().decode()
    token=re.search(r'__token__:\s*"([^"]+)"',html).group(1)
    batches=api(origin+'/searchCondition/listBatch?_csrf='+token,'ali-batches.json',{},op)['content']['graduate']
    batch=next(x for x in batches if '2027' in x['name'])
    def page(n):return api(origin+'/position/search?_csrf='+token,f'ali-page-{n}.json',{'batchId':batch['id'],'pageIndex':n,'pageSize':100,'channel':'new_campus_group_official_site','language':'zh'},op)['content']
    first=page(1);jobs=first['datas']
    for n in range(2,math.ceil(first['totalCount']/100)+1):jobs+=page(n)['datas']
    rows=[]
    for index,j in enumerate(jobs):
        if j.get('status')!='recruit':continue
        url=origin+'/campus/position/'+str(j['id'])
        row=make('阿里巴巴','alibaba',j['id'],j['name'],j.get('workLocations') or [],url,j.get('description'),j.get('requirement'),batch['name']+'；'+batch['remark'],origin+'/campus/position?batchId='+str(batch['id']),f'ali-page-{index//100+1}.json',updated_at=direct.iso(j.get('modifyTime')),program=batch['name'])
        if row:rows.append(row)
    return rows

def kuaishou():
    origin='https://campus.kuaishou.cn';root=origin+'/recruit/campus/e/api/v1/open'
    def page(n):return api(root+'/positions/simple',f'ks-page-{n}.json',{'pageNum':n,'pageSize':100})['result']
    first=page(1);jobs=first['list']
    for n in range(2,math.ceil(first['total']/100)+1):jobs+=page(n)['list']
    codes={j['recruitSubProjectCode'] for j in jobs if j.get('positionNatureCode')=='fulltime'}
    projects={code:api(root+'/sub-project/findByCode?code='+code,f'ks-project-{code}.json')['result'] for code in codes}
    eligible=[j for j in jobs if j.get('positionNatureCode')=='fulltime' and '2027' in str(projects.get(j['recruitSubProjectCode'],{}).get('name',''))]
    def detail(j):
        name=f'ks-detail-{j["id"]}.json';d=api(root+'/positions/find?id='+str(j['id']),name)['result'];project=projects[j['recruitSubProjectCode']]
        if d.get('positionStatusCode')!='Release' or d.get('name')!=j['name']:return None
        url=origin+'/#/campus/job-info/'+str(j['id'])
        return make('快手','kuaishou',j['id'],j['name'],[c['name'] for c in d.get('workLocationDicts',[])],url,d.get('description'),d.get('positionDemand'),project['name']+'；岗位性质：全职。',url,name,published_at=direct.iso(d.get('releaseTime')),category_raw=d.get('positionCategoryCode'),program=project['name'])
    return parallel(detail,eligible)

def vivo():
    origin='https://hr-campus.vivo.com';html=read(origin+'/','vivo-campus.html').decode('utf-8-sig')
    config=json.JSONDecoder().raw_decode(html.split('var BSGlobal =',1)[1].lstrip())[0]
    def page(n):return api(origin+'/api/Jobad/GetJobAdPageList',f'vivo-page-{n}.json',{'PageIndex':n,'PageSize':100,'Category':[2],'PortalId':config['PortalId'],'DisplayFields':['JobAdName','Category','Kind','LocId','Org','PostDate','Degree'],'SpecialType':0,'KeyWords':''})
    first=page(0);jobs=first['Data']
    for n in range(1,math.ceil(first['Count']/100)):jobs+=page(n)['Data']
    def detail(j):
        if j.get('Kind')!='全职' or not re.search(r'2027|27届',j['JobAdName']+' '+direct.clean(j.get('Require'))):return None
        name=f'vivo-detail-{j["Id"]}.json';d=api(origin+'/api/JobAd/GetJobAdInfo?'+urllib.parse.urlencode({'jobAdId':j['Id'],'category':2,'displayFields':json.dumps(['JobAdName','LocId','Duty','Require','Degree'])}),name)['Data']
        if d.get('Status')!=1 or d.get('JobAdName')!=j['JobAdName']:return None
        url=origin+'/campus/detail?jobAdId='+j['Id'];cities=[x.split('·')[-1] for x in d.get('LocNames') or j.get('LocNames') or []]
        proof=re.search(r'.{0,25}(?:2027|27届).{0,65}',d['JobAdName']+' '+direct.clean(d.get('Require'))).group(0)
        return make('vivo','vivo',j['Id'],d['JobAdName'],cities,url,d.get('Duty'),d.get('Require'),proof,url,name,industry='消费电子与硬件',employer_unit=j.get('Org'),education=j.get('Degree'),published_at=direct.iso(j.get('PostDate')))
    return parallel(detail,jobs)

def oppo():
    origin='https://careers.oppo.com';projects=api(origin+'/openapi/position/project/list','oppo-projects.json')['data']
    selected=[p for p in projects if '2027' in p['projectName'] and p['recruitmentType'] in ['Graduate','doctor']]
    def page(n):return api(origin+'/openapi/position/pageNew',f'oppo-page-{n}.json',{'pageNum':n,'pageSize':100,'projectList':[{'projectId':p['idRecruitProject'],'recruitmentType':p['recruitmentType'],'isAllNode':'Y','themeList':[]} for p in selected],'positionTypeList':[],'workCityCodeList':[]})['data']
    first=page(1);jobs=first['records']
    for n in range(2,first['pages']+1):jobs+=page(n)['records']
    def detail(j):
        jid=j['idProjPosition'];name=f'oppo-detail-{jid}.json';d=api(origin+'/openapi/position/detail?id='+str(jid),name)['data']
        if not d or d['positionName']!=j['positionName']:return None
        project=next(p for p in selected if p['idRecruitProject']==d['projectId']);url=origin+'/campus/post/'+str(jid)
        return make('OPPO','oppo',jid,d['positionName'],[c['workCityName'] for c in d.get('workCityVOList') or []],url,d.get('positionDesc'),d.get('positionRequire'),project['projectName']+'；'+project['recruitRequire'],url,name,industry='消费电子与硬件',category_raw=d.get('positionTypeName'),published_at=direct.iso(d.get('releaseTime')),program=project['projectName'])
    return parallel(detail,jobs)

def netease():
    origin='https://campus.163.com';projects=api(origin+'/api/campuspc/project/navigation/list','net-projects.json')['data'][0]['children'];rows=[]
    for project in projects:
        if '2027' not in project['title'] or '/app/job/position?id=' not in project['link']:continue
        parsed=urllib.parse.urlparse(project['link']);host='https://'+parsed.hostname;pid=urllib.parse.parse_qs(parsed.query)['id'][0]
        def page(n):return api(host+f'/api/campuspc/position/getJobList?projectId={pid}&currentPage={n}&pageSize=100',f'net-{pid}-page-{n}.json')['data']
        first=page(1);jobs=first['list']
        for n in range(2,math.ceil(first['total']/100)+1):jobs+=page(n)['list']
        for i,j in enumerate(jobs):
            url=host+f'/app/detail/index?id={j["id"]}&projectId={pid}'
            row=make('网易','netease',j['id'],j['positionName'],j.get('workPlaceName') or '',url,j.get('positionDescription'),j.get('positionRequirement'),project['title']+'官方应届生岗位列表。',project['link'],f'net-{pid}-page-{i//100+1}.json',industry='游戏与文娱' if '互娱' in project['title'] else '互联网与软件',category_raw=j.get('positionTypeName'),updated_at=direct.iso(j.get('updateTime')),program=project['title'])
            if row:rows.append(row)
    return rows

def mihoyo():
    endpoint='https://ats.openout.mihoyo.com/ats-portal'
    def page(n):return api(endpoint+'/v1/job/list',f'mihoyo-page-{n}.json',{'channelDetailIds':[1],'hireType':1,'pageNo':n,'pageSize':100})['data']
    first=page(1);jobs=first['list']
    for n in range(2,math.ceil(first['total']/100)+1):jobs+=page(n)['list']
    def detail(j):
        if j.get('jobNatureId')!=1 or '2027' not in j.get('projectName',''):return None
        name=f'mihoyo-detail-{j["id"]}.json';d=api(endpoint+'/v1/job/info',name,{'id':j['id'],'channelDetailIds':[1],'hireType':1})['data']
        if not d or d.get('status')!=1 or d.get('title')!=j['title']:return None
        url='https://jobs.mihoyo.com/#/campus/position/'+str(j['id'])
        return make('米哈游','mihoyo',j['id'],d['title'],[c['addressDetail'] for c in d.get('addressDetailList') or []],url,d.get('description'),d.get('jobRequire'),d['projectName']+'；'+d.get('objectName',''),url,name,industry='游戏与文娱',category_raw=d.get('competencyType'),program=d['projectName'])
    return parallel(detail,jobs)

def xhs():
    origin='https://job.xiaohongshu.com'
    def page(n):return api(origin+'/websiterecruit/position/pageQueryPosition',f'xhs-page-{n}.json',{'pageNum':n,'pageSize':100,'recruitType':'campus','positionName':''})['data']
    first=page(1);jobs=first['list']
    for n in range(2,first['totalPage']+1):jobs+=page(n)['list']
    def detail(j):
        proof=j.get('jobProjectName','')+' '+j.get('qualification','')
        if re.search('实习',j['positionName']) or not re.search('2027|27届',proof):return None
        name=f'xhs-detail-{j["positionId"]}.json';d=api(origin+'/websiterecruit/position/queryPositionDetail?positionId='+str(j['positionId']),name)['data']
        if not d or d.get('recruitType')=='intern_recruit' or d.get('recruitStatus')!='in_recruitment':return None
        url=origin+'/campus/position/'+str(j['positionId']);snippet=re.search(r'.{0,25}(?:2027|27届).{0,85}',proof).group(0)
        return make('小红书','xiaohongshu',j['positionId'],d['positionName'],d.get('workplace') or '',url,d.get('duty'),d.get('qualification'),snippet,url,name,category_raw=d.get('positionType'),published_at=direct.iso(j.get('publishTime')),program=d.get('jobProjectName'))
    return parallel(detail,jobs)

def tencent():
    origin='https://join.qq.com'
    mapping=api(origin+'/api/v1/position/getProjectMapping','tencent-projects.json')['data']
    projects=[p for g in mapping for p in g.get('subProjectList') or [] if p.get('recruitYear')=='2027' and '实习' not in p['projectName']]
    body={'projectIdList':[],'projectMappingIdList':[p['mappingId'] for p in projects],'keyword':'','bgList':[],
        'workCountryType':0,'workCityList':[],'recruitCityList':[],'positionFidList':[],'pageIndex':1,'pageSize':1000}
    data=api(origin+'/api/v1/position/searchPosition','tencent-graduate-list.json',body)['data']
    projectmap={int(p['projectId']):p for p in projects if p['projectId'].isdigit()}
    def detail(j):
        project=projectmap.get(j['projectId'])
        if not project or not j.get('postId'):return None
        name=f'tencent-detail-{j["postId"]}.json'
        d=api(origin+'/api/v1/jobDetails/getJobDetailsByPostId?postId='+str(j['postId']),name)['data']
        if not d or str(d.get('postId'))!=str(j['postId']) or not d.get('title'):return None
        url=origin+'/post_detail.html?postid='+str(j['postId'])
        return make('腾讯','tencent',j['postId'],d['title'],d.get('workCityList') or [],url,d.get('desc'),d.get('request'),
            project['projectName']+'；'+project['recruitRangDesc'],origin+'/post.html?query=p_'+str(project['mappingId']),name,
            category_raw=d.get('tidName'),employer_unit=(j.get('bgs') or '').strip(),program=project['projectName'])
    return parallel(detail,data['positionList'])

def meituan():
    origin='https://zhaopin.meituan.com'
    def page(n):return api(origin+'/api/official/job/getJobList',f'meituan-page-{n}.json',
        {'page':{'pageNo':n,'pageSize':100},'jobType':[{'code':'1','subCode':[]}],'jobShareType':'1','keywords':''})['data']
    first=page(1);jobs=first['list']
    for n in range(2,first['page']['totalPage']+1):jobs+=page(n)['list']
    def detail(j):
        name=f'meituan-detail-{j["jobUnionId"]}.json'
        d=api(origin+'/api/official/job/getJobDetail',name,{'jobUnionId':j['jobUnionId'],'jobShareType':'1'})['data']
        if not d or d.get('jobType')!='1' or '2027' not in (d.get('projectName') or ''):return None
        url=origin+'/web/position/detail?jobUnionId='+str(j['jobUnionId'])+'&highlightType=campus'
        return make('美团','meituan',j['jobUnionId'],d['name'],[c['name'] for c in d.get('cityList') or []],url,d.get('jobDuty'),d.get('jobRequirement'),
            d['projectName']+'；官网类型为应届生。',url,name,program=d['projectName'],category_raw=d.get('jobFamily'),
            employer_unit=' / '.join(x['name'] for x in d.get('department') or []),published_at=direct.iso(d.get('firstPostTime')),updated_at=direct.iso(d.get('refreshTime')))
    return parallel(detail,jobs)

FEISHU=[('字节跳动','bytedance','https://jobs.bytedance.com','campus',2,'互联网与软件'),
        ('得物','dewu','https://poizon.jobs.feishu.cn','578078',6,'互联网与软件'),
        ('影石','insta360','https://arashivision.jobs.feishu.cn','campus',6,'消费电子与硬件'),
        ('小米','xiaomi','https://xiaomi.jobs.f.mioffice.cn','campus',6,'消费电子与硬件'),
        ('小鹏汽车','xiaopeng','https://xiaopeng.jobs.feishu.cn','398875',6,'汽车与新能源'),
        ('莉莉丝游戏','lilithgames','https://lilithgames.jobs.feishu.cn','campus',6,'游戏与文娱'),
        ('微派网络','wepie','https://wepie.jobs.feishu.cn','359597',6,'游戏与文娱'),
        ('MetaApp','metaapp','https://meta.jobs.feishu.cn','140297',6,'游戏与文娱'),
        ('MiniMax','minimax','https://vrfi1sk8a0.jobs.feishu.cn','379481',6,'人工智能与数据')]

def feishu(site):
    company,prefix,origin,path,portal,industry=site
    op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    headers={'Content-Type':'application/json','User-Agent':USER_AGENT,'Referer':origin+'/'+path,
        'website-path':path,'Portal-Channel':'campus' if portal==2 else 'saas-career','Portal-Platform':'pc'}
    req=urllib.request.Request(origin+'/api/v1/csrf/token',data=b'{}',headers=headers)
    token=json.loads(op.open(req,timeout=25).read())['data']['token']
    op.addheaders=list({**headers,'x-csrf-token':token}.items())
    def page(n):return api(origin+'/api/v1/search/job/posts',f'{prefix}-page-{n}.json',{'keyword':'','limit':100,'offset':n*100,
        'portal_type':portal,'portal_entrance':1,'job_category_id_list':[],'location_code_list':[],'subject_id_list':[],
        'recruitment_id_list':['201'] if portal==2 else []},op)['data']
    first=page(0);jobs=first['job_post_list']
    for n in range(1,math.ceil(first['count']/100)):jobs+=page(n)['job_post_list']
    def detail(j):
        subject=((j.get('job_subject') or {}).get('name') or {})
        project=subject.get('zh_cn') or subject.get('i18n') or '' if isinstance(subject,dict) else str(subject)
        proof=project+' '+j['title']+' '+j.get('description','')+' '+j.get('requirement','')
        if (j.get('recruit_type') or {}).get('id')!='201' or not re.search('2027|27届',proof) or re.search('实习|校园大使',j['title']):return None
        name=f'{prefix}-detail-{j["id"]}.json'
        d=api(origin+'/api/v1/job/posts/'+j['id']+'?portal_type='+str(portal),name,opener=op)['data']['job_post_detail']
        if not d or d['title']!=j['title'] or d.get('channel_online_status')==0:return None
        url=origin+'/'+path+'/position/'+str(j['id'])+'/detail'
        locations=[c.get('name') or c.get('i18n_name') for c in d.get('city_list') or j.get('city_list') or []]
        if not locations and d.get('city_info'):locations=[d['city_info']['name']]
        evidence=re.search(r'.{0,20}(?:2027|27届).{0,90}',proof).group(0)
        return make(company,prefix,j['id'],d['title'],locations,url,d.get('description'),d.get('requirement'),evidence,url,name,
            industry=site[5],program=project or '2027届校园招聘',category_raw=(d.get('job_category') or d.get('job_function') or {}).get('name'),published_at=direct.iso(j.get('publish_time')))
    return parallel(detail,jobs)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sources',default='all');args=parser.parse_args()
    functions=[alibaba,kuaishou,vivo,oppo,netease,mihoyo,xhs,tencent,meituan]
    existing=RAW/'accepted.json';rows=json.loads(existing.read_text(encoding='utf-8')) if existing.exists() else []
    for fn in functions:
        if args.sources!='all' and fn.__name__ not in args.sources.split(','):continue
        try:
            current=fn();rows+=current;print(json.dumps({'source':fn.__name__,'accepted':len(current)},ensure_ascii=False),flush=True)
        except Exception as error:FAILURES.append({'source':fn.__name__,'reason':str(error)});print(fn.__name__,str(error),flush=True)
        rows=list({r['id']:r for r in rows}.values())
        (RAW/'accepted.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    for site in FEISHU:
        if args.sources!='all' and site[1] not in args.sources.split(','):continue
        try:
            current=feishu(site);rows+=current;print(json.dumps({'source':site[0],'accepted':len(current)},ensure_ascii=False),flush=True)
        except Exception as error:FAILURES.append({'source':site[0],'reason':str(error)});print(site[0],str(error),flush=True)
        rows=list({r['id']:r for r in rows}.values())
        existing.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (RAW/'manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
    (RAW/'excluded.json').write_text(json.dumps(FAILURES,ensure_ascii=False,indent=2),encoding='utf-8')
