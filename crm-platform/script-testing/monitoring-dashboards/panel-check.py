#!/usr/bin/env python3
"""Run the query of EVERY panel of EVERY Grafana dashboard against Prometheus.

  panel-check.py --grafana http://localhost:53193 --prom http://localhost:59193 --allow expected-empty-panels.json --out panels.json

Template variables are substituted ($__rate_interval -> 5m, $instance/$route/$queue/$service/$cache/$job/$target -> .*, $compare -> 5m).
A panel is DATA (some query returned series), EMPTY (all queries ran, none returned series) or ERROR (a query failed).
Exit 0 when there is no ERROR and every EMPTY panel is in the allow-list (a JSON list of {"titleRegex", "dashboard"?, "reason"});
exit 1 otherwise. Stale allow-list entries (panels that now have data) are reported but do not fail.
"""
import argparse, json, re, sys, urllib.parse, urllib.request

SUBST = {'$__rate_interval': '5m', '${__rate_interval}': '5m', '$__interval': '1m', '$__range': '1h',
         '$compare': '5m', '${compare}': '5m'}


def get(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.load(r)


def subst(expr):
    for k, v in SUBST.items():
        expr = expr.replace(k, v)
    return re.sub(r'\$\{?[a-zA-Z_]+\}?', '.*', expr)  # instance, route, queue, service, cache, job, target, ...


def panels(ps):
    for p in ps:
        if p.get('panels'):
            yield from panels(p['panels'])
        else:
            yield p


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--grafana', required=True)
    ap.add_argument('--prom', required=True)
    ap.add_argument('--allow')
    ap.add_argument('--out')
    a = ap.parse_args()
    allow = json.load(open(a.allow)) if a.allow else []
    allow = allow.get('panels', allow) if isinstance(allow, dict) else allow

    def allowed(uid, title):
        for e in allow:
            if re.search(e['titleRegex'], title) and e.get('dashboard', uid) == uid:
                return e
        return None

    def query(expr):
        try:
            d = get(a.prom + '/api/v1/query?' + urllib.parse.urlencode({'query': expr}))
            if d['status'] != 'success':
                return 'error', d.get('error', '')[:120]
            return 'ok', len(d['data']['result'])
        except Exception as e:  # network or HTTP 4xx/5xx (bad query)
            return 'error', str(e)[:120]

    rows, dashboards = [], []
    for s in get(a.grafana + '/api/search?type=dash-db'):
        d = get(a.grafana + '/api/dashboards/uid/' + s['uid'])['dashboard']
        dashboards.append({'uid': s['uid'], 'title': d.get('title')})
        for p in panels(d.get('panels', [])):
            exprs = [t['expr'] for t in p.get('targets', []) if t.get('expr')]
            if not exprs:
                continue
            res = [query(subst(e)) for e in exprs]
            errs = [r[1] for r in res if r[0] == 'error']
            has = any(r[0] == 'ok' and r[1] > 0 for r in res)
            status = 'ERROR' if errs else ('DATA' if has else 'EMPTY')
            row = {'dashboard': s['uid'], 'title': p.get('title', '?'), 'status': status}
            if errs:
                row['error'] = errs[0]
            if status == 'EMPTY':
                e = allowed(s['uid'], row['title'])
                row['expected'] = e['reason'] if e else None
            rows.append(row)

    n = lambda st: sum(1 for r in rows if r['status'] == st)
    unexpected = [r for r in rows if r['status'] == 'EMPTY' and not r.get('expected')]
    stale = [e for e in allow if not any(r['status'] == 'EMPTY' and re.search(e['titleRegex'], r['title'])
                                         and e.get('dashboard', r['dashboard']) == r['dashboard'] for r in rows)]
    out = {'dashboards': dashboards, 'total': len(rows), 'data': n('DATA'), 'empty': n('EMPTY'), 'error': n('ERROR'),
           'unexpectedEmpty': len(unexpected), 'staleAllowEntries': [e['titleRegex'] for e in stale], 'panels': rows}
    if a.out:
        json.dump(out, open(a.out, 'w'), indent=2)
    print(f"{len(dashboards)} dashboards, {out['total']} panels: {out['data']} with data, {out['empty']} empty "
          f"({out['empty'] - out['unexpectedEmpty']} expected), {out['error']} query errors")
    for r in rows:
        if r['status'] == 'ERROR':
            print(f"  ERROR  [{r['dashboard']}] {r['title']}: {r['error']}")
        elif r['status'] == 'EMPTY':
            print(f"  EMPTY  [{r['dashboard']}] {r['title']}: {'expected: ' + r['expected'] if r['expected'] else 'UNEXPECTED'}")
    for t in out['staleAllowEntries']:
        print(f"  note: allow-list entry '{t}' matched no empty panel (now has data?)")
    sys.exit(1 if out['error'] or unexpected or not rows else 0)


main()
