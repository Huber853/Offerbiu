"""Read official public graduate positions. Never submit applications."""
import argparse
import hashlib
import http.cookiejar
import importlib.util
import json
import math
import re
import subprocess
import urllib.parse
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

# Moka and Beisen host many independent employer graduate portals behind a single
# domain, so every additional reviewed employer is a configuration row here rather
# than a new function. Only each employer's own public site is read.
MOKA=[('炎魂网络','yanhun','yanhun',24017,'游戏与文娱','/campus_apply/yanhun/24017'),
      ('途游游戏','tuyoogame','tuyoogame',146219,'游戏与文娱','/campus-recruitment/tuyoogame/146219'),
      ('掌趣科技','ourpalm','ourpalm',43628,'游戏与文娱','/campus-recruitment/ourpalm/43628'),
      ('鹰角网络','hypergryph','hypergryph',26326,'游戏与文娱','/campus-recruitment/hypergryph/26326'),
      ('Garena','garena','garena',148076,'游戏与文娱','/campus-recruitment/garena/148076'),
      ('完美世界','pwrd','pwrd',172467,'游戏与文娱','/campus-recruitment/pwrd/172467'),
      ('三七互娱','37','37',58016,'游戏与文娱','/campus-recruitment/37/58016'),
      ('游卡','yokagames','yokagames',41940,'游戏与文娱','/campus-recruitment/yokagames/41940'),
      ('富特科技','evtech','evtech',47503,'电子与智能制造','/campus_apply/evtech/47503'),
      ('猛士汽车','dfmc','dfmc',168535,'汽车与新能源','/campus-recruitment/dfmc/168535'),
      ('神龙汽车','dfmc','dfmc',170464,'汽车与新能源','/campus-recruitment/dfmc/170464'),
      ('徐工集团','xcmg','xcmg',None,'机械与制造','/campus-recruitment/xcmg'),
      ('未岚大陆','weilandalu','weilandalu',None,'机器人与智能硬件','/campus-recruitment/weilandalu'),
      ('华虹半导体','huahong','huahong',70000,'半导体与芯片','/campus-recruitment/huahong/70000'),
      ('作业帮','zuoyebang','zuoyebang',144908,'互联网与软件','/campus-recruitment/zuoyebang/144908'),
      ('FMG时尚动势集团','fmg','ur',45210,'消费与零售','/campus-recruitment/ur/45210'),
      ('珠海万达商管','wandacm','wandacm',164049,'商业服务','/campus-recruitment/wandacm/164049'),
      ('华润置地','crland','crland',168540,'建筑与房地产','/campus-recruitment/crland/168540'),
      ('阶跃星辰','step','step',94905,'人工智能与数据','/campus-recruitment/step/94905'),
      ('海光信息','hygon','hygon',169939,'半导体与芯片','/campus-recruitment/hygon/169939'),
      ('宁德时代','catl','catlhr',148948,'汽车与新能源','/campus-recruitment/catlhr/148948'),
      ('宁德时代','catlphd','catlhr',142992,'汽车与新能源','/campus-recruitment/catlhr/142992'),
      ('宁德时代','catlctp','catlhr',143035,'汽车与新能源','/campus-recruitment/catlhr/143035'),
      ('百草味','vipbcw','vipbcw',4343,'消费与零售','/campus-recruitment/vipbcw/4343'),
      ('满帮集团','manbang','manbang',94191,'物流与交通','/campus_apply/manbang/94191'),
      ('苏商银行','snb','snb',45592,'银行与金融','/campus-recruitment/snb/45592'),
      ('骑士集团','blackunique','black-unique',29232,'消费与零售','/campus_apply/black-unique/29232'),
      ('增芯科技','zensemi','zensemi',142586,'半导体与芯片','/campus-recruitment/zensemi/142586'),
      ('金蝶','kingdeehr','kingdeehr',166565,'互联网与软件','/campus-recruitment/kingdeehr/166565'),
      ('星钥半导体','starksemi','starksemi',142996,'半导体与芯片','/campus-recruitment/starksemi/142996'),
      ('佑驾创新','minieye','minieye',118571,'汽车与新能源','/campus-recruitment/minieye/118571'),
      ('大众汽车集团（中国）','vwa','vwa',168597,'汽车与新能源','/campus-recruitment/vwa/168597'),
      ('延锋','yanfeng','yanfeng',45086,'汽车与新能源','/campus-recruitment/yanfeng/45086'),
      ('吉利控股','geely','geely',78436,'汽车与新能源','/campus_apply/geely/78436'),
      ('中信出版集团','zxcb','zxcb',100004552,'出版与传媒','https://app135149.dingtalkoxm.com/campus-recruitment/zxcb/100004552'),
      ('好未来','tal','tal',95443,'教育','/campus-recruitment/tal/95443'),
      ('中兴通讯','zte','zte',46903,'通信与智能硬件','/campus-recruitment/zte/46903'),
      ('药明生物','wuxibiologics','wuxibiologics',99961,'医疗健康','https://job.wuxibiologics.com.cn/campus-recruitment/wuxibiologics/99961')]

MOKA_ORIGIN='https://app.mokahr.com'
# Moka returns AES-128-CBC payloads; decode them the way its published frontend does.
MOKA_DECODER=("const x=JSON.parse(require('fs').readFileSync(0,'utf8'));"
    "const d=require('crypto').createDecipheriv('aes-128-cbc',Buffer.from(x.necromancer),Buffer.from(x.iv));"
    "process.stdout.write(Buffer.concat([d.update(x.data,'base64'),d.final()]).toString());")

def moka_site(site,state):
    company,prefix,org,site_id,industry,url_path=site
    # Most tenants live on app.mokahr.com, but DingTalk's OEM deployment serves the
    # same API from its own host, so an absolute url_path overrides the origin.
    if url_path.startswith('http'):
        parsed=urllib.parse.urlsplit(url_path)
        origin=parsed.scheme+'://'+parsed.netloc;path=parsed.path
    else:
        origin=MOKA_ORIGIN;path=url_path
    op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
    op.addheaders=[('User-Agent',f.USER_AGENT)]
    # The employer's own page embeds the anonymous session state (aesIv) and, for
    # portals without an explicit number in the URL, the campus site id.
    html=op.open(origin+path,timeout=25).read()
    (f.RAW/f'{prefix}-site.html').write_bytes(html)
    for tag in BeautifulSoup(html,'html.parser').find_all('input'):
        value=tag.get('value') or ''
        if 'aesIv' not in value:continue
        try:config=json.loads(value)
        except ValueError:continue
        if config.get('aesIv'):state['aesIv']=config['aesIv']
        if not site_id and config.get('siteId'):site_id=int(config['siteId'])
        break
    if not state.get('aesIv'):raise ValueError('未取得官网匿名会话参数')
    if not site_id:raise ValueError('未识别站点编号')
    iv=state['aesIv']
    def request(endpoint,name,body):
        x=f.api(origin+'/api/outer/ats-apply/website/'+endpoint,name,body,op,{'Referer':origin+path})
        if x.get('necromancer'):
            x['iv']=iv
            result=subprocess.run(['node','-e',MOKA_DECODER],input=json.dumps(x),capture_output=True,text=True,encoding='utf-8',check=True)
            x=json.loads(result.stdout)
            (f.RAW/name.replace('.json','-decoded.json')).write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf-8')
        if x.get('code')!=0:raise ValueError('官网公开接口返回错误：'+str(x.get('msg')))
        return x['data']
    def page(n):return request('jobs/v2',f'{prefix}-page-{n}.json',{'orgId':org,'siteId':site_id,'limit':15,'offset':n*15,'needStat':True,'site':'campus','locale':'zh-CN'})
    first=page(0);jobs=first['jobs']
    for n in range(1,math.ceil(first['jobStats']['total']/15)):jobs+=page(n)['jobs']
    def detail(j):
        if j.get('status')!='open':return None
        name=f'{prefix}-detail-{j["id"]}.json'
        d=request('job',name,{'orgId':org,'siteId':site_id,'jobId':j['id'],'locale':'zh-CN'})
        if d.get('status')!='open':return None
        title=d.get('title') or ''
        # Tenants do not all fill commitment: several large employers leave it null
        # while still publishing full time campus posts, so only an explicit other
        # commitment or an internship title is treated as out of scope.
        commitment=d.get('commitment') or j.get('commitment') or ''
        if commitment and commitment!='全职':return None
        if re.search(r'实习|校园大使|兼职',title):return None
        project=(d.get('projectFolder') or {}).get('name','')
        body=f.direct.clean(d.get('jobDescription'))
        parts=re.split(r'任职要求[:：]?|岗位要求[:：]?|职位要求[:：]?|任职资格[:：]?|Qualifications\s*[:：]?',body,maxsplit=1,flags=re.I)
        if len(parts)!=2:return None
        # Some tenants name their campaign without a year, so the per-job cohort
        # evidence is taken from the posting body as the other collectors do.
        evidence=re.search(r'.{0,30}(?:2027|27届).{0,70}',project+' '+title+' '+parts[0]+' '+parts[1])
        if not evidence:return None
        url=origin+path+'#/job/'+str(d['id'])
        return f.make(company,prefix,d['id'],d['title'],[x.get('cityName') or x.get('address') for x in d.get('locations') or []],url,
            parts[0],parts[1],evidence.group(0),url,name.replace('.json','-decoded.json'),industry=industry,
            category_raw=(d.get('zhineng') or {}).get('name'),program=project or '2027届校园招聘',education=d.get('education'),
            published_at=f.direct.iso(d.get('publishedAt')),updated_at=f.direct.iso(d.get('updatedAt')))
    return f.parallel(detail,jobs)

def moka():
    rows=[];state={}
    for site in MOKA:
        try:
            current=moka_site(site,state);rows+=current
            print(json.dumps({'source':site[0],'accepted':len(current)},ensure_ascii=False),flush=True)
        except Exception as error:
            f.FAILURES.append({'source':site[0],'reason':str(error)});print(site[0],str(error),flush=True)
    return rows

BEISEN=[('光宝科技','liteon','liteon.zhiye.com','电子与智能制造','/campus/jobs'),
        ('树根互联','irootech','irootech.zhiye.com','工业互联网与制造','/campus/jobs'),
        ('合合信息','intsig','intsig.zhiye.com','人工智能与数据','/campus/jobs'),
        ('泡泡玛特','popmart','popmart.zhiye.com','消费与零售','/campus/jobs'),
        ('泰康资产','jobtaikang','jobtaikang.zhiye.com','银行与金融','/campus/jobs'),
        ('上海农商银行','shrcb','shrcb.zhiye.com','银行与金融','/campus/jobs'),
        ('智元研究院','noricogroup','norincogroupzhaopin.zhiye.com','国防与科研','/campus/jobs'),
        ('慧策','huicecom','huicecom.zhiye.com','互联网与软件','/Campus'),
        ('康比特','chinacpt','chinacpt.zhiye.com','消费与零售','/campus/jobs'),
        ('加多宝','jdbchina','jdbchina.zhiye.com','消费与零售','/campus/jobs'),
        ('巨鲨显示','jusha','jusha.zhiye.com','电子与智能制造','/campus/jobs'),
        ('诺瓦星云','novastar','novastar.zhiye.com','电子与智能制造','/campus/jobs'),
        ('高松技术','degson','degson.zhiye.com','电子与智能制造','/campus/jobs'),
        ('普渡科技','pudutech','pudutech.zhiye.com','机器人与智能硬件','/campus/jobs'),
        ('中金公司','cicc','cicc.zhiye.com','证券与投资','/campus/jobs'),
        ('联影集团','unitedimaging','united-imaging.zhiye.com','医疗健康','/campus/jobs'),
        ('麦科田医疗','medcaptain','medcaptain.zhiye.com','医疗健康','/campus/jobs'),
        ('瑞迈特','bmcmedical','bmc-medical.zhiye.com','医疗健康','/campus/jobs'),
        ('圣湘生物','sansure','sansurehr.zhiye.com','医疗健康','/campus/jobs'),
        ('中车时代新材','zztrp1','zztrp1.zhiye.com','化工与材料','/campus/jobs'),
        ('国轩高科','gotion','gotion.zhiye.com','汽车与新能源','/campus/jobs'),
        ('赛力斯汽车','sokon','sokon.zhiye.com','汽车与新能源','/campus/jobs'),
        ('凯金新能源','kaijin2','kaijin2.zhiye.com','汽车与新能源','/campus/jobs'),
        ('友山科技','youshan','youshan.zhiye.com','化工与材料','/campus/jobs'),
        ('赛豆科技','aiva','aiva.zhiye.com','汽车与新能源','/campus/jobs'),
        ('鼎匠创新','topdon','topdon.zhiye.com','汽车与新能源','/campus/jobs'),
        ('KK集团','kkguan','kkguan.zhiye.com','消费与零售','/campus/jobs'),
        ('洽洽食品','qiaqiafood','qiaqiafood.zhiye.com','消费与零售','/campus/jobs'),
        ('CHARLES & KEITH','charleskeith','charleskeith.zhiye.com','消费与零售','/campus/jobs'),
        ('劲牌','jingpai','jingpai.zhiye.com','消费与零售','/campus/jobs'),
        ('中国电建地产','djdc','djdc.zhiye.com','建筑与房地产','/campus/jobs'),
        ('藏格矿业','zgky','zgky.zhiye.com','能源与电力','/campus/jobs'),
        ('中建西南院','xnjz','xnjz.zhiye.com','建筑与房地产','/campus/jobs'),
        ('申能集团','shenergy','shenergy.zhiye.com','能源与电力','/custom/campus'),
        ('鼎捷数智','digiwin','digiwin.zhiye.com','互联网与软件','/campus/jobs'),
        ('神州信息','dcits','dcits.zhiye.com','银行与金融','/campus/jobs'),
        ('宇信科技','yusys','yusys.zhiye.com','银行与金融','/campus/jobs'),
        ('长亮科技','csii','csii.zhiye.com','银行与金融','/campus/jobs'),
        ('科大讯飞','iflytek','iflytek.zhiye.com','人工智能与数据','/campus/jobs'),
        ('新点软件','epoint','epoint.zhiye.com','互联网与软件','/campus/jobs'),
        ('新大陆','newland','newland.zhiye.com','电子与智能制造','/campus/jobs'),
        ('数字政通','egova','egova.zhiye.com','互联网与软件','/campus/jobs'),
        ('奇瑞汽车','chery','chery.zhiye.com','汽车与新能源','/campus/jobs'),
        ('长安汽车','changan','changan.zhiye.com','汽车与新能源','/campus/jobs'),
        ('零跑汽车','leapmotor','leapmotor.zhiye.com','汽车与新能源','/campus/jobs'),
        ('三一集团','sany','sany.zhiye.com','机械与制造','/campus/jobs'),
        ('潍柴集团','weichai','weichai.zhiye.com','机械与制造','/campus/jobs'),
        ('传音控股','transsion','transsion.zhiye.com','消费电子与硬件','/campus/jobs'),
        ('京东方','boe','boe.zhiye.com','半导体与芯片','/campus/jobs'),
        ('药明康德','wuxiapptec','wuxiapptec.zhiye.com','医疗健康','/campus/jobs'),
        ('迈瑞医疗','mindray','mindray.zhiye.com','医疗健康','/campus/jobs'),
        ('新产业生物','snibe','snibe.zhiye.com','医疗健康','/campus/jobs'),
        ('中茵微电子','joinsilicon','joinsilicon.zhiye.com','半导体与芯片','/campus/jobs'),
        ('鹏新旭','pensun','pensun.zhiye.com','半导体与芯片','/campus/jobs'),
        ('蒙牛','mengniu','mengniu.zhiye.com','消费与零售','/campus/jobs'),
        ('海天集团','haitian','haitian.zhiye.com','消费与零售','/campus/jobs'),
        ('美克家居','markor','markor.zhiye.com','消费与零售','/campus/jobs'),
        ('欣旺达','sunwoda','sunwoda.zhiye.com','汽车与新能源','/campus/jobs'),
        ('九牧王','joeone','joeone.zhiye.com','消费与零售','/campus/jobs'),
        ('歌力思','ellassay','ellassay.zhiye.com','消费与零售','/campus/jobs'),
        ('百联集团','bailian','bailian.zhiye.com','消费与零售','/campus/jobs'),
        ('华新建材','huaxin','huaxin.zhiye.com','化工与材料','/campus/jobs'),
        ('德邦快递','deppon','deppon.zhiye.com','物流与交通','/campus/jobs'),
        ('中国外运','sinotrans','sinotrans.zhiye.com','物流与交通','/campus/jobs'),
        ('青岛啤酒','tsingtao','tsingtao.zhiye.com','消费与零售','/campus/jobs'),
        ('奥克斯','auxgroup','auxgroup.zhiye.com','电子与智能制造','/campus/jobs'),
        ('德力西','delixi','delixi.zhiye.com','电子与智能制造','/campus/jobs'),
        ('通威股份','tongwei','tongwei.zhiye.com','能源与电力','/campus/jobs'),
        ('中国能建','ceec','ceec.zhiye.com','建筑与地产','/campus/jobs'),
        ('埃夫特','efort','efort.zhiye.com','机器人与智能硬件','/campus/jobs'),
        ('汇川技术','inovance','inovance.zhiye.com','机器人与智能硬件','/campus/jobs'),
        ('新松机器人','siasun','siasun.zhiye.com','机器人与智能硬件','/campus/jobs'),
        ('国信证券','guosen','guosen.zhiye.com','证券与投资','/campus/jobs'),
        ('中信建投证券','csc108','csc108.zhiye.com','证券与投资','/campus/jobs'),
        ('中国银河证券','chinastock','chinastock.zhiye.com','证券与投资','/campus/jobs'),
        ('光大证券','ebscn','ebscn.zhiye.com','证券与投资','/campus/jobs'),
        ('东吴证券','dwzq','dwzq.zhiye.com','证券与投资','/campus/jobs'),
        ('海通证券','htsec','htsec.zhiye.com','证券与投资','/campus/jobs'),
        ('中国人寿','chinalife','chinalife.zhiye.com','银行与金融','/campus/jobs'),
        ('中国人保','picc','picc.zhiye.com','银行与金融','/campus/jobs'),
        ('国泰基金','gtfund','gtfund.zhiye.com','证券与投资','/campus/jobs'),
        ('华富基金','hffund','hffund.zhiye.com','证券与投资','/campus/jobs'),
        ('齐鲁制药','qilu-pharma','qilu-pharma.zhiye.com','医疗健康','/campus'),
        ('新和成','xinhecheng1','xinhecheng1.zhiye.com','化工与材料','/campus/jobs'),
        ('哈药集团','hayao','hayao.zhiye.com','医疗健康','/campus/jobs'),
        ('维亚生物','viva','viva.zhiye.com','医疗健康','/campus/jobs'),
        ('高博医疗集团','gobroadhealthcare','gobroadhealthcare.zhiye.com','医疗健康','/campus'),
        ('上海医药','sph','sph.zhiye.com','医疗健康','/campus/jobs'),
        ('京新药业','jingxinpharm','jingxinpharm.zhiye.com','医疗健康','/campus'),
        ('碧橙数字','bicheng','bicheng.zhiye.com','商业服务','/campus'),
        ('海正药业','hisun','hisun.zhiye.com','医疗健康','/campus/jobs'),
        ('复星医药','fosunpharma','fosunpharma.zhiye.com','医疗健康','/campus/jobs'),
        ('三生制药','3sbio','3sbio.zhiye.com','医疗健康','/campus/jobs'),
        ('华大基因','genomics','genomics.zhiye.com','医疗健康','/campus/jobs'),
        ('复宏汉霖','henlius','henlius.zhiye.com','医疗健康','/campus/jobs'),
        ('双汇','shuanghui','shuanghui.zhiye.com','消费与零售','/campus/jobs'),
        ('旺旺','wantwant','wantwant.zhiye.com','消费与零售','/campus/jobs'),
        ('统一企业','uni-president','uni-president.zhiye.com','消费与零售','/campus/jobs'),
        ('大华股份','dahua','dahua.zhiye.com','电子与智能制造','/campus/jobs'),
        ('金风科技','goldwind','goldwind.zhiye.com','能源与电力','/campus/jobs'),
        ('国金证券','gjzq','gjzq.zhiye.com','证券与投资','/campus/jobs'),
        ('华峰集团','huafeng','huafeng.zhiye.com','化工与材料','/campus/jobs'),
        ('思念食品','synear','synear.zhiye.com','消费与零售','/campus/jobs'),
        ('康弘药业','kanghong','kanghong.zhiye.com','医疗健康','/campus/jobs'),
        ('中核集团','cnnc','cnnc.zhiye.com','国防与科研','/campus/jobs'),
        ('闻泰科技','wingtech','wingtech.zhiye.com','电子与智能制造','/campus/jobs'),
        ('新东方','xdf','xdf.zhiye.com','教育','/campus/jobs'),
        ('合盛硅业','hoshine','hoshine.zhiye.com','化工与材料','/campus/jobs'),
        ('石头科技','roborock','roborock.zhiye.com','消费电子与硬件','/campus/jobs'),
        ('晶合集成','nexchip','nexchip.zhiye.com','半导体与芯片','/campus/jobs'),
        ('阅文集团','yuewen','yuewen.zhiye.com','出版与传媒','/campus/jobs'),
        ('广州联通','chinaunicom','chinaunicom.zhiye.com','通信与智能硬件','/campus/jobs'),
        ('华海清科','hwatsing','hwatsing.zhiye.com','半导体与芯片','/campus/jobs'),
        ('格兰仕','galanz','galanz.zhiye.com','消费电子与硬件','/campus/jobs'),
        ('理奇智能装备','richsys1','richsys1.zhiye.com','机械与制造','/campus/jobs'),
        ('赛轮集团','sailuntire','sailuntire.zhiye.com','汽车与新能源','/campus/jobs'),
        ('威卡中国','wika','wika.zhiye.com','机械与制造','/campus/jobs'),
        ('天加环境','tica','tica.zhiye.com','机械与制造','/campus/jobs'),
        ('若态集团','robotime','robotime.zhiye.com','消费与零售','/campus/jobs'),
        ('锦浪科技','ginlong','ginlong.zhiye.com','能源与电力','/campus/jobs'),
        ('四方继保','sf-auto','sf-auto.zhiye.com','能源与电力','/campus/jobs'),
        ('伊之密','yizumi','yizumi.zhiye.com','机械与制造','/campus/jobs'),
        ('中建西南院','xnjz','xnjz.zhiye.com','建筑与房地产','/campus/jobs'),
        ('博力威','greenway-battery','greenway-battery.zhiye.com','汽车与新能源','/campus/jobs'),
        ('欣旺达','sunwodacampus','sunwodacampus.zhiye.com','汽车与新能源','/campus/jobs'),
        ('帝迈生物','dymind','dymind.zhiye.com','医疗健康','/campus/jobs'),
        ('北芯生命','insight-med','insight-med.zhiye.com','医疗健康','/campus'),
        ('中信科移动','cictmobile','cictmobile.zhiye.com','通信与智能硬件','/custom/campus'),
        ('中国星网','cscnrczp','cscnrczp.zhiye.com','通信与智能硬件','/campus/jobs')]

def bs_global(html):
    """Read the BSGlobal config object out of a Beisen portal page.

    A non greedy regex stops at the first closing brace, which truncates tenants
    whose config carries nested objects (Navigations/Pages), so walk the braces
    with string awareness instead.
    """
    marker='var BSGlobal = '
    start=html.index(marker)+len(marker)
    depth=0;in_string=False;escaped=False
    for index in range(start,len(html)):
        char=html[index]
        if in_string:
            if escaped:escaped=False
            elif char=='\\':escaped=True
            elif char=='"':in_string=False
            continue
        if char=='"':in_string=True
        elif char=='{':depth+=1
        elif char=='}':
            depth-=1
            if depth==0:return json.loads(html[start:index+1])
    raise ValueError('未识别官网配置')

def beisen_site(site):
    company,prefix,host,industry,listing_path=site
    origin='https://'+host
    html=None;listing=None
    # Beisen portals differ per tenant: the campus column is usually /campus/jobs
    # but some publish it at /campus or /Campus, so try the configured path first.
    for candidate in dict.fromkeys([listing_path,'/campus/jobs','/campus','/Campus']):
        try:
            text=f.read(origin+candidate,f'{prefix}-campus{candidate.replace("/","-")}.html').decode('utf-8-sig','replace')
        except Exception:continue
        if 'var BSGlobal' in text:
            html=text;listing=origin+candidate;break
    if html is None:raise ValueError('未识别官网配置')
    config=bs_global(html)
    # A tenant that closed its portal answers with BSGlobal.Message and no PortalId.
    if config.get('Message'):raise ValueError('门户状态：'+str(config['Message']))
    # Most tenants inline PortalId at the top level, but a few only expose it inside
    # the portal list, so read every location before giving up on the tenant.
    portal_id=config.get('PortalId')
    if not portal_id:
        for candidate in config.get('PortalList') or config.get('Portals') or []:
            if isinstance(candidate,dict) and candidate.get('PortalId'):
                portal_id=candidate['PortalId'];break
    if not portal_id:raise ValueError('官网配置缺少 PortalId')
    payload={'PageIndex':0,'PageSize':50,'Category':[2],'PortalId':portal_id,
             'DisplayFields':['JobAdName','Category','Kind','LocId','PostDate','Degree'],'SpecialType':0,'KeyWords':''}
    headers={'Content-Type':'application/json','Referer':listing}
    first=f.api(origin+'/api/Jobad/GetJobAdPageList',f'{prefix}-list-0.json',payload,headers=headers)
    listed=list(first.get('Data') or [])
    for n in range(1,(int(first.get('Count') or 0)+49)//50):
        payload['PageIndex']=n
        listed+=f.api(origin+'/api/Jobad/GetJobAdPageList',f'{prefix}-list-{n}.json',payload,headers=headers)['Data']
    def detail(item):
        jid=item['Id'];name=f'{prefix}-detail-{jid}.json'
        try:
            if item.get('Kind')!='全职' or re.search(r'实习|招聘公告|招募计划|校园大使',item.get('JobAdName','')):return None
            query=urllib.parse.urlencode({'jobAdId':jid,'category':2,'displayFields':json.dumps(['JobAdName','LocId','Degree','Duty','Require'])})
            result=f.api(origin+'/api/JobAd/GetJobAdInfo?'+query,name,headers=headers)
            d=result.get('Data') or {}
            if result.get('Code')!=200 or d.get('Status')==2 or d.get('JobAdName')!=item['JobAdName']:return None
            evidence=re.search(r'.{0,35}(?:2027|27届).{0,60}',item['JobAdName']+' '+f.direct.clean(d.get('Require')))
            if not evidence:return None
            url=origin+'/campus/detail?jobAdId='+jid
            return f.make(company,prefix,jid,d['JobAdName'],f.loc(d.get('LocNames') or item.get('LocNames') or []),url,
                f.direct.clean(d.get('Duty') or item.get('Duty')),f.direct.clean(d.get('Require') or item.get('Require')),evidence.group(0),url,name,
                industry=industry,education=d.get('Degree') or item.get('Degree'),category_raw=str(item.get('Category') or ''),
                published_at=f.direct.iso(item.get('PostDate')),updated_at=f.direct.iso(item.get('ChangeDate')),program='2027届校园招聘')
        except Exception as error:
            f.FAILURES.append({'source':company,'id':jid,'reason':str(error)});return None
    rows=f.parallel(detail,listed)
    print(json.dumps({'source':company,'listed':len(listed),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

def beisen():
    rows=[]
    for site in BEISEN:
        try:rows+=beisen_site(site)
        except Exception as error:
            f.FAILURES.append({'source':site[0],'reason':str(error)});print(site[0],str(error),flush=True)
    return rows

# Wecruit (北森's hotjob.cn product line) is the third multi tenant platform: one
# host serves many employers, each addressed by a suite key. Its list endpoint is
# form encoded and only answers when recruitType is present, so requests here are
# built directly instead of going through the JSON helper.
WECRUIT=[('康师傅','masterkong','wecruit.hotjob.cn','691abf70e3842960d1989b29','消费与零售'),
         ('用友','yonyou','career.yonyou.com','67ac41886202cc7916ae3029','互联网与软件'),
         ('中国一汽','faw','faw-zhaopin.hotjob.cn','603374380dcad4635b836531','汽车与新能源'),
         ('安永','ey','ey.hotjob.cn','6710d7c21c240e54e1f82a1b','商业服务'),
         ('先声药业','simcere','wecruit.hotjob.cn','61458d83bef57c54dcb4e43f','医疗健康'),
         ('新风天域集团','newfrontier','wecruit.hotjob.cn','66bf08ab1eb8054b1a642288','医疗健康')]

def wecruit_request(site,endpoint,prefix,name,form):
    company,prefix_key,host,key,industry=site
    origin='https://'+host;suite='SU'+key
    url=origin+'/wecruit/positionInfo/'+endpoint+'/'+suite
    path=f.RAW/name
    if path.exists():raw=path.read_bytes()
    else:
        request=urllib.request.Request(url,data=urllib.parse.urlencode(form).encode(),
            headers={'User-Agent':f.USER_AGENT,'Content-Type':'application/x-www-form-urlencoded',
                     'Referer':origin+'/'+suite+'/pb/school.html'})
        with urllib.request.urlopen(request,timeout=25) as response:raw=response.read()
        path.write_bytes(raw)
    observed=__import__('datetime').datetime.fromtimestamp(path.stat().st_mtime,__import__('datetime').timezone(__import__('datetime').timedelta(hours=8))).isoformat(timespec='seconds')
    f.MANIFEST.append({'url':url,'file':str(path.relative_to(f.ROOT)).replace('\\','/'),
                       'sha256':hashlib.sha256(raw).hexdigest(),'collected_at':observed})
    return json.loads(raw)

def wecruit_site(site):
    company,prefix,host,key,industry=site
    origin='https://'+host;suite='SU'+key
    # The service caps a page at 12 records but derives totalPage from the pageSize
    # it is given, so asking for more silently truncates the walk.
    page_size=12
    first=wecruit_request(site,'listPosition',prefix,f'{prefix}-page-1.json',{'recruitType':1,'pageSize':page_size,'currentPage':1})
    page=((first.get('data') or {}).get('pageForm') or {})
    listed=list(page.get('pageData') or [])
    total=int(page.get('totalPage') or 1)
    for n in range(2,total+1):
        listed+=list((wecruit_request(site,'listPosition',prefix,f'{prefix}-page-{n}.json',
                                      {'recruitType':1,'pageSize':page_size,'currentPage':n}).get('data') or {}).get('pageForm',{}).get('pageData') or [])
    def detail(item):
        jid=item.get('postId')
        if not jid:return None
        name=f'{prefix}-detail-{jid}.json'
        try:
            payload=wecruit_request(site,'listPositionDetail',prefix,name,{'postId':jid,'recruitType':1}).get('data') or {}
            merged={**item,**payload}
            title=str(merged.get('postName') or '')
            if re.search(r'实习|校园大使|兼职',title):return None
            body=None
            for field in ('positionDetail','workContent','jobDescription','jobDetail','duty','postDetail'):
                if merged.get(field):body=f.direct.clean(merged[field]);break
            requirements=None
            for field in ('serviceCondition','requirement','jobRequirement','qualification','postRequire'):
                if merged.get(field):requirements=f.direct.clean(merged[field]);break
            if not body or not requirements:return None
            places=[p for p in re.split(r'[、,，;；/]',str(merged.get('workPlaceStr') or '')) if p.strip()]
            url=origin+'/'+suite+'/mc/detail?postId='+str(jid)+'&recruitType=1'
            proof=title+' '+body+' '+requirements
            evidence=re.search(r'.{0,30}(?:2027|27届).{0,70}',proof) or re.search(r'.{0,30}(?:2027|27届).{0,70}',str(merged.get('projectName') or ''))
            if not evidence:return None
            return f.make(company,prefix,jid,title,places,url,body,requirements,evidence.group(0),url,name,
                industry=industry,education=merged.get('educationStr') or merged.get('education'),
                headcount=merged.get('recruitNumStr'),category_raw=merged.get('postTypeName'),
                employer_unit=merged.get('company'),published_at=f.direct.iso(merged.get('publishDate')),
                program=merged.get('projectName') or '2027届校园招聘',deadline=f.direct.iso(merged.get('endDate')))
        except Exception as error:
            f.FAILURES.append({'source':company,'id':jid,'reason':str(error)});return None
    rows=f.parallel(detail,listed)
    print(json.dumps({'source':company,'listed':len(listed),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

def wecruit():
    rows=[]
    for site in WECRUIT:
        try:rows+=wecruit_site(site)
        except Exception as error:
            f.FAILURES.append({'source':site[0],'reason':str(error)});print(site[0],str(error),flush=True)
    return rows

# 国家能源集团 runs its own campus system: the board is server rendered (one HTML
# page per page number, paging posts the same filters back) and every posting has
# a detail route. The site never states a graduation year, so postings are admitted
# only when the job-level text itself carries the 2027 cohort evidence.
CHNENERGY_ORIGIN='https://zhaopin.chnenergy.com.cn'

def chnenergy_request(pagenum,name):
    form={'pagenum':pagenum,'kinds':1,'schType':'','unitCode':'','ebDownAll':'','transAreaCode':'',
          'workPlaceCode':'','searchtype':'job','workUnit':'','station':''}
    path=f.RAW/name
    if path.exists():raw=path.read_bytes()
    else:
        request=urllib.request.Request(CHNENERGY_ORIGIN+'/recTypeSerch',
            data=urllib.parse.urlencode(form).encode(),
            headers={'User-Agent':f.USER_AGENT,'Content-Type':'application/x-www-form-urlencoded',
                     'Referer':CHNENERGY_ORIGIN+'/recTypeSerch?kinds=1'})
        with urllib.request.urlopen(request,timeout=30) as response:raw=response.read()
        path.write_bytes(raw)
        f.MANIFEST.append({'url':CHNENERGY_ORIGIN+'/recTypeSerch?kinds=1&pagenum='+str(pagenum),
                           'file':str(path.relative_to(f.ROOT)).replace('\\','/'),
                           'sha256':hashlib.sha256(raw).hexdigest()})
    return raw.decode('utf-8','replace')

def chnenergy():
    company='国家能源集团';prefix='chnenergy'
    cards=[];pagenum=0
    while pagenum<40:
        html=chnenergy_request(pagenum,f'{prefix}-list-{pagenum}.html')
        page=[li for li in BeautifulSoup(html,'html.parser').select('li.list-group-item')
              if li.select_one('a.text-red[href]')]
        if not page:break
        cards+=page;pagenum+=1
    def detail(card):
        anchor=card.select_one('a.text-red[href]')
        jid=urllib.parse.parse_qs(urllib.parse.urlparse(anchor['href']).query).get('id',[None])[0]
        if not jid:return None
        name=f'{prefix}-detail-{jid}.html'
        try:
            path=f.RAW/name
            if path.exists():raw=path.read_bytes()
            else:
                request=urllib.request.Request(CHNENERGY_ORIGIN+'/annc/showgw?id='+jid,
                    headers={'User-Agent':f.USER_AGENT,'Referer':CHNENERGY_ORIGIN+'/recTypeSerch?kinds=1'})
                with urllib.request.urlopen(request,timeout=25) as response:raw=response.read()
                path.write_bytes(raw)
                f.MANIFEST.append({'url':CHNENERGY_ORIGIN+'/annc/showgw?id='+jid,
                                   'file':str(path.relative_to(f.ROOT)).replace('\\','/'),
                                   'sha256':hashlib.sha256(raw).hexdigest()})
            text=re.sub(r'\s+',' ',BeautifulSoup(raw.decode('utf-8','replace'),'html.parser').get_text(' ',strip=True))
            duty=re.search(r'岗位职责\s*(.*?)\s*岗位要求',text,re.S)
            requirement=re.search(r'岗位要求\s*(.*?)\s*(?:国家能源投资集团|$)',text,re.S)
            if not duty or not requirement:return None
            if re.search(r'实习|校园大使|兼职|公告|招募计划',anchor.get_text(strip=True)):return None
            unit=card.select_one('h5[title]')
            unit=unit['title'] if unit else company
            places=[li.get_text(strip=True) for li in card.select('ul.list-inline li')
                    if li.get_text(strip=True) and li.get_text(strip=True)!='|' and '招聘人数' not in li.get_text()]
            title=anchor.get('title') or anchor.get_text(strip=True)
            evidence=re.search(r'.{0,30}(?:2027|27届).{0,70}',title+' '+duty.group(1)+' '+requirement.group(1))
            if not evidence:return None
            url=CHNENERGY_ORIGIN+'/annc/showgw?id='+jid
            return f.make(company,prefix,jid,title,places,url,duty.group(1),requirement.group(1),
                evidence.group(0),url,name,industry='能源与电力',employer_unit=unit,
                program='2027年度高校毕业生直招')
        except Exception as error:
            f.FAILURES.append({'source':company,'id':jid,'reason':str(error)});return None
    rows=f.parallel(detail,cards)
    print(json.dumps({'source':company,'listed':len(cards),'accepted':len(rows)},ensure_ascii=False),flush=True)
    return rows

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sources',default='all');args=parser.parse_args()
    path=f.RAW/'accepted.json';rows=json.loads(path.read_text(encoding='utf-8')) if path.exists() else []
    for fn in [pinduoduo,bilibili,huawei,didi,moka,beisen,wecruit,chnenergy]:
        if args.sources!='all' and fn.__name__ not in args.sources.split(','):continue
        try:
            result=fn();rows+=result;print(json.dumps({'source':fn.__name__,'accepted':len(result)},ensure_ascii=False),flush=True)
        except Exception as error:f.FAILURES.append({'source':fn.__name__,'reason':str(error)});print(fn.__name__,str(error),flush=True)
        rows=list({r['id']:r for r in rows}.values());path.write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    (f.RAW/'manifest-more.json').write_text(json.dumps(f.MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
    (f.RAW/'excluded-more.json').write_text(json.dumps(f.FAILURES,ensure_ascii=False,indent=2),encoding='utf-8')
