#!/usr/bin/env python3
"""Check that a branch only touches files its author owns.

  ownership_check.py [--as OWNER] [--base REF] [--files F...] [--strict] [--json]

Reads docs/threadwise-port/ownership.json. Every changed file is classified:
  OK        inside a zone owned by --as (incl. implicit inventory/port-map/parity/tracker files)
  FOREIGN   inside a zone owned by someone else            -> exit 1
  SEAM      a registered shared seam; edit only per its policy
  KERNEL    shared kernel; follow the shared-kernel protocol
  UNOWNED   matches nothing; agree on an owner or add it to ownership.json
--strict also fails on SEAM/KERNEL/UNOWNED. Changed files = commits vs base + working tree + untracked.
"""
import argparse, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = os.path.join(REPO, "docs", "threadwise-port")


def g2r(g):
    if g.endswith("/"):
        g += "**"
    i, out = 0, ""
    while i < len(g):
        if g.startswith("**/", i):
            out += "(?:.*/)?"; i += 3
        elif g.startswith("**", i):
            out += ".*"; i += 2
        elif g[i] == "*":
            out += "[^/]*"; i += 1
        elif g[i] == "?":
            out += "[^/]"; i += 1
        else:
            out += re.escape(g[i]); i += 1
    return re.compile("^" + out + "$")


def sh(*cmd):
    try:
        return subprocess.check_output(cmd, cwd=REPO, text=True, stderr=subprocess.DEVNULL)
    except Exception:
        return ""


def changed_files(base):
    if not base:
        base = "origin/main" if sh("git", "rev-parse", "--verify", "-q", "origin/main").strip() else "main"
    files = set(sh("git", "diff", "--relative", "--name-only", f"{base}...HEAD").split())
    files |= set(sh("git", "diff", "--relative", "--name-only", "HEAD").split())
    files |= set(sh("git", "ls-files", "-o", "--exclude-standard").split())
    return sorted(f for f in files if f)


def identity(own, given):
    if given:
        return given.lower()
    if os.environ.get("THREADWISE_OWNER"):
        return os.environ["THREADWISE_OWNER"].lower()
    vals = [sh("git", "config", k).strip().lower() for k in ("user.email", "user.name")]
    for name, info in own.get("owners", {}).items():
        cands = {name.lower(), (info.get("name") or "").lower(), *[x.lower() for x in info.get("aliases", [])]}
        if any(v and v in cands for v in vals):
            return name
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--as", dest="me")
    ap.add_argument("--base")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    p = os.path.join(BASE, "ownership.json")
    if not os.path.exists(p):
        print("docs/threadwise-port/ownership.json not found", file=sys.stderr); return 2
    own = json.load(open(p))
    me = identity(own, a.me)
    if not me or me not in own["owners"]:
        print("cannot tell who you are: pass --as NAME or export THREADWISE_OWNER=NAME "
              f"(owners: {', '.join(own['owners'])})", file=sys.stderr); return 2

    zones = []  # (regex, owner, label)
    for dom, info in own["domains"].items():
        o = info["owner"]
        for g in list(info.get("zone", [])) + [f"docs/threadwise-port/inventory/{dom}.md", f"docs/threadwise-port/port-map/{dom}.md", f"docs/threadwise-port/parity/{dom}.md"]:
            zones.append((g2r(g), o, dom))
    for o in own["owners"]:
        zones.append((g2r(f"docs/threadwise-port/tracker/{o}.md"), o, "tracker"))
    seams = [(g2r(s["path"]), s) for s in own.get("seams", [])]
    kernel = [g2r(g) for g in own.get("kernel", [])]

    files = a.files if a.files is not None else changed_files(a.base)
    res = {"OK": [], "FOREIGN": [], "SEAM": [], "KERNEL": [], "UNOWNED": []}
    for f in files:
        mine = next((z for z in zones if z[1] == me and z[0].match(f)), None)
        if mine:
            res["OK"].append((f, mine[2])); continue
        other = next((z for z in zones if z[0].match(f)), None)
        if other:
            res["FOREIGN"].append((f, f"{other[1]} ({other[2]})")); continue
        seam = next((s for r, s in seams if r.match(f)), None)
        if seam:
            res["SEAM"].append((f, seam.get("policy", ""))); continue
        if any(r.match(f) for r in kernel):
            res["KERNEL"].append((f, "shared kernel")); continue
        res["UNOWNED"].append((f, ""))

    if a.json:
        print(json.dumps({"me": me, **{k: [list(x) for x in v] for k, v in res.items()}}, indent=1))
    else:
        print(f"checking as {me}: {len(files)} changed file(s)")
        for k in ("FOREIGN", "SEAM", "KERNEL", "UNOWNED"):
            for f, note in res[k]:
                print(f"{k:<8} {f}" + (f"   <- {note}" if note else ""))
        print(f"OK       {len(res['OK'])} file(s) inside your zones")
    bad = res["FOREIGN"] or (a.strict and (res["SEAM"] or res["KERNEL"] or res["UNOWNED"]))
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
