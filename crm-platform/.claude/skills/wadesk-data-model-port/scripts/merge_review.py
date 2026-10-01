#!/usr/bin/env python3
"""Merge result-*.json (findings from agents that read the WaDesk source, one per packet of tables) into review-overrides.json,
validating table and column names against the snapshot. usage: merge_review.py [results-dir]"""
import glob, json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", "..", ".."))
SRC = os.environ.get("SCHEMA_SRC") or os.path.join(REPO, "docs", "wadesk-port", "schema", "source")
RESULTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(SRC, "review")  # dir of result-*.json written by the reviewing agents
T = json.load(open(os.path.join(SRC, "wadesk-schema.json")))
out = {"relations": {}, "json": {}, "not_json": {}, "stream_suggestions": [], "enum_hints": {}, "unique_hints": [], "notes": {}}
bad = []
for f in sorted(glob.glob(os.path.join(RESULTS, "result-*.json"))):
    try:
        r = json.load(open(f))
    except Exception as e:
        bad.append(f"{os.path.basename(f)}: invalid json {e}"); continue
    for k, v in r.get("relations", {}).items():
        t, _, c = k.partition(".")
        cols = {x["name"] for x in T.get(t, {}).get("columns", [])}
        if c not in cols: bad.append(f"relation {k}: unknown column"); continue
        if v != "none" and v not in T: bad.append(f"relation {k} -> {v}: unknown table"); continue
        if k in out["relations"] and out["relations"][k] != v: bad.append(f"relation {k}: conflicting answers {out['relations'][k]} vs {v}")
        out["relations"][k] = v
    for sect in ("json", "not_json"):
        for t, cs in r.get(sect, {}).items():
            cols = {x["name"] for x in T.get(t, {}).get("columns", [])}
            ok = [c for c in cs if c in cols]
            bad += [f"{sect} {t}.{c}: unknown column" for c in cs if c not in cols]
            out[sect].setdefault(t, [])
            out[sect][t] = sorted(set(out[sect][t]) | set(ok))
    out["stream_suggestions"] += [s for s in r.get("stream_suggestions", []) if s.get("table") in T]
    for k, v in r.get("enum_hints", {}).items():
        t, _, c = k.partition(".")
        if c in {x["name"] for x in T.get(t, {}).get("columns", [])}: out["enum_hints"][k] = v
        else: bad.append(f"enum_hint {k}: unknown column")
    out["unique_hints"] += [u for u in r.get("unique_hints", []) if u.get("table") in T]
    for t, ns in r.get("notes", {}).items():
        if t in T: out["notes"].setdefault(t, []).extend(ns)
json.dump(out, open(os.path.join(SRC, "review-overrides.json"), "w"), indent=1)
print({k: (len(v)) for k, v in out.items()}, "problems:", len(bad))
for b in bad: print("  !", b)
