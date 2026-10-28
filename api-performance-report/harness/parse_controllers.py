import re, os, json, sys
ROOT='/home/user/threadwise/crm-platform/apps/api/src'
HTTP={'Get','Post','Put','Patch','Delete','All'}
def balanced(t,i):
    # t[i]=='(' ; return index after matching ')'
    d=0;q=None;j=i
    while j<len(t):
        c=t[j]
        if q:
            if c=='\\': j+=2;continue
            if c==q:q=None
        elif c in '\'"`': q=c
        elif c=='(':d+=1
        elif c==')':
            d-=1
            if d==0:return j+1
        j+=1
    return len(t)
def strs(a): return re.findall(r"""['"`]([^'"`]*)['"`]""",a)
def parse(path):
    t=open(path).read()
    out=[];group=[];pos=0;cls=None;i=0
    deco=re.compile(r'@(\w+)\(')
    line=lambda p:t.count('\n',0,p)+1
    while i<len(t):
        m=deco.search(t,i)
        if not m: break
        # between previous decorator end and this one, only whitespace/comments allowed to stay in group
        gap=t[i:m.start()]
        gap_clean=re.sub(r'//[^\n]*|/\*.*?\*/','',gap,flags=re.S).strip()
        if gap_clean and group:
            # a signature or code occurred: close group
            sig=re.match(r'(?:export\s+(?:abstract\s+)?class\s+(\w+))|(?:(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\()',gap_clean)
            handle(group,sig,gap_clean,out,path,line)
            group=[]
        end=balanced(t,m.end()-1)
        group.append((m.group(1),t[m.end():end-1],line(m.start())))
        i=end
    if group:
        gap_clean=re.sub(r'//[^\n]*|/\*.*?\*/','',t[i:],flags=re.S).strip()
        sig=re.match(r'(?:export\s+(?:abstract\s+)?class\s+(\w+))|(?:(?:public|private|protected)?\s*(?:async\s+)?(\w+)\s*\()',gap_clean)
        handle(group,sig,gap_clean,out,path,line)
    return out
state={}
def handle(group,sig,gap,out,path,line):
    names=[g[0] for g in group]
    if 'V1Controller' in names:
        a=[g for g in group if g[0]=='V1Controller'][0][1]
        s=re.match(r"\s*['\"`]([^'\"`]*)['\"`]",a)
        state[path]={'prefix':'api/v1/'+(s.group(1) if s else ''),'ver':'VERSION_NEUTRAL','cls_deco':{g[0]:g[1].strip() for g in group if g[0]!='V1Controller'},'v1':True}
        return
    if 'Controller' in names:
        a=[g for g in group if g[0]=='Controller'][0][1]
        pm=re.search(r"path\s*:\s*['\"`]([^'\"`]*)['\"`]",a)
        if pm: p=pm.group(1)
        else:
            s=re.match(r"\s*['\"`]([^'\"`]*)['\"`]",a); p=s.group(1) if s else ''
        ver='VERSION_NEUTRAL' if 'VERSION_NEUTRAL' in a else (re.search(r"version\s*:\s*['\"`](\d+)['\"`]",a) or [None,None])[1]
        state[path]={'prefix':p,'ver':ver,'cls_deco':{g[0]:g[1].strip() for g in group if g[0]!='Controller'}}
        return
    http=[g for g in group if g[0] in HTTP]
    if not http: return
    st=state.get(path,{'prefix':'','ver':None,'cls_deco':{}})
    h=http[0]
    name=None
    if sig: name=sig.group(2) if sig.lastindex and sig.lastindex>=2 and sig.group(2) else None
    d={g[0]:g[1].strip() for g in group}
    methods=['GET','POST','PUT','PATCH','DELETE'] if h[0]=='All' else [h[0].upper()]
    subs=strs(h[1]) or [''] if h[0]!='All' or strs(h[1]) else ['']
    for sub_ in subs:
      for mth in methods:
        out.append(dict(file=os.path.relpath(path,ROOT),line=h[2],handler=name or '',http=mth,sub=sub_,prefix=st['prefix'],ver=st['ver'],
          perms=strs(d.get('RequirePermission','')),public='Public' in d or 'PublicLimit' in d,idempotent='Idempotent' in d,
          throttle=re.sub(r'\s+',' ',d['Throttle']) if 'Throttle' in d else '',
          actor=(re.sub(r'\s+',' ',d.get('ActorKinds') or st['cls_deco'].get('ActorKinds','')).replace("'",'')),
          guards=re.sub(r'\s+',' ',d.get('UseGuards','') or st['cls_deco'].get('UseGuards','')),
          cls_public='Public' in st['cls_deco'] or bool(st.get('v1'))))
rows=[]
for dp,_,fs in os.walk(ROOT):
    for f in fs:
        if f.endswith('.ts') and not f.endswith('.spec.ts') and ('@Controller(' in open(os.path.join(dp,f)).read() or '@V1Controller(' in open(os.path.join(dp,f)).read()):
            state.clear()
            rows+=parse(os.path.join(dp,f))
def full(r):
    segs=[s for s in (r['prefix'],r['sub']) if s]
    p='/'.join(x.strip('/') for x in segs)
    p=re.sub(r':(\w+)(\([^)]*\))?',r'{\1}',p)
    if r['ver']=='VERSION_NEUTRAL' or r['ver'] is None and False: return '/'+p
    return f"/v{r['ver'] or '2'}/"+p if p else f"/v{r['ver'] or '2'}"
for r in rows: r['route']=full(r).rstrip('/') or '/'
json.dump(rows,open(sys.argv[1],'w'))
spec=json.load(open(sys.argv[2]))['paths']
keys={(m.upper(),p.rstrip('/')) for p,it in spec.items() for m in it if m in('get','post','put','patch','delete')}
mine={(r['http'],r['route']) for r in rows}
print('parsed',len(rows),'spec',len(keys),'matched',len(keys&mine),'unmatched spec',len(keys-mine))
print(sorted(keys-mine)[:12])
