"""Apply the employer/NWU-only source rule and archive excluded catalog rows.

Network reads below verify source data and application destinations, not app tests.
"""
import concurrent.futures
import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import re
import shutil
import sqlite3
import urllib.parse
from collections import Counter
from pathlib import Path
from bs4 import BeautifulSoup
from job_catalog_utils import category

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('direct',ROOT/'scripts/collect-direct-jobs.py')
direct=importlib.util.module_from_spec(spec);spec.loader.exec_module(direct)
POLICY=json.loads((ROOT/'data/job-source-policy.json').read_text(encoding='utf-8'))
STAMP=direct.STAMP
RAW=direct.RAW

def accepted(row):
    if row.get('source_policy')!=POLICY['version'] or row.get('record_type')!='job' or row.get('cohort')!=2027 or not row.get('direct_apply_verified') or row.get('catalog_status')!='active':return False
    if not all(row.get(k) for k in ['external_id','title','description','cohort_evidence']):return False
    if re.search('实习生|实习岗位|招聘公告|招募计划',row['title']):return False
    urls=[urllib.parse.urlparse(row.get(k,'')) for k in ['source_url','apply_url','cohort_evidence_url']]
    rule=next((r for r in POLICY['sources'] if r['host']==urls[0].hostname and r['source_type']==row.get('source_type')),None)
    if not rule or (rule['company'] and rule['company']!=row['company']):return False
    if any(u.scheme!='https' or u.username or u.password for u in urls):return False
    if any(u.hostname!=rule['host'] for u in urls[:2]):return False
    if urls[2].hostname!=rule['host'] and row['cohort_evidence_url'] not in rule.get('evidence_urls',[]):return False
    if rule.get('project_id') and (row.get('source_project_id')!=rule['project_id'] or row.get('source_authorization_url')!=rule['authorization_url']):return False
    if row['source_type']=='nwu_official' and row.get('source_school_id')!=POLICY['school_id']:return False
    for u in urls[:2]:
        pattern=rule.get('id_fragment_pattern') or rule.get('id_path_pattern')
        if pattern:
            match=re.fullmatch(pattern,u.fragment if rule.get('id_fragment_pattern') else u.path)
            key=match.group(1) if match else None
        else:
            key=urllib.parse.parse_qs(u.query).get(rule['id_query'],[''])[0] if rule['id_query'] else urllib.parse.unquote(u.path.split('/')[-1])
        if not re.fullmatch(rule['path_pattern'],u.path) or key!=str(row['external_id']):return False
    return True

def original_jobs(rows):
    proof=direct.read('https://talent.baidu.com/jobs/list?recruitType=GRADUATE','baidu-current-cohort.html').decode()
    tme_proof=direct.read('https://join.tencentmusic.com/campus/faq/','tme-current-cohort.html').decode()
    master=direct.read('https://join.tencentmusic.com/master/','tme-current-master.html').decode()
    candidates=[r for r in rows if r.get('source_type')=='employer_official' and r.get('listing_kind')=='official_post' and r['company'] in ['百度','腾讯音乐']]
    failures=[]
    def check(row):
        try:
            if row['company']=='百度':
                if '全球2027届毕业生' not in proof:raise ValueError('官网不再确认2027届')
                name='baidu-live-'+str(row['external_id'])+'.html'
                page=direct.read(row['apply_url'],name).decode()
                visible=BeautifulSoup(page,'html.parser').get_text(' ',strip=True)
                if row['title'] not in visible or '申请职位' not in visible:raise ValueError('岗位标题或申请入口未匹配')
            else:
                if '2027' not in tme_proof or '2027' not in master:raise ValueError('官网届别待确认')
                name='tme-live-'+str(row['external_id'])+'.json'
                data=json.loads(direct.read('https://join.tencentmusic.com/api/uc-job/info?id='+str(row['external_id']),name))
                detail=data.get('data') or {}
                if str(data.get('code'))!='200' or detail.get('name')!=row['title'] or int(detail.get('job_type',0)) not in (10,40):raise ValueError('官网详情不再匹配该全职岗位')
                html=direct.read(row['apply_url'],'tme-page-'+str(row['external_id'])+'.html').decode()
                if '立即投递' not in html:raise ValueError('投递页不可确认')
            observed=dt.datetime.fromtimestamp((RAW/name).stat().st_mtime,dt.timezone(dt.timedelta(hours=8))).isoformat(timespec='seconds')
            row.update(source_policy=POLICY['version'],catalog_status='active',direct_apply_verified=True,
                       link_checked_at=observed,source_file=str((RAW/name).relative_to(ROOT)).replace('\\','/'))
            return row
        except Exception as error:
            failures.append({'id':row['id'],'title':row['title'],'reason':str(error)});return None
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        verified=[r for r in pool.map(check,candidates) if r]
    (RAW/'original-link-exclusions.json').write_text(json.dumps(failures,ensure_ascii=False,indent=2),encoding='utf-8')
    return verified

def enrich(row):
    nature={
        '中核集团':'央企及所属企业', '中国银行':'国有银行',
        '百度':'民营企业', '腾讯音乐':'民营企业', '苏州科达':'民营企业',
        '精测电子':'民营企业', '泰凌微电子':'民营企业',
    }
    row['company_nature']=nature.get(row['company'],row.get('company_nature') or '其他／待核实')
    row.setdefault('cities_raw',list(row['cities']))
    places=[city.strip().removesuffix('市') for value in row['cities'] for city in re.split(r'[/、,，;；]',value) if city.strip()]
    city_aliases={'中国香港':'香港','香港特别行政区':'香港','布拉格直辖':'布拉格'}
    row['cities']=list(dict.fromkeys(city_aliases.get(city,city) for city in places))
    row.setdefault('category_raw',row.get('category',''))
    row['category']=category(row['title'],row.get('category_raw',''))
    title=row['title']
    if re.search('后端|前端|全栈|应用开发|软件实施|软件维护|软件售前|金融科技',title):row['category']='软件研发'
    elif 'UX' in title:row['category']='设计'
    elif '交付经理' in title:row['category']='项目管理'
    elif re.search('培训生|管培生|管理储备|储备网点',title):row['category']='管培生'
    elif '网络规划储备' in title:row['category']='供应链'
    elif re.search('教师|项目老师',title):row['category']='教育'
    elif '期现研究' in title:row['category']='金融与投研'
    if '财务' in title:row['category']='财务与审计'
    row['directions']=[row['category']]
    company=row['company']
    if '银行' in company:row['industry']='银行与金融'
    elif '证券' in company or '期货' in company:row['industry']='证券与投资'
    elif '顺丰' in company:row['industry']='物流与交通'
    elif '教育' in company or '助学' in company:row['industry']='教育与公益'
    elif '北森' in company or '彩讯' in company:row['industry']='互联网与软件'
    elif '化工' in company:row['industry']='化工与材料'
    elif '艾思法' in company:row['industry']='消费与零售'
    elif '博睿兴远' in company:row['industry']='商业服务'
    if row['source_type']=='nwu_official':
        overrides={
          '2027-UX设计师':'北京','2027-后端工程师':'北京 成都 西安','2027-测评交付经理':'北京 上海 苏州 杭州 郑州 天津 广州 深圳',
          '2027-安全工程师':'北京','2027-服务管培生':'上海 杭州 成都 天津 广州 深圳','2027-软件产品经理':'北京 成都',
          '2027-软件交付经理':'北京 上海 苏州 杭州 郑州 天津 广州 深圳','2027-前端工程师':'大连 北京 成都 西安','2027-算法工程师':'北京',
        }
        locations=None
        if '北森' in company:locations=overrides.get(title)
        if '彩讯' in company:locations='北京 广州 深圳 成都 杭州'
        if '心诺化工' in company:locations='杭州 新乡'
        if '博睿兴远' in company:locations='马来西亚 南苏丹 肯尼亚'
        if '平行线根源' in company:locations='北京 广州 深圳 郑州 西安 成都 开封 洛阳 南阳 安阳 商丘 焦作 许昌 平顶山 新乡'
        if locations:
            row['cities_raw']=row['cities'];row['cities']=locations.split()
            row['base_note']='采用该具体岗位正文明确列出的工作地点；原表单地区可能不完整。'
        row['cities']=[c for c in row['cities'] if c not in ['市辖区','暂无','请选择']]
        row['base_scope']='job' if row['cities'] else 'unspecified'
    return row

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--merge-only',action='store_true',help='Merge new reviewed employers; preserve the current catalog without refreshing older sources')
    args=parser.parse_args()
    seed=ROOT/'data/jobs-2027.json';old=json.loads(seed.read_text(encoding='utf-8'))
    fresh=json.loads((RAW/'accepted.json').read_text(encoding='utf-8')) if (RAW/'accepted.json').exists() else []
    # These NWU postings are group announcements or explicitly require an external
    # official-only submission route that the notice does not link at job level.
    excluded_companies={'杭州加多宝饮料有限公司','中信证券股份有限公司陕西分公司','中信证券股份有限公司上海分公司'}
    fresh=[r for r in fresh if r['company'] not in excluded_companies and not re.search('实习|招聘公告|招募计划',r['title'])]
    candidate_file=ROOT/'data/official-portal-candidates.json'
    portal_candidates=json.loads(candidate_file.read_text(encoding='utf-8'))['jobs'] if candidate_file.exists() else old['jobs']
    # Include previously withdrawn official posts so a later successful source
    # check can restore them without changing saved-application IDs.
    archived=ROOT/'data/archive/jobs-before-official-nwu-policy.json'
    historical=json.loads(archived.read_text(encoding='utf-8'))['jobs'] if archived.exists() else []
    candidates=list({r['id']:r for r in historical+portal_candidates}.values())
    # Preserve other reviewed employer channels when the original collector is
    # refreshed. Later evidence for the same official job ID replaces older fields.
    expansion={}
    catalogs=list((ROOT/'data/sources').glob('*-employers/accepted.json'))+list((ROOT/'data/sources').glob('*-brands/accepted.json'))
    for filename in sorted(catalogs):
        for row in json.loads(filename.read_text(encoding='utf-8')): expansion[row['id']]=row
    if args.merge_only:
        combined=old['jobs']+list(expansion.values())
    else:
        retained=[r for r in old['jobs'] if r['company'] not in ['百度','腾讯音乐']]
        combined=retained+original_jobs(candidates)+fresh+list(expansion.values())
    rows=[enrich(r) for r in combined if accepted(r)]
    rows=list({r['id']:r for r in rows}.values())
    unique={};duplicates=[]
    for row in rows:
        signature=(row['company'],row['title'],tuple(sorted(row['cities'])),row['description'],row['requirements'],row.get('employer_unit'))
        if signature in unique:
            duplicates.append({'id':row['id'],'kept_id':unique[signature]['id'],'reason':'同单位、标题、Base、职责、要求完全相同的重复广告'})
        else: unique[signature]=row
    rows=list(unique.values())
    (RAW/'duplicate-ads.json').write_text(json.dumps(duplicates,ensure_ascii=False,indent=2),encoding='utf-8')
    archive=ROOT/'data/archive';archive.mkdir(exist_ok=True)
    backup=archive/'jobs-before-official-nwu-policy.json'
    if not backup.exists():shutil.copy2(seed,backup)
    expansion_backup=archive/('jobs-before-employer-expansion-'+STAMP[:10]+'.json')
    if not expansion_backup.exists():shutil.copy2(seed,expansion_backup)
    counts=dict(sorted(Counter(r['company'] for r in rows).items()))
    sources=Counter(r['source_type'] for r in rows)
    meta=dict(schema_version=3,collected_at=STAMP,source_policy=POLICY['version'],count=len(rows),job_count=len(rows),campaign_count=0,
              companies=counts,company_count=len(counts),industry_count=len({r['industry'] for r in rows}),
              employer_count=sources['employer_official'],nwu_count=sources['nwu_official'],
              company_natures=dict(Counter(r['company_nature'] for r in rows)),
              scope='仅企业官方招聘网站和西北大学就业网的具体2027届岗位，链接直达单岗位投递页。',
              limitations='来源仅限企业官方招聘渠道及西北大学就业网。均为具体岗位，保留岗位编号、届别依据和投递页；第三方招聘系统仅接入已核实的企业专属站点。可能需要登录来源网站，招聘状态以投递页为准。')
    draft=seed.with_suffix('.pending.json');draft.write_text(json.dumps({**meta,'jobs':rows},ensure_ascii=False,indent=2),encoding='utf-8');draft.replace(seed)
    with sqlite3.connect(ROOT/'storage/offerbiu.sqlite',timeout=15) as conn:
        if 'catalog_active' not in [x[1] for x in conn.execute('PRAGMA table_info(jobs)')]:conn.execute('ALTER TABLE jobs ADD COLUMN catalog_active INTEGER NOT NULL DEFAULT 0')
        conn.execute('UPDATE jobs SET catalog_active=0')
        conn.executemany('''INSERT INTO jobs(id,company,title,cities,category,cohort,payload,collected_at,catalog_active) VALUES(?,?,?,?,?,?,?,?,1)
          ON CONFLICT(id) DO UPDATE SET company=excluded.company,title=excluded.title,cities=excluded.cities,category=excluded.category,
          cohort=excluded.cohort,payload=excluded.payload,collected_at=excluded.collected_at,catalog_active=1''',
          [(r['id'],r['company'],r['title'],' / '.join(r['cities']),r['category'],2027,json.dumps(r,ensure_ascii=False),r['collected_at']) for r in rows])
        conn.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)',('jobs_metadata',json.dumps(meta,ensure_ascii=False)))
        conn.execute('INSERT OR REPLACE INTO metadata(key,value) VALUES(?,?)',('jobs_imported_at',STAMP))
    (RAW/'link-manifest.json').write_text(json.dumps(direct.MANIFEST,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(meta,ensure_ascii=False))

if __name__=='__main__':main()
