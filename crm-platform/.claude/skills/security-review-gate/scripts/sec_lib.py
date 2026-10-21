"""Helpers for the security-review gate: which changed files need a security review, and whether a review stamp
covers that exact state. Standard library only (the Stop hook must start in milliseconds). State lives in
<git-dir>/threadwise-security/ (per clone/worktree, never committed)."""
import hashlib
import json
import os
import re
import subprocess
import sys
import time

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.realpath(__file__))
REPO = os.path.realpath(os.path.join(HERE, "..", "..", "..", ".."))


def git(*args):
    try:
        out = subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, timeout=20)
    except Exception:
        return ""
    return out.stdout if out.returncode == 0 else ""


def git_dir():
    d = git("rev-parse", "--git-dir").strip()
    if not d:
        return None
    return d if os.path.isabs(d) else os.path.join(REPO, d)


def base_ref(explicit=None):
    if explicit:
        return explicit
    for ref in ("origin/main", "main"):
        if git("rev-parse", "--verify", "-q", ref).strip():
            return ref
    return None


def changed_files(base=None):
    """(path -> state) for everything differing from base: committed on the branch, staged/unstaged, untracked."""
    base = base_ref(base)
    out = {}
    if base:
        for line in git("diff", "--relative", "--name-status", f"{base}...HEAD").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                out[parts[-1]] = "deleted" if parts[0].startswith("D") else "committed"
    for line in git("diff", "--relative", "--name-status", "HEAD").splitlines():
        parts = line.split("\t")
        if len(parts) >= 2:
            out[parts[-1]] = "deleted" if parts[0].startswith("D") else "modified"
    for p in git("ls-files", "-o", "--exclude-standard").splitlines():
        if p:
            out[p] = "untracked"
    return out


def file_hashes(paths):
    existing = [p for p in paths if os.path.isfile(os.path.join(REPO, p))]
    res = {}
    if existing:
        try:
            r = subprocess.run(["git", "-C", REPO, "hash-object", "--", *existing], capture_output=True, text=True, timeout=30)
            hs = r.stdout.split()
            if len(hs) == len(existing):
                res = dict(zip(existing, hs))
        except Exception:
            pass
    for p in paths:
        res.setdefault(p, "deleted")
    return res

# Code that can carry a vulnerability: every app and package source, migrations, worker jobs, CI, dependency manifests.
SCOPE_PATTERNS = [
    r"^apps/[^/]+/src/.+\.[cm]?[tj]sx?$",
    r"^apps/mobile/(app|src)/.+\.[tj]sx?$",
    r"^packages/[^/]+/(src|migrations)/.+\.(?:[cm]?[tj]sx?|sql)$",
    r"^tools/.+\.(?:[cm]?[tj]s|py|sh)$",
    r"^\.github/workflows/.+\.ya?ml$",
    r"(^|/)package\.json$",
    r"(^|/)pnpm-lock\.yaml$",
    r"(^|/)Dockerfile[^/]*$",
]
EXCLUDE_PATTERNS = [
    r"\.(spec|test)\.[tj]sx?$",
    r"(^|/)__tests__/",
    r"(^|/)e2e/",
    r"\.stories\.[tj]sx?$",
    r"^apps/web/messages/",
    r"/help/.+\.md$",
]
_SCOPE = [re.compile(p) for p in SCOPE_PATTERNS]
_EXCLUDE = [re.compile(p) for p in EXCLUDE_PATTERNS]


def in_scope(path):
    return any(r.search(path) for r in _SCOPE) and not any(r.search(path) for r in _EXCLUDE)


def scope(base=None):
    states = changed_files(base)
    files = {p: s for p, s in states.items() if in_scope(p)}
    hashes = file_hashes(sorted(files))
    fp = hashlib.sha1("\n".join(f"{p}\0{hashes[p]}" for p in sorted(files)).encode()).hexdigest()[:12] if files else ""
    return {"files": sorted(files), "fingerprint": fp}


def state_dir(*parts):
    base = git_dir() or os.path.join(os.environ.get("TMPDIR", "/tmp"), "threadwise-security-state")
    p = os.path.join(base, "threadwise-security", *parts)
    os.makedirs(p, exist_ok=True)
    return p


def read_stamp(fp):
    try:
        with open(os.path.join(state_dir("stamps"), f"{fp}.json"), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_stamp(fp, data):
    data = {**data, "fingerprint": fp, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    with open(os.path.join(state_dir("stamps"), f"{fp}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return data


def gate_disabled():
    if os.environ.get("SECURITY_GATE", "").lower() in ("off", "0", "false", "skip", "no"):
        return True
    try:
        return os.path.exists(os.path.join(state_dir(), "disabled"))
    except Exception:
        return False


def block_count(fp):
    try:
        with open(os.path.join(state_dir("blocks"), fp), encoding="utf-8") as f:
            return int(f.read().strip() or 0)
    except Exception:
        return 0


def bump_block(fp):
    n = block_count(fp) + 1
    with open(os.path.join(state_dir("blocks"), fp), "w", encoding="utf-8") as f:
        f.write(str(n))
    return n
