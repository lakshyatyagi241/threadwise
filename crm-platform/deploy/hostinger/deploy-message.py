#!/usr/bin/env python3
"""Builds the standard deployment message (PR number, commit, author, who deployed) and prints it to stdout.

  deploy-message.py <event> <prev_sha> <new_sha> [seconds] [note]
  deploy-message.py --json <event> <prev_sha> <new_sha> [seconds]   machine-readable: {sha, prev, prs, mergers, status, seconds, prsKnown}
  event: started|progress (in progress), live|succeeded, unchanged|failed, skipped

Reads GitHub (read-only token from env GITHUB_TOKEN or file DEPLOY_MSG_TOKEN_FILE) to find the PRs between the two shas.
Every GitHub string is untrusted and is sanitised. Any failure degrades to the plain "Version + commit link" message with the
note "PR details unavailable". Never prints or logs the token; stdlib only. Always exits 0.
"""
import json, os, re, sys, time, unicodedata, urllib.request

REPO = os.environ.get("GITHUB_REPO", "lakshyatyagi241/threadwise")
API = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")
TOKEN_FILE = os.environ.get("DEPLOY_MSG_TOKEN_FILE", "/opt/desk/secrets/github_read_token")
STATE = os.environ.get("DESK_WATCH_STATE", "/var/lib/desk-release-watch")
WEB = os.environ.get("DESK_COMMIT_URL_BASE", f"https://github.com/{REPO}")
TIMEOUT, MAXBYTES, TTL, MAXLEN, DEADLINE = 6, 2_000_000, 3600, 1200, 25
EVENTS = {
    "started": ("🚀", "Deploy in progress"), "progress": ("🚀", "Deploy in progress"),
    "live": ("✅", "Release live"), "succeeded": ("✅", "Release live"),
    "unchanged": ("⚠️", "Deploy finished but the live version did not change"),
    "failed": ("⚠️", "Release failed or rolled back"), "skipped": ("⚠️", "Release skipped"),
}
_t0 = time.time()
# DB-driven events: the head line is the note (built by the watcher); "stuck" builds the head from the minutes in `seconds`.
HEADLINE = {"dbfailed": "❌", "stuck": "⚠️"}


def clean(s, n=100):
    """Untrusted text: drop control chars, markdown/mention specials; truncate."""
    s = "".join(c for c in str(s or "") if unicodedata.category(c)[0] != "C")
    s = re.sub(r"[*_~`\[\]<>@|\\]", "", s).strip()
    return s[: n - 1] + "…" if len(s) > n else s


def login(s):
    s = str(s or "")
    return s if re.fullmatch(r"[A-Za-z0-9-]{1,39}", s) else None


def who(u):
    return "@" + l if (l := login((u or {}).get("login"))) else "unknown"


def sha_ok(s):
    return bool(re.fullmatch(r"[0-9a-f]{7,40}", s or ""))


def token():
    t = os.environ.get("GITHUB_TOKEN", "").strip()
    if not t:
        try:
            t = open(TOKEN_FILE).read().strip()
        except OSError:
            pass
    return t


def get(path):
    """GET with cache (1h, by path), 6 s timeout, size cap and an overall deadline. Raises on any failure."""
    cf = os.path.join(STATE, "cache-" + re.sub(r"[^A-Za-z0-9.]", "_", path)[-150:] + ".json")
    try:
        if time.time() - os.path.getmtime(cf) < TTL:
            return json.load(open(cf))
    except (OSError, ValueError):
        pass
    t = token()
    if not t:
        raise RuntimeError("no token")
    if time.time() - _t0 > DEADLINE:
        raise RuntimeError("deadline")
    req = urllib.request.Request(API + path, headers={"Authorization": "Bearer " + t, "Accept": "application/vnd.github+json", "User-Agent": "desk-release-watch"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        raw = r.read(MAXBYTES + 1)
    if len(raw) > MAXBYTES:
        raise RuntimeError("too big")
    data = json.loads(raw)
    try:
        os.makedirs(STATE, exist_ok=True)
        with open(cf, "w") as f:
            json.dump(data, f)
    except OSError:
        pass
    return data


def prs_between(prev, new):
    """-> list of dicts (oldest first): number,title,author,merger ; or [] + direct commit info. Raises if the API is unusable."""
    commits = get(f"/repos/{REPO}/compare/{prev}...{new}").get("commits", []) if sha_ok(prev) and prev != new else [get(f"/repos/{REPO}/commits/{new}")]
    prs, seen, direct = [], set(), None
    for i, c in enumerate(commits[-40:]):
        msg = (c.get("commit", {}).get("message") or "").split("\n")[0]
        m = re.match(r"Merge pull request #(\d+) from", msg) or re.search(r"\(#(\d+)\)\s*$", msg)
        last = i == len(commits[-40:]) - 1
        if not m and not last:
            continue  # commits inside a merged branch; the merge commit carries the PR
        sha = c.get("sha", "")
        if not sha_ok(sha):
            continue
        found = get(f"/repos/{REPO}/commits/{sha}/pulls")
        if not found and last and not m:
            direct = {"subject": clean(msg), "author": who(c.get("author")) if c.get("author") else "@" + (login((c.get("commit", {}).get("author") or {}).get("name")) or "unknown"), "committer": who(c.get("committer")) if c.get("committer") else None}
        for p in found if isinstance(found, list) else []:
            n = p.get("number")
            if isinstance(n, int) and n not in seen:
                seen.add(n)
                # GitHub's commit->pulls list has no merged_by; the PR's own record does. One extra read per PR (the list is already capped).
                full = p if p.get("merged_by") else (get(f"/repos/{REPO}/pulls/{n}") or {})
                prs.append({"n": n, "title": clean(p.get("title")), "author": who(p.get("user")), "merger": who(full.get("merged_by") or p.get("merged_by"))})
    return prs, direct


def build(ev, prev, new, secs, note):
    icon, title = EVENTS.get(ev, ("ℹ️", "Release " + clean(ev, 30)))
    if ev == "dbfailed":  # note = "❌ Release failed at step X: error"; shown as the head line, not repeated below
        icon, title, note = "", clean(note, 260), ""
    elif ev == "stuck":
        icon, title = "⚠️", f"Build did not finish for {(new or '')[:9]} (stuck at build for {secs} min). The release was not shipped."
        secs = ""
    new, prev = (new or "")[:9], (prev or "")[:9]
    head = [f"{icon} *{title}*".strip()]
    ver = f"Version: `{new or 'unknown'}`" + (f" (was `{prev}`)" if prev else "")
    link = f"{WEB}/commit/{new}" if sha_ok(new) else ""
    tail = []
    if secs and str(secs).isdigit() and int(secs) > 0:
        tail.append(f"Took {secs}s")
    tail.append(time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime()))
    plain = head + [ver + (f" {link}" if link else "")]
    if note:
        plain.append(clean(note, 200))
    try:
        if not sha_ok(new):
            raise RuntimeError("no sha")
        prs, direct = prs_between(prev, new)
    except Exception as e:  # never log the token; only the error class
        sys.stderr.write(f"deploy-message: github lookup failed ({type(e).__name__})\n")
        return "\n".join(plain + ["PR details unavailable"] + [" · ".join(tail)])[:MAXLEN]
    lines = head + [ver + (f" {link}" if link else "")]
    if prs:
        p = prs[-1]
        lines += [f'PR: #{p["n"]} "{p["title"]}" {WEB}/pull/{p["n"]}', f'Author: {p["author"]}', f'Deployed by: {p["merger"]}']
        extra = prs[:-1][::-1]
        if extra:
            lines.append("Also in this release:")
            for q in extra[:8]:
                row = f'• #{q["n"]} "{q["title"]}" {q["author"]}'
                if len("\n".join(lines + [row, " · ".join(tail)])) + 40 > MAXLEN:
                    lines.append("• …and more")
                    break
                lines.append(row)
    else:
        d = direct or {"subject": "unknown", "author": "unknown", "committer": None}
        lines += [f'Commit: "{d["subject"]}"', "PR: none (direct push)", f'Author: {d["author"]}', f'Deployed by: {d["committer"] or d["author"]}']
    if note:
        lines.append(clean(note, 200))
    lines.append(" · ".join(tail))
    return "\n".join(lines)[:MAXLEN]


def group(shas, mins):
    """--group a,b,c <minutes>: ONE message for several stuck builds (cap 8 listed)."""
    shas = [x for x in shas.replace(",", " ").split() if sha_ok(x)]
    nums = []
    for x in shas[:8]:
        try:
            ps, _ = prs_between("", x)
            nums.append("#" + str(ps[-1]["n"]) if ps else x[:7])
        except Exception:
            nums.append(x[:7])
    more = f" (+{len(shas) - 8} more)" if len(shas) > 8 else ""
    return f"⚠️ *{len(shas)} builds are stuck*: {' '.join(nums)}{more}\nNone of them was shipped (stuck at build for up to {mins} min).\n" + time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime())


def machine(ev, prev, new, secs):
    """--json: {sha, prev, prs:[numbers], mergers:[logins], status, seconds, prsKnown}; same lookup and caps as the chat message. Never raises."""
    out = {"sha": new, "prev": prev, "prs": [], "mergers": [], "status": ev, "seconds": int(secs) if str(secs).isdigit() else 0, "prsKnown": False}
    try:
        if sha_ok(new):
            prs, _ = prs_between(prev, new)
            out.update(prs=[p["n"] for p in prs][:50], mergers=sorted({p["merger"] for p in prs if p["merger"] != "unknown"})[:20], prsKnown=True)
    except Exception as e:
        sys.stderr.write(f"deploy-message: github lookup failed ({type(e).__name__})\n")
    return json.dumps(out)


if __name__ == "__main__":
    if sys.argv[1:2] == ["--json"]:
        j = sys.argv[2:] + [""] * 5
        print(machine(j[0], j[1], j[2], j[3]))
        sys.exit(0)
    if sys.argv[1:2] == ["--group"]:
        g = sys.argv[2:] + [""] * 3
        print(group(g[0], g[1]))
        sys.exit(0)
    a = sys.argv[1:] + [""] * 5
    try:
        print(build(a[0], a[1], a[2], a[3], a[4]))
    except Exception:
        print(f"{EVENTS.get(a[0], ('ℹ️', 'Release'))[0]} *{EVENTS.get(a[0], ('', 'Release ' + clean(a[0], 20)))[1]}* `{clean(a[2], 9)}` PR details unavailable")
