#!/usr/bin/env python3
"""What did this change build, and what does Reference have for it?

  detect_scope.py                      JSON for the current branch/working tree (vs origin/main or main)
  detect_scope.py --text               the same as a short human summary
  detect_scope.py --files a.ts b.tsx   scope for explicit paths instead of git
  detect_scope.py --base REF           compare against another base
  detect_scope.py --stamp-if-trivial   if nothing here has a comparable surface, record a "skipped" stamp and exit 0

Everything it reports is derived, not authoritative: routes are read from decorators/paths with regexes, features
from the branch name, commit messages and the tracker. The skill confirms them against the inventory entry.
"""
import argparse
import glob
import importlib.util
import json
import os
import re
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo (also covers the sibling skill modules we import)

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import parity_lib as P  # noqa: E402

REPO = P.REPO
INTERNAL_ONLY = re.compile(r"(\.module\.[tj]s|(^|/)index\.[tj]s|\.d\.ts)$")


def read(path):
    try:
        with open(os.path.join(REPO, path), encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""


def _balanced(text, start):
    depth, i = 0, start
    while i < len(text):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
        i += 1
    return ""


def api_routes(path):
    """Approximate METHOD /vN/<controller>/<sub> list from Nest decorators."""
    text = read(path)
    if "@Controller" not in text:
        return []
    m = re.search(r"@Controller\(", text)
    body = _balanced(text, m.end() - 1)
    pm = re.search(r"path:\s*['\"]([^'\"]*)['\"]", body) or re.match(r"\s*['\"]([^'\"]*)['\"]", body)
    vm = re.search(r"version:\s*['\"]([^'\"]*)['\"]", body)
    base = (pm.group(1) if pm else "").strip("/")
    ver = vm.group(1) if vm else "2"
    out = []
    for mm in re.finditer(r"@(Get|Post|Put|Patch|Delete)\(", text):
        sub = re.match(r"\s*['\"]([^'\"]*)['\"]", _balanced(text, mm.end() - 1))
        route = "/".join(x for x in [f"v{ver}", base, (sub.group(1).strip("/") if sub else "")] if x)
        out.append({"method": mm.group(1).upper(), "path": "/" + route, "file": path})
    return out


def web_route(path):
    m = re.match(r"^apps/(web|partner)/src/app/(.+)/(page|route)\.[tj]sx?$", path)
    if not m:
        return None
    segs = [s for s in m.group(2).split("/") if not re.match(r"^\(.*\)$", s) and not s.startswith("@")]
    return "/" + "/".join(segs)


DOMAIN_PATTERNS = [
    r"^apps/api/src/modules/([a-z0-9-]+)/",
    r"^apps/web/src/features/([a-z0-9-]+)/",
    r"^apps/web/src/app/\((?:app|admin)\)/\(([a-z0-9-]+)\)/",
    r"^apps/partner/src/features/([a-z0-9-]+)/",
    r"^packages/contracts/src/([a-z0-9-]+)/",
    r"^packages/db/src/schema/([a-z0-9-]+)/",
    r"^packages/db/src/seeds/([a-z0-9-]+)\.[tj]s$",
    r"^apps/web/messages/[a-zA-Z-]+/([a-z0-9-]+)\.json$",
]


def domains_of(paths):
    out = []
    for p in paths:
        for rx in DOMAIN_PATTERNS:
            m = re.match(rx, p)
            if m and m.group(1) not in ("common", "_registry") and m.group(1) not in out:
                out.append(m.group(1))
    return out


def load_inventory():
    path = os.path.join(P.SKILL, "..", "threadwise-feature-lookup", "scripts", "find_feature.py")
    try:
        spec = importlib.util.spec_from_file_location("find_feature", os.path.realpath(path))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        feats, _domains = mod.load_inventory()
        return {f["id"]: f for f in feats}
    except Exception:
        return {}


def tracker_active():
    rows = {}
    for f in glob.glob(os.path.join(REPO, "docs", "threadwise-port", "tracker", "*.md")):
        try:
            for m in re.finditer(r"^\| (WD-[A-Z0-9]+-\d{3}) \| ([a-z-]+) \|", open(f, encoding="utf-8").read(), re.M):
                rows[m.group(1)] = m.group(2)
        except Exception:
            pass
    return {k: v for k, v in rows.items() if v in ("in-progress", "backend-done", "frontend-done")}


def detect_features(domains, inv, base):
    branch = P.git("rev-parse", "--abbrev-ref", "HEAD").strip()
    ids = []
    for m in P.WD_ID.finditer(branch):
        ids.append((m.group(0), "branch"))
    if base:
        for m in P.WD_ID.finditer(P.git("log", f"{base}..HEAD", "--format=%s%n%b")):
            ids.append((m.group(0), "commits"))
    if not ids:
        for fid, st in tracker_active().items():
            if not domains or inv.get(fid, {}).get("domain") in domains:
                ids.append((fid, f"tracker:{st}"))
    seen, out = set(), []
    for fid, src in ids:
        if fid not in seen:
            seen.add(fid)
            out.append({"id": fid, "source": src})
    return branch, out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--files", nargs="*")
    ap.add_argument("--text", action="store_true")
    ap.add_argument("--stamp-if-trivial", action="store_true")
    a = ap.parse_args()

    scope = P.feature_scope(a.base, a.files)
    files = scope["files"]
    paths = [f["path"] for f in files]
    layers = {}
    for f in files:
        layers[f["layer"]] = layers.get(f["layer"], 0) + 1
    domains = domains_of(paths)
    inv = load_inventory()
    branch, feats = detect_features(domains, inv, scope["base"])

    routes_api, routes_web = [], []
    for p in paths:
        if p.endswith(".controller.ts"):
            routes_api += api_routes(p)
        w = web_route(p)
        if w and w not in routes_web:
            routes_web.append(w)

    reasons = []
    surface_files = [p for p in paths if not INTERNAL_ONLY.search(p)]
    if routes_api:
        reasons.append(f"{len(routes_api)} API route(s) in changed controllers")
    if routes_web:
        reasons.append(f"{len(routes_web)} web route(s)")
    if any(l in layers for l in ("web", "partner")) and surface_files:
        reasons.append("web/partner UI code changed")
    for l in ("contracts", "db", "worker", "providers"):
        if l in layers and surface_files:
            reasons.append(f"{l} changed")
    if layers.get("api") and surface_files and not routes_api:
        reasons.append("API module code changed (behavior, no new route)")
    surface = bool(surface_files) and bool(reasons)

    threadwise = {}
    for f in feats:
        e = inv.get(f["id"])
        if e:
            threadwise[f["id"]] = {"title": e["title"], "domain": e["domain"], "status": e["status"], "priority": e["priority"], "routes": e["routes"]}
    specs = []
    for d in domains:
        specs += [os.path.relpath(p, REPO) for p in sorted(glob.glob(os.path.join(REPO, "apps", "web", "e2e", d, "parity", "*.twin.mjs")))]

    stamp = P.read_stamp(scope["fingerprint"]) if scope["fingerprint"] else None
    out = {
        "repo": REPO, "branch": branch, "base": scope["base"], "fingerprint": scope["fingerprint"],
        "files": files, "layers": layers, "domains": domains, "features": feats, "threadwise": threadwise,
        "routes": {"api": routes_api, "web": routes_web},
        "has_ui": any(l in layers for l in ("web", "partner")), "has_api": any(l in layers for l in ("api", "providers", "contracts")),
        "has_worker": "worker" in layers, "has_db": "db" in layers,
        "surface": surface, "surface_reasons": reasons, "existing_specs": specs,
        "stamp": stamp or {"exists": False},
        "note": "routes/domains/features are derived with regexes and the tracker; confirm against the inventory entry",
    }
    if a.stamp_if_trivial and not surface and scope["fingerprint"]:
        P.write_stamp(scope["fingerprint"], {"status": "skipped", "note": "no comparable surface (internal/plumbing files only)", "features": [f["id"] for f in feats], "domains": domains, "files": len(files), "branch": branch})
        print(json.dumps({"stamped": "skipped", "fingerprint": scope["fingerprint"]}))
        return 0
    if a.text:
        print(f"branch {branch} vs {scope['base']}: {len(files)} feature file(s) {layers}  fingerprint {scope['fingerprint'] or '-'}")
        print(f"domains: {', '.join(domains) or '-'}   features: {', '.join(f['id'] + ' (' + f['source'] + ')' for f in feats) or 'none detected'}")
        print(f"surface: {surface} {reasons}")
        print(f"api routes: {len(routes_api)}  web routes: {routes_web or '-'}  existing twin specs: {specs or '-'}")
        print("stamp:", "yes (" + stamp["status"] + ")" if stamp else "none")
        return 0
    print(json.dumps(out, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
