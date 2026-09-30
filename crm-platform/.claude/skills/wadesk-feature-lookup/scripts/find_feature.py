#!/usr/bin/env python3
"""Look up WaDesk inventory features.

  find_feature.py WD-INBOX-014            full entry (+ owner and tracker status)
  find_feature.py --route "POST team-inbox/{id}/assign"
  find_feature.py --table conversations
  find_feature.py --domain TIB1           feature index of one domain (code or id)
  find_feature.py assign conversation     keyword search (all words must match)
  add --full to print full entries for keyword/route/table hits, --limit N (default 15)
"""
import argparse, json, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
BASE = os.path.join(REPO, "docs", "wadesk-port")
INV = os.path.join(BASE, "inventory")
FEATURE_RE = re.compile(r"^### (WD-([A-Z0-9]+)-(\d{3})) — (.+)$", re.M)
COV_RE = re.compile(r"```json wadesk-coverage\s*\n(.*?)\n```", re.S)
ROW_RE = re.compile(r"^\| (WD-[A-Z0-9]+-\d{3}) \| ([a-z-]+) \|", re.M)


def load_inventory():
    feats, domains = [], {}
    if not os.path.isdir(INV):
        return feats, domains
    for f in sorted(os.listdir(INV)):
        if not f.endswith(".md") or f.startswith("_"):
            continue
        text = open(os.path.join(INV, f), encoding="utf-8").read()
        fm = re.match(r"---\n(.*?)\n---", text, re.S)
        meta = {}
        if fm:
            for line in fm.group(1).splitlines():
                m = re.match(r"(\w+):\s*(.*?)\s*(#.*)?$", line)
                if m:
                    meta[m.group(1)] = m.group(2).strip('"')
        did = meta.get("domain", f[:-3])
        fmap = {}
        cm = COV_RE.search(text)
        if cm:
            try:
                fmap = json.loads(cm.group(1)).get("feature_map", {}) or {}
            except Exception:
                pass
        domains[did] = {"code": meta.get("code"), "title": meta.get("title", did), "file": f}
        ms = list(FEATURE_RE.finditer(text))
        for i, m in enumerate(ms):
            end = ms[i + 1].start() if i + 1 < len(ms) else len(text)
            block = text[m.start():end]
            h2 = re.search(r"^## ", text[m.end():end], re.M)
            if h2:
                block = text[m.start():m.end() + h2.start()]
            def field(name):
                mm = re.search(rf"\*\*{re.escape(name)}:\*\*\s*(.+)", block)
                return mm.group(1).strip() if mm else ""
            feats.append({
                "id": m.group(1), "code": m.group(2), "title": m.group(4).strip(), "domain": did,
                "status": field("Status"), "priority": field("Priority"), "effort": field("Effort"),
                "summary": field("Summary"), "block": block.rstrip() + "\n",
                "routes": fmap.get(m.group(1), []),
            })
    return feats, domains


def load_ownership():
    p = os.path.join(BASE, "ownership.json")
    if os.path.exists(p):
        try:
            return json.load(open(p))
        except Exception:
            return {}
    return {}


def load_tracker():
    st = {}
    td = os.path.join(BASE, "tracker")
    if os.path.isdir(td):
        for f in os.listdir(td):
            if f.endswith(".md"):
                for m in ROW_RE.finditer(open(os.path.join(td, f), encoding="utf-8").read()):
                    st[m.group(1)] = m.group(2)
    return st


def line(ft, own, trk):
    o = own.get("domains", {}).get(ft["domain"], {}).get("owner", "?")
    return f"{ft['id']:<16} {ft['priority']:<3} {ft['effort']:<3} {ft['status']:<12} {trk.get(ft['id'], '-'):<12} {o:<8} {ft['title']}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("words", nargs="*")
    ap.add_argument("--route")
    ap.add_argument("--table")
    ap.add_argument("--domain")
    ap.add_argument("--full", action="store_true")
    ap.add_argument("--limit", type=int, default=15)
    a = ap.parse_args()
    feats, domains = load_inventory()
    if not feats:
        print("no inventory found under docs/wadesk-port/inventory", file=sys.stderr)
        return 2
    own, trk = load_ownership(), load_tracker()
    hits = []
    if a.domain:
        key = a.domain.lower()
        hits = [f for f in feats if f["domain"].lower() == key or (domains[f["domain"]]["code"] or "").lower() == key]
    elif a.route:
        m, _, u = a.route.partition(" ")
        norm = f"{m.upper()} {u.strip().strip('/')}"
        hits = [f for f in feats if norm in f["routes"] or u.strip().strip("/") in f["block"]]
    elif a.table:
        rx = re.compile(rf"\b{re.escape(a.table)}\b")
        hits = [f for f in feats if rx.search(f["block"])]
    elif len(a.words) == 1 and re.fullmatch(r"WD-[A-Z0-9]+-\d{3}", a.words[0].upper()):
        hits = [f for f in feats if f["id"] == a.words[0].upper()]
        a.full = True
    elif a.words:
        ws = [w.lower() for w in a.words]
        scored = []
        for f in feats:
            hay = f["block"].lower()
            if all(w in hay for w in ws):
                title = f["title"].lower()
                scored.append((-sum(w in title for w in ws), f["id"], f))
        hits = [f for _, _, f in sorted(scored)]
    else:
        ap.print_help()
        return 2
    if not hits:
        print("no match")
        return 1
    total = len(hits)
    hits = hits if a.domain else hits[: a.limit]
    if a.full:
        for f in hits:
            d = domains[f["domain"]]
            o = own.get("domains", {}).get(f["domain"], {}).get("owner", "unassigned")
            print(f"<!-- domain: {f['domain']} ({d['title']}) | owner: {o} | tracker: {trk.get(f['id'], '-')} | file: docs/wadesk-port/inventory/{d['file']} -->")
            print(f["block"])
    else:
        print(f"{'ID':<16} {'Pri':<3} {'Eff':<3} {'Status':<12} {'Tracker':<12} {'Owner':<8} Title")
        for f in hits:
            print(line(f, own, trk))
    if total > len(hits):
        print(f"... {total - len(hits)} more (use --limit)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
