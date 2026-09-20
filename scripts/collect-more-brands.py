"""Read official public graduate positions. Never submit applications."""
import argparse
import http.cookiejar
import importlib.util
import json
import math
import re
import subprocess
import urllib.request
from pathlib import Path
from bs4 import BeautifulSoup

spec=importlib.util.spec_from_file_location('brands',Path(__file__).with_name('collect-famous-jobs.py'))
f=importlib.util.module_from_spec(spec);spec.loader.exec_module(f)

def pinduoduo():
    origin='https://careers.pddglobalhr.com'
    def page(n):return f.api(origin+'/api/careers/api/recruit/position/list',f'pdd-list-{n}.json',{'page':n,'pageSize':100})['result']
    first=page(1);jobs=first['list']
    for n in range(2,math.ceil(int(first['total'])/100)+1):jobs+=page(n)['list']
    def detail(j):
        if str(j.get('graduationYear'))!='2027':return None
        name=f'pdd-detail-{j["id"]}.json'
        d=f.api(origin+'/api/careers/api/recruit/position/detail',name,{'id':j['id']})['result']
        if not d.get('normal') or d.get('voteArrange')!='inTime' or str(d.get('graduationYear'))!='2027':return None
        url=origin+'/campus/grad/detail?positionId='+d['id']
        return f.make('拼多多','pinduoduo',d['id'],d['name'],d.get('workLocationName') or '',url,d.get('jobDuty'),d.get('serveRequirement'),
            '岗位详情 graduationYear=2027；'+d.get('recruitTypeName',''),url,name,category_raw=d.get('jobName'),published_at=f.direct.iso(d.get('releaseTime')))
    return f.parallel(detail,jobs)

def bilibili():
    origin='https://jobs.bilibili.com'
    headers={'User-Agent':f.USER_AGENT,'Content-Type':'application/json','X-AppKey':'ops.ehr-api.auth','X-UserType':'2','X-Channel':'campus','Referer':origin+'/campus/'}
    op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    # Public anonymous bootstrap used by the employer's own frontend.
    token=json.loads(op.open(urllib.request.Request(origin+'/api/auth/v1/csrf/token',headers=headers),timeout=25).read())
    if token.get('code')!=0:raise ValueError('官方匿名会话暂不可用')
    headers['X-CSRF']=token['data']
    def page(n):return f.api(origin+'/api/campus/position/positionList',f'bili-page-{n}.json',
        {'pageSize':100,'pageNum':n,'positionName':'','postCodeList':[],'workLocationList':[],'workTypeList':[],
         'positionTypeList':['3'],'deptCodeList':[],'recruitType':1,'practiceTypes':[],'onlyHotRecruit':0},op,headers)['data']
    first=page(1);jobs=first['list']
    for n in range(2,first['pages']+1):jobs+=page(n)['list']
    def detail(j):
        name=f'bili-detail-{j["id"]}.json'
        d=f.api(origin+'/api/campus/position/detail/'+str(j['id']),name,opener=op,headers=headers)['data']
        if d.get('positionType')!='3' or d.get('positionStatus')!=1 or d.get('recruitType')!=1:return None
        proof=d['positionName']+'；毕业时间：'+(d.get('graduationStartTime') or '')+' 至 '+(d.get('graduationEndTime') or '')
        if '2027' not in proof:return None
        text=f.direct.clean(d.get('positionDescription'))
        parts=re.split(r'工作要求[:：]?|任职要求[:：]?',text,maxsplit=1)
        if len(parts)!=2:return None
        url=origin+'/campus/positions/'+str(d['id'])
        return f.make('B站','bilibili',d['id'],d['positionName'],d.get('workLocation') or '',url,parts[0],parts[1],proof,url,name,
            industry='游戏与文娱',category_raw=d.get('postCodeName'),published_at=f.direct.iso(d.get('pushTime')),deadline=f.direct.iso(d.get('webApplyEndTime')))
    return f.parallel(detail,jobs)

def huawei():
    origin='https://career.huawei.com';apiroot='https://apigw-dgg-b0.huawei.com/api/apig/channelhw/recruitmentPosition/pub/'
    headers={'X-HW-ID':'app_000000035886','x-jalor-tenantAlias':'hcm','x-language':'zh_CN','x-Referer':origin+'/cn','x-alb-gray':'prod','Referer':origin+'/'}
    proof=f.read(origin+'/cn/campus-recruitment','huawei-cohort.html').decode()
    if '2027届应届生招聘对象' not in proof:raise ValueError('官网当前届别未确认')
    def request(method,name,body):return f.api(apiroot+method+'?X-HW-ID=app_000000035886',name,body,headers=headers)['data']
    def page(n):return request('getJobPage',f'huawei-list-{n}.json',{'curPage':n,'pageSize':100,'jobType':'CR','recruitmentType':['FRESH_GRADUATE']})
    first=page(1);jobs=first['result']
    for n in range(2,first['pageVO']['totalPages']+1):jobs+=page(n)['result']
    def detail(j):
        if j.get('scenarioName')!='应届生':return None
        jid=j['advertisementId'];name=f'huawei-detail-{jid}.json'
        d=request('getRecruitmentPositionDetail',name,{'advertisementId':jid})
        if d.get('recruitType')!='CR' or d.get('scenarioName')!='应届生':return None
        intentions=request('getPositionIntentionList',f'huawei-intentions-{jid}.json',{'jobId':d['jobId']}) or []
        description=d.get('mainBusiness') or '';requirements=d.get('jobRequire') or ''
        if '详见岗位意向' in description:
            description='\n\n'.join(x['positionIntention']+'\n'+x.get('jobResponsibilities','') for x in intentions if x.get('jobResponsibilities'))
            requirements='\n\n'.join(x['positionIntention']+'\n'+x.get('jobDemand','') for x in intentions if x.get('jobDemand'))
        url=origin+'/cn/job-details?advertisementId='+str(jid)
        row=f.make('华为','huawei',jid,d['jobname'],d.get('jobCity') or '',url,description,requirements,
            '华为官网2027届应届生招聘；国内本硕毕业时间2027-01-01至2027-12-31，国内博士与海外本硕博2026-01-01至2027-12-31。',origin+'/cn/campus-recruitment',name,
            industry='通信与智能硬件',category_raw=d.get('categoryName'),updated_at=f.direct.iso(d.get('lastUpdateDate')),program='2027届应届生招聘')
        if row:
            row['source_files']=[row['source_file'],str((f.RAW/f'huawei-intentions-{jid}.json').relative_to(f.ROOT)).replace('\\','/')]
            row['notes']+=' 华为同一职位的多个岗位意向合并展示，请在官网选择意向、部门与地点后申请。'
        return row
    return f.parallel(detail,jobs)

def didi():
    origin='https://campus.didiglobal.com';site='/campus_apply/didiglobal/96064'
    op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.addheaders=[('User-Agent',f.USER_AGENT)]
    html=op.open(origin+'/',timeout=25).read()
    state=next(json.loads(x['value']) for x in BeautifulSoup(html,'html.parser').find_all('input') if 'jobsGroupedByProject' in x.get('value',''))
    (f.RAW/'didi-cohort-page.html').write_bytes(html)
    # Decode the public response exactly as Moka's published frontend does.
    decoder="const x=JSON.parse(require('fs').readFileSync(0,'utf8'));const d=require('crypto').createDecipheriv('aes-128-cbc',Buffer.from(x.necromancer),Buffer.from(x.iv));process.stdout.write(Buffer.concat([d.update(x.data,'base64'),d.final()]).toString());"
    def request(endpoint,name,body):
        x=f.api(origin+'/api/outer/ats-apply/website/'+endpoint,name,body,op,{'Referer':origin+site})
        if x.get('necromancer'):
            x['iv']=state['aesIv']
            result=subprocess.run(['node','-e',decoder],input=json.dumps(x),capture_output=True,text=True,encoding='utf-8',check=True)
            x=json.loads(result.stdout)
            (f.RAW/name.replace('.json','-decoded.json')).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8')
        if x.get('code')!=0:raise ValueError('官网公开接口返回错误：'+str(x.get('msg')))
        return x['data']
    def page(n):return request('jobs/v2',f'didi-page-{n}.json',{'orgId':'didiglobal','siteId':96064,'limit':15,'offset':n*15,'needStat':True,'site':'campus','locale':'zh-CN'})
    first=page(0);jobs=first['jobs']
    for n in range(1,math.ceil(first['jobStats']['total']/15)):jobs+=page(n)['jobs']
    def detail(j):
        if j.get('commitment')!='全职' or j.get('status')!='open':return None
        name=f'didi-detail-{j["id"]}.json'
        d=request('job',name,{'orgId':'didiglobal','siteId':96064,'jobId':j['id'],'locale':'zh-CN'})
        project=(d.get('projectFolder') or {}).get('name','')
        if '2027' not in project or d.get('commitment')!='全职' or d.get('status')!='open':return None
        body=f.direct.clean(d.get('jobDescription'))
        parts=re.split(r'任职要求[:：]?|岗位要求[:：]?|Qualifications\s*[:：]?',body,maxsplit=1,flags=re.I)
        if len(parts)!=2:return None
        url=origin+site+'#/job/'+d['id']
        return f.make('滴滴','didi',d['id'],d['title'],[x.get('cityName') or x.get('address') for x in d.get('locations') or []],url,
            parts[0],parts[1],project+'；官网项目面向2026年9月至2027年8月毕业生。',url,name.replace('.json','-decoded.json'),
            category_raw=(d.get('zhineng') or {}).get('name'),program=project,employer_unit=(d.get('department') or {}).get('name'),
            education=d.get('education'),published_at=f.direct.iso(d.get('publishedAt')),updated_at=f.direct.iso(d.get('updatedAt')))
    return f.parallel(detail,jobs)

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sources',default='all');args=parser.parse_args()
    path=f.RAW/'accepted.json';rows=json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    for fn in [pinduoduo,bilibili,huawei,didi]:
        if args.sources!='all' and fn.__name__ not in args.sources.split(','):continue
        try:
            result=fn();rows+=result;print(json.dumps({'source':fn.__name__,'accepted':len(result)},ensure_ascii=False),flush=True)
        except Exception as error:f.FAILURES.append({'source':fn.__name__,'reason':str(error)});print(fn.__name__,str(error),flush=True)
        rows=list({r['id']:r for r in rows}.values());path.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (f.RAW/'manifest-more.json').write_text(json.dumps(f.MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
    (f.RAW/'excluded-more.json').write_text(json.dumps(f.FAILURES,ensure_ascii=False,indent=2),encoding='utf-8')
