"""Helpers for the security-review gate: which changed files need a security review, and whether a review stamp
covers that exact state. Reuses the git helpers of the parity scripts. Standard library only (the Stop hook must
start in milliseconds). State lives in <git-dir>/threadwise-security/ (per clone/worktree, never committed)."""
import hashlib
import json
import os
import re
import sys
import time

sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "threadwise-playwright-parity", "scripts"))
import parity_lib as P  # noqa: E402

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
    states = P.changed_files(base)
    files = {p: s for p, s in states.items() if in_scope(p)}
    hashes = P.file_hashes(sorted(files))
    fp = hashlib.sha1("\n".join(f"{p}\0{hashes[p]}" for p in sorted(files)).encode()).hexdigest()[:12] if files else ""
    return {"files": sorted(files), "fingerprint": fp}


def state_dir(*parts):
    base = P.git_dir() or os.path.join(os.environ.get("TMPDIR", "/tmp"), "threadwise-security-state")
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
