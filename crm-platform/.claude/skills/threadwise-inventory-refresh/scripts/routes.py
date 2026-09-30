#!/usr/bin/env python3
"""Query Reference routes manifest.  routes.py [--uri S ...] [--ctrl S ...] [--name S ...] [--closures] [--count]
Filters OR together (case-insensitive substring). Output: METHOD uri | name | Controller@method | middleware
"""
import json, os, sys, argparse
_repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", ".."))
M = os.path.join(os.environ.get("THREADWISE_MANIFESTS", os.path.join(_repo, "..", "_work", "manifests")), "routes.json")
ap = argparse.ArgumentParser()
ap.add_argument("--uri", action="append", default=[])
ap.add_argument("--ctrl", action="append", default=[])
ap.add_argument("--name", action="append", default=[])
ap.add_argument("--closures", action="store_true")
ap.add_argument("--count", action="store_true")
a = ap.parse_args()
rs = json.load(open(M))
out = []
for r in rs:
    act = r.get("action") or ""
    short = act.replace("App\\Http\\Controllers\\", "")
    hit = (a.closures and act == "Closure")
    hit = hit or any(s.lower() in r["uri"].lower() for s in a.uri)
    hit = hit or any(s.lower() in short.lower() for s in a.ctrl)
    hit = hit or any(s.lower() in (r.get("name") or "").lower() for s in a.name)
    if not (a.uri or a.ctrl or a.name or a.closures):
        hit = True
    if hit:
        mw = ",".join(m.split("\\")[-1] for m in (r.get("middleware") or []) if m not in ("web",))
        methods = "|".join(m for m in r["method"].split("|") if m not in ("HEAD", "OPTIONS")) or r["method"]
        out.append(f"{methods} {r['uri']} | {r.get('name') or '-'} | {short} | {mw}")
if a.count:
    print(len(out))
else:
    print("\n".join(out))
