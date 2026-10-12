#!/usr/bin/env python3
"""Per-owner Reference parity tracker.

  tracker.py init [--owner NAME | --all]      create/refresh tracker/<owner>.md rows from inventory + ownership.json
  tracker.py set TW-XXX-001 STATUS [--pr N] [--note TEXT] [--as OWNER]
  tracker.py summary [--owner NAME] [--domain ID]
  tracker.py validate                          exit 1 on any inconsistency (CI-safe)

Statuses: todo in-progress backend-done frontend-done done verified blocked wontfix
Each person edits ONLY their own tracker/<owner>.md, so trackers never conflict.
"""
import argparse, json, os, re, subprocess, sys, collections

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = os.path.join(REPO, "docs", "threadwise-port")
INV, TRK = os.path.join(BASE, "inventory"), os.path.join(BASE, "tracker")
STATUSES = ["todo", "in-progress", "backend-done", "frontend-done", "done", "verified", "blocked", "wontfix"]
FEATURE_RE = re.compile(r"^### ((?:WD|TW)-[A-Z0-9]+-\d{3}) — (.+)$", re.M)
ROW_RE = re.compile(r"^\| ((?:WD|TW)-[A-Z0-9]+-\d{3}) \| ([a-z-]+) \| (.*?) \| (.*?) \|$", re.M)
DOM_RE = re.compile(r"^## ([a-z0-9-]+) \(", re.M)


def die(msg, code=2):
    print(msg, file=sys.stderr)
    sys.exit(code)


def ownership():
    p = os.path.join(BASE, "ownership.json")
    if not os.path.exists(p):
        die("docs/threadwise-port/ownership.json not found (assignment not generated yet)")
    return json.load(open(p))


def inventory():
    """domain-id -> [(feature id, title)] in file order"""
    out = collections.OrderedDict()
    for f in sorted(os.listdir(INV)) if os.path.isdir(INV) else []:
        if f.endswith(".md") and not f.startswith("_"):
            t = open(os.path.join(INV, f), encoding="utf-8").read()
            fm = re.search(r"^domain:\s*(\S+)", t, re.M)
            out[fm.group(1) if fm else f[:-3]] = [(m.group(1), m.group(2).strip()) for m in FEATURE_RE.finditer(t)]
    return out


def owner_of_domain(own, dom):
    return own.get("domains", {}).get(dom, {}).get("owner")


def identity(own, given):
    if given:
        return given.lower()
    if os.environ.get("THREADWISE_OWNER"):
        return os.environ["THREADWISE_OWNER"].lower()
    vals = []
    for k in ("user.email", "user.name"):
        try:
            vals.append(subprocess.check_output(["git", "config", k], cwd=REPO, text=True).strip().lower())
        except Exception:
            pass
    for name, info in own.get("owners", {}).items():
        cands = {name.lower(), (info.get("name") or "").lower(), *[a.lower() for a in info.get("aliases", [])]}
        if any(v and v in cands for v in vals):
            return name
    return None


def read_rows(owner):
    p = os.path.join(TRK, f"{owner}.md")
    rows = collections.OrderedDict()
    if os.path.exists(p):
        for m in ROW_RE.finditer(open(p, encoding="utf-8").read()):
            rows[m.group(1)] = [m.group(2), m.group(3), m.group(4)]
    return rows


def render(owner, own, inv, old):
    name = own["owners"].get(owner, {}).get("name", owner)
    L = [f"# Reference port tracker — {name}", "",
         f"Only {name} edits this file (`threadwise-ownership-guard` enforces it). Statuses: " + " · ".join(STATUSES) + ".",
         "Update with: `python3 .claude/skills/threadwise-parity-tracker/scripts/tracker.py set TW-XXX-001 in-progress --pr 123`", ""]
    seen = set()
    for dom, info in own["domains"].items():
        if info.get("owner") != owner or dom not in inv:
            continue
        L += [f"## {dom} ({info.get('code', '')})", "", "| Feature | Status | PR | Notes |", "|---|---|---|---|"]
        for fid, _t in inv[dom]:
            st, pr, note = old.get(fid, ["todo", "", ""])
            L.append(f"| {fid} | {st} | {pr} | {note} |")
            seen.add(fid)
        L.append("")
    extra = [k for k in old if k not in seen]
    if extra:
        L += ["## orphaned (no longer in inventory or domain reassigned)", "", "| Feature | Status | PR | Notes |", "|---|---|---|---|"]
        L += [f"| {k} | {old[k][0]} | {old[k][1]} | {old[k][2]} |" for k in extra] + [""]
    return "\n".join(L)


def cmd_init(a):
    own, inv = ownership(), inventory()
    owners = list(own["owners"]) if a.all or not a.owner else [a.owner]
    os.makedirs(TRK, exist_ok=True)
    for o in owners:
        if o not in own["owners"]:
            die(f"unknown owner {o}")
        old = read_rows(o)
        open(os.path.join(TRK, f"{o}.md"), "w", encoding="utf-8").write(render(o, own, inv, old))
        n = len(read_rows(o))
        print(f"{o}: {n} rows -> docs/threadwise-port/tracker/{o}.md")


def cmd_set(a):
    own, inv = ownership(), inventory()
    if a.status not in STATUSES:
        die(f"status must be one of: {', '.join(STATUSES)}")
    fid = a.feature.upper()
    dom = next((d for d, fs in inv.items() if any(f == fid for f, _ in fs)), None)
    if not dom:
        die(f"{fid} is not in the inventory")
    owner = owner_of_domain(own, dom)
    if not owner:
        die(f"domain {dom} has no owner in ownership.json")
    me = identity(own, a.as_)
    if not me:
        die("cannot tell who you are: pass --as NAME or export THREADWISE_OWNER=NAME")
    if me != owner and not a.force:
        die(f"{fid} belongs to {owner} (domain {dom}); you are {me}. Ask {owner}, or reassign in ownership.json first.")
    p = os.path.join(TRK, f"{owner}.md")
    if not os.path.exists(p) or fid not in read_rows(owner):
        die(f"no row for {fid} in tracker/{owner}.md; run: tracker.py init --owner {owner}")
    text = open(p, encoding="utf-8").read()
    m = re.search(rf"^\| {re.escape(fid)} \| ([a-z-]+) \| (.*?) \| (.*?) \|$", text, re.M)
    pr = a.pr if a.pr is not None else m.group(2)
    note = a.note if a.note is not None else m.group(3)
    new = text[:m.start()] + f"| {fid} | {a.status} | {pr} | {note} |" + text[m.end():]
    open(p, "w", encoding="utf-8").write(new)
    print(f"{fid} -> {a.status}")


def cmd_summary(a):
    own, inv = ownership(), inventory()
    per = collections.OrderedDict()
    for o in own["owners"]:
        for fid, (st, _pr, _n) in read_rows(o).items():
            dom = next((d for d, fs in inv.items() if any(f == fid for f, _ in fs)), "?")
            per.setdefault(dom, collections.Counter())[st] += 1
    L = ["| domain | owner | total | done+verified | in progress | blocked | todo | % |", "|---|---|---|---|---|---|---|---|"]
    gt = collections.Counter()
    for dom, c in per.items():
        o = owner_of_domain(own, dom) or "?"
        if (a.owner and o != a.owner) or (a.domain and dom != a.domain):
            continue
        tot = sum(c.values()) - c["wontfix"]
        dn = c["done"] + c["verified"]
        ip = c["in-progress"] + c["backend-done"] + c["frontend-done"]
        pct = round(100 * dn / tot) if tot else 100
        L.append(f"| {dom} | {o} | {tot} | {dn} | {ip} | {c['blocked']} | {c['todo']} | {pct} |")
        gt["tot"] += tot; gt["dn"] += dn
    if gt["tot"]:
        L.append(f"| **all** | | {gt['tot']} | {gt['dn']} | | | | {round(100 * gt['dn'] / gt['tot'])} |")
    print("\n".join(L))


def cmd_validate(a):
    own, inv = ownership(), inventory()
    problems = []
    rows = {}
    for o in own["owners"]:
        for fid, r in read_rows(o).items():
            if fid in rows:
                problems.append(f"{fid} appears in trackers of {rows[fid][0]} and {o}")
            rows[fid] = (o, r)
            if r[0] not in STATUSES:
                problems.append(f"{fid} in {o}.md has invalid status {r[0]}")
    inv_ids = {fid: dom for dom, fs in inv.items() for fid, _ in fs}
    for fid, (o, _r) in rows.items():
        if fid not in inv_ids:
            problems.append(f"{fid} (tracker {o}.md) is not in the inventory")
        elif owner_of_domain(own, inv_ids[fid]) != o:
            problems.append(f"{fid} is in {o}.md but domain {inv_ids[fid]} is owned by {owner_of_domain(own, inv_ids[fid])}")
    for fid, dom in inv_ids.items():
        if owner_of_domain(own, dom) and fid not in rows:
            problems.append(f"{fid} (domain {dom}) has no tracker row; run tracker.py init")
    for d in inv:
        if d not in own["domains"]:
            problems.append(f"domain {d} is in the inventory but not in ownership.json")
    if problems:
        print(f"{len(problems)} problem(s):")
        print("\n".join("- " + p for p in problems[:100]))
        sys.exit(1)
    print(f"ok: {len(inv_ids)} features, {len(rows)} tracker rows, {len(own['owners'])} owners")


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("init"); p.add_argument("--owner"); p.add_argument("--all", action="store_true"); p.set_defaults(fn=cmd_init)
    p = sp.add_parser("set"); p.add_argument("feature"); p.add_argument("status"); p.add_argument("--pr"); p.add_argument("--note")
    p.add_argument("--as", dest="as_"); p.add_argument("--force", action="store_true"); p.set_defaults(fn=cmd_set)
    p = sp.add_parser("summary"); p.add_argument("--owner"); p.add_argument("--domain"); p.set_defaults(fn=cmd_summary)
    p = sp.add_parser("validate"); p.set_defaults(fn=cmd_validate)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
