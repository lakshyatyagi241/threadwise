import json, csv, re, os, collections
D='/home/user/threadwise/api-performance-report/csv'; os.makedirs(D,exist_ok=True)
SRC='/home/user/threadwise/crm-platform/apps/api/src'
spec=json.load(open('openapi.json')); ctrl=json.load(open('ctrl.json')); sw=json.load(open('sweep2.json'))
fl=json.load(open('flows-raw.json')); sraw=[json.loads(l) for l in open('sweep-raw.jsonl')]
def ref(o):
    if isinstance(o,dict) and '$ref' in o:
        n=spec
        for k in o['$ref'][2:].split('/'): n=n.get(k,{}) if isinstance(n,dict) else {}
        return n
    return o
def cls(x):
    if x is None: return 'not measured (not in OpenAPI)'
    if x.get('skipped'): return 'skipped'
    s=x['status']
    return {200:'success',201:'success',202:'success',204:'success',401:'unauthorized',403:'forbidden',429:'rate-limited',404:'not-found',400:'rejected',422:'rejected',409:'rejected'}.get(s,'fetch error' if s in('error','timeout') else 'other')
meas={(x['method'],x['path']):x for x in sw}
cmap=collections.defaultdict(list)
for c in ctrl: cmap[(c['http'],c['route'])].append(c)
keys=set()
rows=[]
def surface(p):
    for k,v in(('/v2/platform/','platform operator'),('/v2/partner/','partner portal'),('/api/v1/','public API key (v1)'),('/v2/public/','public (unauthenticated)'),('/public/v1/','public flows/leads'),('/v2/','staff CRM')):
        if p.startswith(k): return v
    return 'infrastructure / other'
allk=[(m.upper(),p) for p,it in spec['paths'].items() for m in it if m in('get','post','put','patch','delete')]
for m,p in allk: keys.add((m,p))
for k in cmap:
    keys.add(k)
cols=['method','path','surface','in_openapi','module_tag','operation_id','summary','description','auth_in_openapi','public_decorator','actor_kinds','permission_keys','idempotency_key_supported','throttle_decorator','guards','path_params','query_params','query_required','request_content_types','request_required_fields','response_codes','source_file','source_line','handler',
 'outcome','http_status','cold_ms','samples','min_ms','p50_ms','p95_ms','p99_ms','max_ms','mean_ms','ttfb_p50_ms','response_bytes','request_bytes','error_code','url_requested','note']
def reqfields(op):
    rb=op.get('requestBody')
    if not rb: return '',''
    ct=list(rb.get('content',{}).keys())
    sch=ref(next(iter(rb['content'].values()),{}).get('schema',{})) if ct else {}
    return ','.join(ct),','.join(sch.get('required',[])) if isinstance(sch,dict) else ''
out=[]
for m,p in sorted(keys,key=lambda k:(k[1],k[0])):
    op=(spec['paths'].get(p,{}) or {}).get(m.lower())
    cs=cmap.get((m,p),[]); c=cs[0] if cs else {}
    x=meas.get((m,p))
    params=[ref(q) for q in (op or {}).get('parameters',[])]
    ct,rf=reqfields(op) if op else ('','')
    sec=(op or {}).get('security')
    auth='public (no auth)' if op and sec==[] else ('bearer JWT' if op and (sec or any(True for _ in [0])) else '')
    if op and sec is None: auth='bearer JWT (default)'
    if op and sec and any('apiKey' in str(s) or 'api' in str(s).lower() for s in sec) and p.startswith('/api/v1'): auth='API key'
    if not op: auth='(not in OpenAPI)'
    row=dict(method=m,path=p,surface=surface(p),in_openapi='yes' if op else 'no (found in code only)',module_tag=','.join((op or {}).get('tags',[])) if op else '',
      operation_id=(op or {}).get('operationId',''),summary=(op or {}).get('summary',''),description=re.sub(r'\s+',' ',(op or {}).get('description','') or ''),
      auth_in_openapi=auth,public_decorator='yes' if c.get('public') or c.get('cls_public') else '',actor_kinds=c.get('actor',''),permission_keys=';'.join(sorted({k for cc in cs for k in cc['perms']})),
      idempotency_key_supported='yes' if c.get('idempotent') else '',throttle_decorator=c.get('throttle',''),guards=c.get('guards',''),
      path_params=','.join(q['name'] for q in params if q.get('in')=='path'),query_params=','.join(q['name'] for q in params if q.get('in')=='query'),query_required=','.join(q['name'] for q in params if q.get('in')=='query' and q.get('required')),
      request_content_types=ct,request_required_fields=rf,response_codes=','.join((op or {}).get('responses',{}).keys()) if op else '',
      source_file=c.get('file',''),source_line=c.get('line',''),handler=c.get('handler',''),outcome=cls(x) if op else 'not measured (not in OpenAPI)')
    if x and not x.get('skipped'):
        row.update(http_status=x['status'],cold_ms=x['coldMs'],samples=x['n'],min_ms=x['minMs'],p50_ms=x['p50Ms'],p95_ms=x['p95Ms'],p99_ms=x['p99Ms'],max_ms=x['maxMs'],mean_ms=x['meanMs'],ttfb_p50_ms=x['ttfbP50Ms'],response_bytes=x['respBytes'],request_bytes=x['reqBytes'],error_code=x['errCode'] or '',url_requested=x['url'])
    elif x and x.get('skipped'): row['note']='skipped: '+x['skipped']
    out.append(row)
with open(D+'/01-all-operations.csv','w',newline='') as f:
    w=csv.DictWriter(f,fieldnames=cols);w.writeheader();w.writerows(out)
print('operations',len(out),'in code only',sum(1 for r in out if r['in_openapi']!='yes'))
# 02 every request
n=0
with open(D+'/02-every-request.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['source','seq','timestamp_utc','test_phase','method','route','url_requested','attempt','note','http_status','ttfb_ms','total_ms','request_bytes','response_bytes'])
    for r in sraw:
        n+=1;w.writerow(['route sweep',r['seq'],r['at'],r['phase'],r['method'],r['route'],r['url'],r['attempt'],r['note'],r['status'],r['ttfbMs'],r['totalMs'],r['reqBytes'],r['respBytes']])
    for i,r in enumerate(fl,1):
        n+=1;w.writerow(['flow benchmark',i,r['at'],r['phase'],r['method'],r['route'],r['route'],'','',r['status'],r['ttfbMs'],r['totalMs'],r['reqBytes'],r['respBytes']])
print('requests',n,'sweep',len(sraw),'flows',len(fl))
# 03 queues inventory
qs=open(SRC+'/infra/queue/queues.ts').read()
qinfo={}
lines=qs.split('\n');cmt=[]
for ln in lines:
    t=ln.strip()
    if t.startswith('/**') or t.startswith('*') or t.startswith('//'): cmt.append(re.sub(r'^(/\*\*|\*/|\*|//)\s?','',t).replace('*/','').strip()); continue
    m=re.match(r"([A-Z_]+):\s*'([^']+)',",t)
    if m and ln.startswith('  '):
        qinfo[m.group(2)]=(m.group(1),' '.join(x for x in cmt if x)); cmt=[]
    elif t=='' : pass
    else: cmt=[]
_p=qinfo.get('privacy-export')
if _p and 'must hold nothing else.' in _p[1]:
    _a,_b=_p[1].split('must hold nothing else.',1)
    qinfo['wab-migrate']=('WAB_MIGRATE',(_a+'must hold nothing else.').strip())
    qinfo['privacy-export']=('PRIVACY_EXPORT',_b.strip())
const2name={v[0]:k for k,v in qinfo.items()}
proc={}
for dp,_,fs in os.walk(SRC):
    for fn in fs:
        if fn.endswith('.ts') and not fn.endswith('.spec.ts'):
            t=open(os.path.join(dp,fn)).read()
            for m in re.finditer(r"@Processor\(QUEUES\.([A-Z_]+)(?:,\s*\{(.*?)\}\s*\))?",t,re.S):
                cc=re.search(r'concurrency:\s*(\d+)',m.group(2) or '');proc[m.group(1)]=(os.path.relpath(os.path.join(dp,fn),SRC),cc.group(1) if cc else '')
rq={x['name']:x for x in json.load(open('queues.json'))['realQueues']}
with open(D+'/03-queues.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['queue','constant','purpose','processor_file','processor_concurrency','retry_policy','jobs_waiting','jobs_active','jobs_delayed','jobs_completed','jobs_failed','sampled_completed_jobs','wait_p50_ms','processing_p50_ms','processing_max_ms'])
    for name,(const,desc) in sorted(qinfo.items()):
        pf,cc=proc.get(const,('(no @Processor class: driven by a scheduled worker service)',''))
        retry='10 attempts, backoff 5s exp (about 40 min)' if const in('WABA_INGEST','WEBHOOK_RETRY','WEBHOOK_INGEST') else '5 attempts, backoff 2s exp'
        r=rq.get(name,{});c=r.get('counts',{});wm=r.get('waitMs') or {};pm=r.get('procMs') or {}
        w.writerow([name,const,desc,pf,cc,retry,c.get('wait',''),c.get('active',''),c.get('delayed',''),c.get('completed',''),c.get('failed',''),r.get('sampled',''),wm.get('p50',''),pm.get('p50',''),pm.get('max','')])
print('queues',len(qinfo))
# 04 redis raw, 05 bullmq raw
rr=json.load(open('redis-raw.json'))
with open(D+'/04-redis-every-sample.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['redis_operation','sample','round_trip_ms']);[w.writerow([r['op'],r['sample'],r['ms']]) for r in rr]
bj=json.load(open('bullmq-raw.json'))
with open(D+'/05-bullmq-every-job.csv','w',newline='') as f:
    w=csv.writer(f);w.writerow(['probe','job_id','enqueue_ms','queue_wait_ms','processing_ms','end_to_end_ms']);[w.writerow([r['probe'],r['job'],r['enqueueMs'],r['queueWaitMs'],r['processingMs'],r['endToEndMs']]) for r in bj]
print('redis samples',len(rr),'bullmq jobs',len(bj))
