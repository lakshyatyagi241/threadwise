import json, html, collections
S = '/tmp/claude-0/-home-user-threadwise/1955bc91-3d5f-5d13-add4-c614cf410949/scratchpad/'
OUT = '/home/user/threadwise/api-performance-report/API_PERFORMANCE_REPORT.html'
sweep = json.load(open(S + 'sweep.json'))
flows = json.load(open(S + 'flows.json'))
q = json.load(open(S + 'queues.json'))
e = html.escape


def cls(x):
    if x.get('skipped'): return 'skipped'
    s = x['status']
    if s in (200, 201, 202, 204): return 'success'
    if s == 401: return 'unauthorized'
    if s == 403: return 'forbidden'
    if s == 429: return 'rate-limited'
    if s == 404: return 'not-found'
    if s in (400, 422, 409): return 'rejected'
    return 'other'

OUTCOME_LABEL = {
    'success': 'Success (2xx)', 'rejected': 'Rejected 400/409/422', 'not-found': 'Not found 404',
    'unauthorized': 'Unauthorized 401', 'rate-limited': 'Rate limited 429', 'forbidden': 'Forbidden 403',
    'skipped': 'Skipped', 'other': 'Fetch error',
}
oc = collections.Counter(cls(x) for x in sweep)
ok = [x for x in sweep if cls(x) == 'success' and x['p50Ms'] is not None]
okp50 = sorted(x['p50Ms'] for x in ok)
med = okp50[len(okp50) // 2]


def bar(v, mx, color='var(--a)'):
    return f'<span class="bar"><i style="width:{max(1.5, v / mx * 100):.1f}%;background:{color}"></i></span>'


# ---- latency histogram of per-endpoint p50
edges = [(0, 3), (3, 5), (5, 8), (8, 12), (12, 20), (20, 1e9)]
labels = ['< 3 ms', '3–5 ms', '5–8 ms', '8–12 ms', '12–20 ms', '20 ms +']
hist = [sum(1 for v in okp50 if lo <= v < hi) for lo, hi in edges]
hmax = max(hist)
hist_html = ''.join(
    f'<div class="hrow"><span class="hl">{l}</span>{bar(c, hmax)}<span class="hv">{c}</span></div>'
    for l, c in zip(labels, hist))

# ---- slowest
slow = sorted(ok, key=lambda x: -x['p95Ms'])[:15]
smax = max(x['p95Ms'] for x in slow)
slow_html = ''.join(
    f'<tr><td class="mono">{e(x["method"])} {e(x["path"])}</td><td class="n">{x["p50Ms"]}</td>'
    f'<td class="n">{x["p95Ms"]}</td><td class="n">{x["respBytes"]:,}</td><td>{bar(x["p95Ms"], smax, "var(--warn)")}</td></tr>'
    for x in slow)

# ---- crud
crud_max = max(v['p95'] for v in flows['crud'].values())
crud_html = ''.join(
    f'<tr><td class="mono">{e(k)}</td><td class="n">{v["n"]}</td><td class="n">{v["p50"]}</td><td class="n">{v["p95"]}</td>'
    f'<td class="n">{v["p99"]}</td><td class="n">{v["max"]}</td><td class="n">{v["reqBytes"]}</td><td class="n">{v["respBytes"]}</td>'
    f'<td>{bar(v["p95"], crud_max)}</td></tr>' for k, v in flows['crud'].items())

ls_html = ''.join(
    f'<tr><td class="n">{x["limit"]}</td><td class="n">{x["respBytes"]:,}</td><td class="n">{x["p50"]}</td><td class="n">{x["p95"]}</td><td class="n">{x["p99"]}</td></tr>'
    for x in flows['listScaling'])
rs_html = ''.join(
    f'<tr><td class="n">{x["kb"]} KB</td><td class="n">{x["status"]}</td><td class="n">{x["p50"]}</td><td class="n">{x["p95"]}</td></tr>'
    for x in flows['reqSizeScaling'])

# ---- concurrency table + svg chart
cc = flows['concurrency']
cc_html = ''.join(
    f'<tr><td class="mono">{e(x["name"])}</td><td class="n">{x["concurrency"]}</td><td class="n">{x["rps"]}</td><td class="n">{x["p50"]}</td>'
    f'<td class="n">{x["p95"]}</td><td class="n">{x["p99"]}</td><td class="n">{x["max"]}</td><td class="n">{x["errors"]}</td></tr>' for x in cc)
series = collections.OrderedDict()
for x in cc: series.setdefault(x['name'], []).append((x['concurrency'], x['p50']))
W, H, L, R, T, B = 640, 280, 52, 20, 16, 40
xmax, ymax = 100, 600
def X(c): return L + (c / xmax) * (W - L - R)
def Y(v): return T + (1 - v / ymax) * (H - T - B)
svg = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="p50 latency versus concurrent clients">']
for v in range(0, ymax + 1, 100):
    svg.append(f'<line x1="{L}" x2="{W-R}" y1="{Y(v):.1f}" y2="{Y(v):.1f}" class="grid"/><text x="{L-8}" y="{Y(v)+4:.1f}" text-anchor="end" class="ax">{v}</text>')
for c in (1, 10, 50, 100):
    svg.append(f'<text x="{X(c):.1f}" y="{H-20}" text-anchor="middle" class="ax">{c}</text>')
svg.append(f'<text x="{(L+W-R)/2}" y="{H-3}" text-anchor="middle" class="ax">concurrent clients</text>')
svg.append(f'<text x="12" y="{(T+H-B)/2}" text-anchor="middle" class="ax" transform="rotate(-90 12 {(T+H-B)/2})">p50 ms</text>')
cols = ['var(--a)', 'var(--b)', 'var(--warn)']
for i, (name, pts) in enumerate(series.items()):
    d = ' '.join(f'{X(c):.1f},{Y(v):.1f}' for c, v in pts)
    svg.append(f'<polyline points="{d}" fill="none" stroke="{cols[i]}" stroke-width="2.2"/>')
    for c, v in pts:
        svg.append(f'<circle cx="{X(c):.1f}" cy="{Y(v):.1f}" r="3.6" fill="{cols[i]}"/>')
    c, v = pts[-1]
    svg.append(f'<text x="{min(X(c)+6, W-4):.1f}" y="{Y(v)-8:.1f}" text-anchor="{"end" if c>=100 else "start"}" class="lab" fill="{cols[i]}">{e(name.replace("GET ",""))}</text>')
svg.append('</svg>')
cc_svg = ''.join(svg)

# ---- redis / bullmq
rd_html = ''.join(
    f'<tr><td>{e(k[6:])}</td><td class="n">{v["n"]}</td><td class="n">{v["p50"]}</td><td class="n">{v["p95"]}</td><td class="n">{v["p99"]}</td><td class="n">{v["max"]}</td></tr>'
    for k, v in q.items() if k.startswith('redis ') and k != 'redisInfo')
bq_html = ''
for k, v in q.items():
    if k.startswith('bullmq'):
        bq_html += (f'<tr><td>{e(k[7:])}</td><td class="n">{v["concurrency"]}</td><td class="n">{v["simulatedWorkMs"]}</td>'
                    f'<td class="n">{v["enqueueMs"]["p50"]} / {v["enqueueMs"]["p99"]}</td><td class="n">{v["queueWaitMs"]["p50"]} / {v["queueWaitMs"]["p99"]}</td>'
                    f'<td class="n">{v["processingMs"]["p50"]} / {v["processingMs"]["p99"]}</td><td class="n">{v["endToEndMs"]["p50"]} / {v["endToEndMs"]["p99"]}</td>'
                    f'<td class="n">{v["jobsPerSec"]:,}</td></tr>')
rq_html = ''.join(
    f'<tr><td>{e(x["name"])}</td><td class="n">{x["sampled"]}</td><td class="n">{x["waitMs"]["p50"]}</td><td class="n">{x["procMs"]["p50"]}</td><td class="n">{x["procMs"]["max"]}</td></tr>'
    for x in q['realQueues'] if x['sampled'])

# ---- coverage
cov_rows = [
    ('success', 'Real work measured.'),
    ('rejected', 'Generated body failed validation: measures routing and validation only.'),
    ('not-found', 'Placeholder id (no list data to harvest an id from).'),
    ('unauthorized', 'Needs another actor: 409 are platform-operator, 15 are API-key, plus partner/HMAC routes.'),
    ('rate-limited', '/api/v1 public-API throttle (120 per minute).'),
    ('forbidden', 'Plan or permission gate on the seeded org (calling 23, growth 15).'),
    ('other', 'OAuth/payment callbacks that redirect to external hosts.'),
    ('skipped', 'Logout, password and session-revoke routes, skipped to keep the session alive.'),
]
cmax = max(oc.values())
cov_html = ''.join(
    f'<tr><td>{OUTCOME_LABEL[k]}</td><td class="n">{oc[k]}</td><td>{bar(oc[k], cmax, "var(--good)" if k == "success" else "var(--mute)")}</td><td class="note">{e(t)}</td></tr>'
    for k, t in cov_rows)

# ---- explorer data (compact arrays)
rows = []
for x in sorted(sweep, key=lambda x: (x['path'], x['method'])):
    c = cls(x)
    if x.get('skipped'):
        rows.append([x['method'], x['path'], x['tag'], c, None, None, None, None, None, None, None])
    else:
        rows.append([x['method'], x['path'], x['tag'], c, x['status'], x['coldMs'], x['p50Ms'], x['p95Ms'], x['p99Ms'], x['maxMs'], x['respBytes']])
data_json = json.dumps(rows, separators=(',', ':'))

mods = collections.defaultdict(lambda: [0, 0, []])
for x in sweep:
    m = mods[x['tag']]; m[0] += 1
    if cls(x) == 'success' and x['p50Ms'] is not None:
        m[1] += 1; m[2].append(x['p50Ms'])
mod_rows = sorted(((k, n, s, (sorted(l)[len(l)//2] if l else None)) for k, (n, s, l) in mods.items()), key=lambda a: (-a[1], a[0]))
mod_html = ''.join(f'<tr><td>{e(k)}</td><td class="n">{n}</td><td class="n">{s}</td><td class="n">{"–" if m is None else m}</td></tr>' for k, n, s, m in mod_rows)

page = open(S + 'template.html').read()
rep = {
    '{{HIST}}': hist_html, '{{SLOW}}': slow_html, '{{CRUD}}': crud_html, '{{LS}}': ls_html, '{{RS}}': rs_html,
    '{{CC}}': cc_html, '{{CCSVG}}': cc_svg, '{{REDIS}}': rd_html, '{{BULL}}': bq_html, '{{RQ}}': rq_html,
    '{{COV}}': cov_html, '{{DATA}}': data_json, '{{MODS}}': mod_html, '{{MEDIAN}}': str(med),
    '{{NMODS}}': str(len(mod_rows)),
}
for k, v in rep.items():
    assert k in page, k
    page = page.replace(k, v)
open(OUT, 'w').write(page)
print(len(page))
