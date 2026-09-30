#!/usr/bin/env python3
"""Audit WaDesk inventory coverage against machine manifests.

usage: audit_coverage.py [--inventory DIR] [--manifests DIR] [--out PREFIX] [--top N] [--only DOMAIN]

Reads every <inventory>/*.md (except files starting with '_'), extracts the
```json wadesk-coverage``` block, lints feature entries, and diffs claimed items
against the manifests in _work/manifests. Writes PREFIX.json and PREFIX.md.
"""
import argparse, json, os, re, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
REF = os.environ.get("WADESK_REF", os.path.join(REPO, "..", "wadesk-reference", "WaDesk"))
DEF_INV = os.path.join(REPO, "docs", "wadesk-port", "inventory")
DEF_MAN = os.environ.get("WADESK_MANIFESTS", os.path.join(REPO, "..", "_work", "manifests"))
DEF_OUT = os.path.join(os.path.dirname(DEF_MAN), "reports", "coverage")

FEATURE_LABELS = [
    "Status", "Priority", "Effort", "Depends on", "Summary", "Actors & access",
    "UX & screens", "Endpoints", "Data", "Rules & edge cases", "Async & events",
    "External systems", "Settings", "Acceptance criteria", "Source refs", "Port notes",
]
STATUS = {"implemented", "partial", "docs-only", "dead-code", "beta"}
PRIO = {"P0", "P1", "P2"}
EFFORT = {"S", "M", "L", "XL"}
FEATURE_RE = re.compile(r"^### (WD-([A-Z0-9]+)-(\d{3})) — (.+)$", re.M)
COV_RE = re.compile(r"```json wadesk-coverage\s*\n(.*?)\n```", re.S)


def lines(path):
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as f:
        return [l.rstrip("\n") for l in f if l.strip()]


def norm_path(p):
    p = p.strip().lstrip("./")
    for pre in ("wadesk-reference/WaDesk/", "WaDesk/"):
        if p.startswith(pre):
            p = p[len(pre):]
    return p


def route_pairs(route):
    methods = [m for m in route["method"].split("|") if m not in ("HEAD", "OPTIONS")]
    if not methods:
        methods = route["method"].split("|")
    uri = route["uri"].strip("/")
    return {f"{m} {uri}" for m in methods}


def norm_route(s):
    s = s.strip()
    if " " not in s:
        return s
    m, u = s.split(" ", 1)
    return f"{m.upper()} {u.strip().strip('/')}"


def expected_sets(man):
    exp = {}
    routes = json.load(open(os.path.join(man, "routes.json"), encoding="utf-8"))
    r = set()
    for x in routes:
        r |= route_pairs(x)
    exp["routes"] = r
    exp["controllers"] = {norm_path(p) for p in lines(f"{man}/controllers.txt")}
    exp["services"] = {norm_path(p) for p in lines(f"{man}/services.txt") + lines(f"{man}/bsp_files.txt")}
    exp["models"] = set(lines(f"{man}/models.txt"))
    exp["tables"] = set(lines(f"{man}/tables.txt")) - {
        "migrations", "failed_jobs", "password_reset_tokens", "cache", "cache_locks",
        "jobs", "job_batches", "sessions",
    }
    exp["views"] = {
        norm_path(p) for p in lines(f"{man}/views.txt")
        if "/views/vendor/" not in p and "/views/errors/" not in p
    }
    exp["commands"] = set(lines(f"{man}/commands.txt"))
    exp["permissions"] = set(lines(f"{man}/permissions.txt"))
    exp["middleware"] = {norm_path(p) for p in lines(f"{man}/middleware.txt")}
    exp["node_files"] = {
        norm_path(p) for p in lines(f"{man}/node_files.txt")
        if "/.git/" not in p and "node_modules" not in p and "baileys_auth" not in p
        and not p.endswith(".backup.js")
    }
    exp["js_assets"] = {norm_path(p) for p in lines(f"{man}/resources_nonview.txt")}
    exp["misc_files"] = {norm_path(p) for p in lines(f"{man}/events_mail_misc.txt")}
    exp["config_files"] = {f"config/{p}" for p in lines(f"{man}/config_files.txt")}
    docs = set()
    droot = os.path.join(REF, "..", "Documentation", "pages")
    for dp, _, fs in os.walk(droot):
        for f in fs:
            if f.endswith(".html"):
                docs.add("Documentation/pages/" + os.path.relpath(os.path.join(dp, f), droot))
    exp["doc_pages"] = docs
    return exp


def covered(item, claimed):
    if item in claimed:
        return True
    for c in claimed:
        if c.endswith("/") and item.startswith(c):
            return True
        if c.endswith("/*") and item.startswith(c[:-1]):
            return True
    return False


def lint_features(name, text, code):
    issues = []
    feats = list(FEATURE_RE.finditer(text))
    for i, m in enumerate(feats):
        fid, fcode, num, title = m.group(1), m.group(2), m.group(3), m.group(4)
        end = feats[i + 1].start() if i + 1 < len(feats) else len(text)
        # stop the last block at the next H2
        block = text[m.end():end]
        h2 = re.search(r"^## ", block, re.M)
        if h2:
            block = block[:h2.start()]
        if code and fcode != code:
            issues.append((fid, f"code {fcode} != front-matter code {code}"))
        missing = [l for l in FEATURE_LABELS if not re.search(rf"^\s*[-*] \*\*{re.escape(l)}:?\*\*", block, re.M)]
        if missing:
            issues.append((fid, "missing labels: " + ", ".join(missing)))
        st = re.search(r"\*\*Status:\*\*\s*([a-z-]+)", block)
        if st and st.group(1) not in STATUS:
            issues.append((fid, f"bad status {st.group(1)}"))
        pr = re.search(r"\*\*Priority:\*\*\s*(P\d)", block)
        if pr and pr.group(1) not in PRIO:
            issues.append((fid, f"bad priority {pr.group(1)}"))
        ef = re.search(r"\*\*Effort:\*\*\s*(XL|S|M|L)\b", block)
        if not ef:
            issues.append((fid, "effort not S/M/L/XL"))
        if len(re.findall(r"^\s*[-*]?\s*(?:Given|\*\*Given)", block, re.M)) < 1 and "Given" not in block:
            issues.append((fid, "no Given/When/Then acceptance criteria"))
    return feats, issues


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--inventory", default=DEF_INV)
    ap.add_argument("--manifests", default=DEF_MAN)
    ap.add_argument("--out", default=DEF_OUT)
    ap.add_argument("--top", type=int, default=150)
    ap.add_argument("--only", default=None, help="restrict to inventory file <ONLY>.md (lint one domain)")
    a = ap.parse_args()

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    exp = expected_sets(a.manifests)
    files = sorted(f for f in os.listdir(a.inventory) if f.endswith(".md") and not f.startswith("_"))
    if a.only:
        files = [f for f in files if f == a.only + ".md"]
    dom = {}
    claimed = {k: collections.defaultdict(set) for k in exp}
    all_ids = collections.defaultdict(list)
    for f in files:
        text = open(os.path.join(a.inventory, f), encoding="utf-8").read()
        fm = re.match(r"---\n(.*?)\n---", text, re.S)
        code = None
        if fm:
            m = re.search(r"^code:\s*([A-Z0-9]+)", fm.group(1), re.M)
            code = m.group(1) if m else None
        feats, issues = lint_features(f, text, code)
        for m in feats:
            all_ids[m.group(1)].append(f)
        info = {"features": len(feats), "lint": issues, "code": code, "lines": text.count("\n"),
                "coverage_ok": False, "claims": {}}
        cm = COV_RE.search(text)
        if not cm:
            info["error"] = "no wadesk-coverage block"
        else:
            try:
                cov = json.loads(cm.group(1))
                info["coverage_ok"] = True
                for k in exp:
                    vals = cov.get(k, []) or []
                    if k in ("routes",):
                        vals = [norm_route(v) for v in vals]
                    elif k not in ("models", "tables", "commands", "permissions"):
                        vals = [norm_path(v) for v in vals]
                    info["claims"][k] = len(vals)
                    for v in vals:
                        claimed[k][v].add(f)
                fmap = cov.get("feature_map", {}) or {}
                info["feature_map"] = len(fmap)
            except Exception as e:  # noqa
                info["error"] = f"coverage json invalid: {e}"
        dom[f[:-3]] = info

    report = {"domains": dom, "categories": {}, "duplicate_ids": {k: v for k, v in all_ids.items() if len(v) > 1}}
    for k, ex in exp.items():
        cl = claimed[k]
        cl_keys = set(cl)
        orphans = sorted(i for i in ex if not covered(i, cl_keys))
        unknown = sorted(i for i in cl_keys if i not in ex and not (i.endswith("/") or i.endswith("/*")))
        multi = sorted(i for i, d in cl.items() if len(d) > 1)
        report["categories"][k] = {
            "expected": len(ex), "orphans": orphans, "unknown": unknown,
            "multi_claimed": {i: sorted(cl[i]) for i in multi},
            "covered_pct": round(100 * (len(ex) - len(orphans)) / max(1, len(ex)), 1),
        }

    with open(a.out + ".json", "w") as f:
        json.dump(report, f, indent=1)

    L = []
    L.append(f"# Coverage audit\n\nDomains: {len(dom)}   Features: {sum(d['features'] for d in dom.values())}\n")
    L.append("| category | expected | orphans | unknown(typo) | multi-claimed | covered % |\n|---|---|---|---|---|---|")
    for k, c in report["categories"].items():
        L.append(f"| {k} | {c['expected']} | {len(c['orphans'])} | {len(c['unknown'])} | {len(c['multi_claimed'])} | {c['covered_pct']} |")
    L.append("\n## Domains\n\n| domain | features | lint issues | coverage block | routes | note |\n|---|---|---|---|---|---|")
    for d, i in sorted(dom.items()):
        L.append(f"| {d} | {i['features']} | {len(i['lint'])} | {'ok' if i['coverage_ok'] else 'MISSING/BAD'} | {i['claims'].get('routes','-')} | {i.get('error','')} |")
    if report["duplicate_ids"]:
        L.append("\n## Duplicate feature ids\n")
        for k, v in report["duplicate_ids"].items():
            L.append(f"- {k}: {', '.join(v)}")
    for k, c in report["categories"].items():
        if c["orphans"]:
            L.append(f"\n## Orphans: {k} ({len(c['orphans'])})\n")
            for o in c["orphans"][:a.top]:
                L.append(f"- `{o}`")
            if len(c["orphans"]) > a.top:
                L.append(f"- ... {len(c['orphans']) - a.top} more (see json)")
        if c["unknown"]:
            L.append(f"\n## Unknown claims (typos/hallucinations): {k} ({len(c['unknown'])})\n")
            for o in c["unknown"][:a.top]:
                L.append(f"- `{o}`")
    L.append("\n## Lint issues by domain\n")
    for d, i in sorted(dom.items()):
        if i["lint"]:
            L.append(f"### {d} ({len(i['lint'])})")
            for fid, msg in i["lint"][:25]:
                L.append(f"- {fid}: {msg}")
            if len(i["lint"]) > 25:
                L.append(f"- ... {len(i['lint']) - 25} more")
    with open(a.out + ".md", "w") as f:
        f.write("\n".join(L) + "\n")
    print("\n".join(L[:14]))
    print(f"\nwritten {a.out}.md / .json")


if __name__ == "__main__":
    main()
