"""Builds the HTML reports (timings, statements, fixes, rollup, QA, stress) from the measured JSON in the repo.
   python3 tools/perf/reports/gen.py [--results docs/quality/api-inventory] [--before results-before] [--stress perf] [--out docs/quality/reports]
Reports 1, 2 and 6 are generated from data (re-run after `measure.mjs` and `stress-ramp.mjs`); reports 3, 4 and 5 are the narrative of the
October 2026 work and are static text. Report 6 is skipped when perf/stress-legacy.json and perf/stress-rollup.json do not exist."""
import json, html, os, sys
def opt(n, d): return sys.argv[sys.argv.index(n)+1] if n in sys.argv else d
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'../../..'))
RES=os.path.join(ROOT,opt('--results','docs/quality/api-inventory'))
R=RES+'/'
BEFORE=opt('--before','results-before'); AFTER=opt('--after','results')
STRESS=os.path.join(ROOT,opt('--stress','perf'))
OUT=os.path.join(ROOT,opt('--out','docs/quality/reports'))+'/'
os.makedirs(OUT,exist_ok=True)
e=html.escape
CSS='''<style>:root{--bg:#fff;--fg:#1a1a1a;--mut:#666;--bd:#ddd;--bad:#b3261e;--ok:#1b7f3b;--hd:#f3f4f6}
@media(prefers-color-scheme:dark){:root{--bg:#15171a;--fg:#e8e8e8;--mut:#9aa;--bd:#333;--hd:#20242a;--bad:#ff8a80;--ok:#7ddc9a}}
body{background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif;margin:0 auto;max-width:1000px;padding:16px}
h1{font-size:24px}h2{margin-top:28px;font-size:18px}table{border-collapse:collapse;width:100%;font-size:13px;display:block;overflow-x:auto}
th,td{border:1px solid var(--bd);padding:4px 8px;text-align:left;vertical-align:top}th{background:var(--hd)}
.bad{color:var(--bad);font-weight:600}.ok{color:var(--ok);font-weight:600}.mut{color:var(--mut)}code{font:12px ui-monospace,monospace}
.card{border:1px solid var(--bd);border-radius:8px;padding:10px 14px;margin:10px 0}a{color:inherit}</style>'''
def page(fn,title,sub,body):
    open(OUT+fn,'w').write(f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{e(title)}</title>{CSS}</head><body><p><a href="index.html">&larr; all reports</a></p><h1>{e(title)}</h1><p class="mut">{e(sub)}</p>{body}</body></html>')
def tbl(head,rows):
    return '<table><tr>'+''.join(f'<th>{e(h)}</th>' for h in head)+'</tr>'+''.join('<tr>'+''.join(f'<td>{c}</td>' for c in r)+'</tr>' for r in rows)+'</table>'
SUB='crm-platform, PR lakshyatyagi241/threadwise#648, 2026-10-19. Machine: laptop, native Postgres 16, seeded org (100k contacts, 1M messages).'

# 1 API timings
a=json.load(open(R+BEFORE+'/api-timings.json')); b=json.load(open(R+AFTER+'/api-timings.json'))
def ok(v): return v.get('status')==200 and v.get('err') is None and v.get('p95') is not None
keys=sorted(set(a)|set(b), key=lambda k:-(b.get(k,{}).get('p95') or 0))
cb=sum(1 for k in a if ok(a[k]) and a[k]['p95']>300); ca=sum(1 for k in b if ok(b[k]) and b[k]['p95']>300)
c2b=sum(1 for k in a if ok(a[k]) and a[k]['p95']>200); c2a=sum(1 for k in b if ok(b[k]) and b[k]['p95']>200)
rows=[]
for k in keys:
    x,y=a.get(k,{}),b.get(k,{})
    if not ok(y) and not ok(x): continue
    p=(y.get('p95') if ok(y) else 0) or 0; q=(x.get('p95') if ok(x) else 0) or 0
    if max(p,q)<=200: continue
    cls='bad' if p>300 else ''
    rows.append([e(k),f'{q:.0f}' if q else '-',f'<span class="{cls}">{p:.0f}</span>' if p else '-',f'{y.get("n","")}'])
body=f'<div class="card"><b>Routes timed:</b> {sum(1 for k in b if ok(b[k]))} GET routes answering 200. <b>Critical (p95 &gt; 300 ms):</b> <span class="bad">{cb}</span> before &rarr; <span class="ok">{ca}</span> after. <b>Over 200 ms:</b> {c2b} &rarr; {c2a}.</div>'
body+='<h2>Routes over 200 ms (worst first), p95 in ms</h2>'+tbl(['Route','Before','After','Samples'],rows)
body+='<p class="mut">Routes that answered 404/500 or need data the seed lacks are not timings; the full list is in docs/quality/api-inventory/results/not-run.json. Machine load from another process made single numbers noisy; compare orders of magnitude.</p>'
page('01-api-response-times.html','Report 1: API response times, before and after',SUB,body)

# 2 statements
qa=json.load(open(R+BEFORE+'/query-timings.json')); qb=json.load(open(R+AFTER+'/query-timings.json'))
def slow(l): return sorted([r for r in l if r['meanMs']>50], key=lambda r:-r['meanMs'])
sa,sb=slow(qa),slow(qb)
def qrows(l): return [[f'{r["meanMs"]:.0f}',str(r['calls']),f'{r["totalMs"]:.0f}',f'<code>{e(" ".join(r["query"].split())[:220])}</code>'] for r in l[:25]]
body=f'<div class="card"><b>Statements with mean &gt; 50 ms:</b> <span class="bad">{len(sa)}</span> before &rarr; <span class="ok">{len(sb)}</span> after (pg_stat_statements, same seed and route calls).</div>'
body+='<h2>After: slowest statements</h2>'+tbl(['Mean ms','Calls','Total ms','Statement'],qrows(sb))
body+='<h2>Before: slowest statements</h2>'+tbl(['Mean ms','Calls','Total ms','Statement'],qrows(sa))
page('02-db-query-timings.html','Report 2: database statements over 50 ms',SUB,body)

# 3 fixes
fx=[('perf(db)','Marked current_org_id(), current_actor_id(), app_is_privileged() PARALLEL SAFE','They blocked parallel plans for every tenant-table query as the app role. 499 to 175 ms on 750k messages, same result. DB-wide planner change: check throughput under concurrent load before prod.','539a6d7c2'),
('perf(history)','Visibility rule as joins; count messages per conversation before joining','Parity with conversationVisible checked for 96 viewers x all channel-owner shapes; each rewrite compared with the old statement on messy data (mutation-checked).','c8557469b'),
('perf(dashboard)','Headline counts in one pass per conversation','280 to 99 ms.','0b19c5943'),
('perf(history)','Charts read the message branch once (GROUPING SETS)','760 to 400 ms (with work_mem 32 MB for the request). The shared scan for the summary was tried, was slower (GROUPING SETS is not parallel) and was reverted.','c54aca43d'),
('perf','Three more slow statements (contacts stats, plan analytics, platform workspaces)','Each checked against the statement it replaced. Platform analytics 650 to 100 ms.','4604488ec'),
('perf(overview)','The three message figures of the More hub from one pass','Merged three scans into one; month-edge behaviour tested with an injectable clock.','dddc9a273')]
body='<p>Summary: critical APIs (p95 &gt; 300 ms) 7 &rarr; 3; statements over 50 ms mean 25 &rarr; 13 (before the rollup). message-history insights 2.7 s &rarr; 0.8 s, summary 2.0 s &rarr; ~1.0 s, dashboard summary 593 &rarr; 238 ms.</p>'
body+=tbl(['Type','Change','Effect / evidence','Commit'],[[e(a1),e(b1),e(c1),f'<code>{d1}</code>'] for a1,b1,c1,d1 in fx])
page('03-performance-fixes.html','Report 3: performance fixes (top offenders and remaining statements)',SUB,body)

# 4 rollup
items=[('Writer','DB triggers write one MSG_STATE event per feed message and per status change plus first-reply events; guarded so a send never fails (15 to 30 microseconds a message, prototype measured).'),
('Two sources','MSG_FEED (events, after cut-over) and MSG_FEED_BASE / CONV_REPLY_BASE (rebuilt from messages, before cut-over): never mixed in one bucket.'),
('Read','MessageFeedService stitches day rows, hour rows, the unfolded tail and partial-hour edges, in workspace timezone.'),
('History','Cards, volume and type mix read it when ANALYTICS_SOURCES has msg_feed = shadow | rollup (default legacy). Exact cases only. Recipient rows and top conversations stay live.'),
('D8','Built as cohort deltas (creation-time stamped, paired state events), not transition time: exclusive status cards would go negative otherwise.'),
('D9','Average first reply = replies made in the window, whole hours; excluded from shadow comparison.'),
('Ops','pnpm --filter @crm/api backfill:message-feed (repeatable); nightly rebuild of last 7 days.')]
tests=[('Writer','state event fields, status chain, no event for system/reaction/mirrored/old, fail-open, first reply'),('Code parity','SQL status/kind/source codes equal contracts'),('Stitched read','equals live count: random windows, 3 timezones, hidden channel; aligned windows; tail vs fold'),('History parity','cards, volume day/hour/week, type mix, top conversations equal the scan; hidden channels equal visibleToJoinedSql'),('Ops','rebuild idempotent; nightly rebuild; bad range refused'),('Result','16 integration tests pass on native Postgres; mutation-checked (tail leaving rows, hidden-channel rule); 46 analytics unit tests; QA lib 40/40')]
body='<h2>What was built</h2>'+tbl(['Part','Detail'],[[e(x),e(y)] for x,y in items])
body+='<h2>Verification</h2>'+tbl(['Area','Checked'],[[e(x),e(y)] for x,y in tests])
body+='<h2>Rollout</h2><ol><li>Deploy (migration sets the cut-over).</li><li>Run backfill:message-feed.</li><li>ANALYTICS_SOURCES={"msg_feed":"shadow"}, watch AnalyticsShadow logs.</li><li>Switch to "rollup".</li></ol>'
body+='<h2>Known limits</h2><ul><li>Deleted messages stay counted (D10); the scan leaves them out.</li><li>DST repeated hour boundary not exact.</li><li>Imported history with old dates needs a backfill range.</li><li>A failed event write leaves that message out until rebuild.</li><li>Not yet measured: History request time on the rollup path (timing report not refreshed after the rollup).</li></ul>'
body+='<p class="mut">Commits: 12c7e70fe, 9dd4a3589, b383e74f3, 9185d8dc9. Design: docs/superpowers/specs/2026-10-19-message-count-rollup-design.md (section 14 = as built).</p>'
page('04-message-count-rollup.html','Report 4: message-count rollup',SUB,body)

# 5 QA
qs=[('47','CHECK constraints on 8 closed-set columns (status/kind), plus users.status and event_outbox.status','1325def1d, 224a02795','done; enum and retention items of unfinished features deferred (718e05cbb)'),
('43','N+1 loop filter: skips chunked, retry and drain loops, records why other write loops are fine','2f7f74b49','done'),
('49','Retention items of features under construction','718e05cbb','deferred, not reviewed as safe'),
('DLQ','Baselines for new DLQ code; retry-loop pattern matching','d2214325a','done'),
('Tests','NOT VALID check test allows the eight deliberate CHECKs; qa-suite classify import fixed (40/40)','c705905bd, 5d4aab5f0','done')]
body=tbl(['QA task','Work','Commits','Status'],[[e(a1),e(b1),f'<code>{e(c1)}</code>',e(d1)] for a1,b1,c1,d1 in qs])
body+='<p class="mut">Skipped by instruction: tiktok, line, wechat, viber, sms, email channels and BCAST-020. Unfinished features are baselined as deferred, not reviewed as safe.</p>'
page('05-qa-tasks.html','Report 5: QA tasks',SUB,body)

idx=[('01-api-response-times.html','API response times, before and after'),('02-db-query-timings.html','Database statements over 50 ms'),('03-performance-fixes.html','Performance fixes'),('04-message-count-rollup.html','Message-count rollup'),('05-qa-tasks.html','QA tasks')]
page('index.html','Reports: crm-platform performance and QA work',SUB,'<ul>'+''.join(f'<li><a href="{f}">{e(t)}</a></li>' for f,t in idx)+'</ul>')
print(cb,ca,c2b,c2a,len(sa),len(sb))

# 6 stress
if not (os.path.exists(STRESS+'/stress-legacy.json') and os.path.exists(STRESS+'/stress-rollup.json')):
    print('no stress results: report 6 skipped'); raise SystemExit(0)
L=json.load(open(STRESS+'/stress-legacy.json')); Rr=json.load(open(STRESS+'/stress-rollup.json'))
def steprows(d): return [[str(r['vus']),f"{r['rps']:.0f}",f"{r['p50']:.0f}",f"{r['p95']:.0f}",f"{r['p99']:.0f}",f"{r['errorRate']*100:.1f}%",str(r['dbActiveMax'])] for r in d['results']]
H=['Users','Req/s','p50 ms','p95 ms','p99 ms','Errors','DB active max']
def routerows(vus):
    a=next(r for r in L['results'] if r['vus']==vus)['routes']; b=next(r for r in Rr['results'] if r['vus']==vus)['routes']
    return [[e(k),f"{a[k]['p95']:.0f}",f"{b[k]['p95']:.0f}"] for k in sorted(a,key=lambda k:-a[k]['p95'])]
body='<div class="card"><b>Result:</b> on this machine neither run met the target (p95 &le; 500 ms, errors &lt; 1%) even at 5 users. No request failed (0% errors at every step), so the limit is speed, not stability. Throughput stops growing at about <b>25 req/s</b> (legacy) and <b>38 req/s</b> (message-history on the rollup). More users only queue: p50 at 100 users is 4.5 s (legacy) and 3.0 s (rollup).</div>'
body+='<h2>Legacy (msg_feed = legacy)</h2>'+tbl(H,steprows(L))+'<h2>Rollup (msg_feed = rollup)</h2>'+tbl(H,steprows(Rr))
body+='<h2>p95 per route at 5 users (ms)</h2>'+tbl(['Route','Legacy','Rollup'],routerows(5))
body+='<h2>p95 per route at 25 users (ms)</h2>'+tbl(['Route','Legacy','Rollup'],routerows(25))
body+='<h2>How to read it</h2><ul><li>Closed-loop ramp: each user sends the next request when the last answers (no think time), 20 s per step, mix of 10 read routes weighted to the inbox, contacts, history and dashboard (see tools/perf/stress-ramp.mjs).</li><li>Seed: 1M messages, 100k contacts in one workspace; one token; one source address per user.</li><li>"DB active max" stops at 28: the API database pool is the ceiling for concurrent statements, so past about 25 users requests wait for a connection.</li><li>The rollup run is the same build with ANALYTICS_SOURCES={"msg_feed":"rollup"}; summary and insights are the routes that changed.</li></ul>'
body+='<h2>Caveats (important)</h2><ul><li><b>Not a production number.</b> API, Postgres, Redis and the load generator share one laptop; the load average was 31 to 35 during the runs (other processes, Postgres parallel workers). Treat it as a ranking and a trend.</li><li>Reads only. The write path (message inserts with the new trigger, the rollup worker under load) was not stress-tested.</li><li>You asked for a non-local target first, then chose local; a staging or VM run is still the way to get capacity figures for a 1 GB production box.</li></ul>'
page('06-stress-test.html','Report 6: stress test (ramp to find the limit, local)',SUB,body)
idx.append(('06-stress-test.html','Stress test'))
page('index.html','Reports: crm-platform performance and QA work',SUB,'<ul>'+''.join(f'<li><a href="{f}">{e(t)}</a></li>' for f,t in idx)+'</ul>')
