"""Shared helpers for the parity scripts: what changed, which feature it belongs to, and whether a parity run
already covers that exact state. Standard library only (the Stop hook must start in milliseconds).

State lives in the git dir (<git-dir>/wadesk-parity/): local to each clone/worktree, never committed.
Override the repo with PARITY_REPO_ROOT (used by the tests)."""
import hashlib
import json
import os
import re
import subprocess
import time

HERE = os.path.dirname(os.path.realpath(__file__))
SKILL = os.path.dirname(HERE)


def repo_root():
    env = os.environ.get("PARITY_REPO_ROOT")
    if env:
        return os.path.realpath(env)
    # .../<repo>/.claude/skills/wadesk-playwright-parity/scripts
    return os.path.realpath(os.path.join(HERE, "..", "..", "..", ".."))


REPO = repo_root()

# Files whose change means "a feature (or a piece of one) was built or changed".
FEATURE_PATTERNS = [
    r"^apps/api/src/modules/.+\.[tj]s$",
    r"^apps/api/src/infra/providers/.+\.[tj]s$",
    r"^apps/web/src/.+",
    r"^apps/web/messages/.+",
    r"^apps/partner/src/.+",
    r"^packages/contracts/src/.+\.[tj]s$",
    r"^packages/db/migrations/.+\.sql$",
    r"^packages/db/src/(schema|seeds)/.+\.[tj]s$",
]
EXCLUDE_PATTERNS = [
    r"\.(spec|test)\.[tj]sx?$",
    r"(^|/)__tests__/",
    r"^apps/web/e2e/",
    r"\.stories\.[tj]sx?$",
    r"\.md$",
    r"\.tsbuildinfo$",
]
_FEATURE = [re.compile(p) for p in FEATURE_PATTERNS]
_EXCLUDE = [re.compile(p) for p in EXCLUDE_PATTERNS]

WD_ID = re.compile(r"WD-[A-Z0-9]+-\d{3}")


def git(*args, check=False):
    try:
        out = subprocess.run(["git", "-C", REPO, *args], capture_output=True, text=True, timeout=20)
    except Exception:
        return ""
    if check and out.returncode != 0:
        raise RuntimeError(out.stderr.strip())
    return out.stdout if out.returncode == 0 else ""


def git_dir():
    d = git("rev-parse", "--git-dir").strip()
    if not d:
        return None
    return d if os.path.isabs(d) else os.path.join(REPO, d)


def state_dir(*parts):
    base = git_dir()
    if not base:
        base = os.path.join(os.environ.get("TMPDIR", "/tmp"), "wadesk-parity-state")
    p = os.path.join(base, "wadesk-parity", *parts)
    os.makedirs(p, exist_ok=True)
    return p


def base_ref(explicit=None):
    if explicit:
        return explicit
    for ref in ("origin/main", "main"):
        if git("rev-parse", "--verify", "-q", ref).strip():
            return ref
    return None


def is_feature_file(path):
    return any(r.search(path) for r in _FEATURE) and not any(r.search(path) for r in _EXCLUDE)


def layer_of(path):
    if path.startswith("apps/api/src/modules/"):
        return "worker" if re.search(r"\.(processor|subscriber|worker\.module|queues)\.[tj]s$", path) else "api"
    if path.startswith("apps/api/src/infra/providers/"):
        return "providers"
    if path.startswith("apps/partner/"):
        return "partner"
    if path.startswith("apps/web/"):
        return "web"
    if path.startswith("packages/contracts/"):
        return "contracts"
    if path.startswith("packages/db/"):
        return "db"
    return "other"


def changed_files(base=None):
    """(path -> state) for everything differing from base: committed on the branch, staged/unstaged, untracked."""
    base = base_ref(base)
    out = {}
    if base:
        for line in git("diff", "--name-status", f"{base}...HEAD").splitlines():
            parts = line.split("\t")
            if len(parts) >= 2:
                out[parts[-1]] = "deleted" if parts[0].startswith("D") else "committed"
    for line in git("diff", "--name-status", "HEAD").splitlines():
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


def feature_scope(base=None, files=None):
    """Changed files that count as feature work, with a content fingerprint of that exact state."""
    states = changed_files(base) if files is None else {f: "given" for f in files}
    feat = {p: s for p, s in states.items() if is_feature_file(p)}
    hashes = file_hashes(sorted(feat))
    fp = hashlib.sha1("\n".join(f"{p}\0{hashes[p]}" for p in sorted(feat)).encode()).hexdigest()[:12] if feat else ""
    return {"files": [{"path": p, "layer": layer_of(p), "state": feat[p]} for p in sorted(feat)], "fingerprint": fp, "base": base_ref(base)}


# ---- stamps ---------------------------------------------------------------------------------------------------------
def stamp_path(fp):
    return os.path.join(state_dir("stamps"), f"{fp}.json")


def read_stamp(fp):
    try:
        with open(stamp_path(fp), encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def write_stamp(fp, data):
    data = {**data, "fingerprint": fp, "at": time.strftime("%Y-%m-%dT%H:%M:%S%z")}
    with open(stamp_path(fp), "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    return data


def gate_disabled():
    if os.environ.get("PARITY_GATE", "").lower() in ("off", "0", "false", "skip", "no"):
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
