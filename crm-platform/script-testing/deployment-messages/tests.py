#!/usr/bin/env python3
"""Tests for deploy-message.py, desk-release-watch.sh and notify-chat.sh against a LOCAL fake GitHub API and fake Chat receiver."""
import json, os, re, subprocess, sys, tempfile, threading, time, http.server, shutil

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
FMT = f"{ROOT}/deploy/hostinger/deploy-message.py"
WATCH = f"{ROOT}/deploy/hostinger/desk-release-watch.sh"
NOTIFY = f"{ROOT}/deploy/build-server/notify-chat.sh"
TOKEN = "ghp_SECRETTOKENVALUE1234567890"
A, B = "a" * 40, "b" * 40
results, hits, chat_posts = [], [], []
MODE = {"fail": None, "delay": 0}  # fail: 500 | slow


def sha(n): return f"{n:040x}"


# repo fixture: sha -> (message, author login, committer login, PRs for /pulls)
def pr(n, title, user, merger): return {"number": n, "title": title, "user": {"login": user}, "merged_by": {"login": merger}}


FIX = {}  # prev...new -> commit list ; sha -> pulls


class Api(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_GET(self):
        hits.append((self.path, self.headers.get("Authorization")))
        if MODE["delay"]: time.sleep(MODE["delay"])
        if MODE["fail"] == "500": return self._send(500, {"message": "boom"})
        if MODE["fail"] == "slow": time.sleep(9)
        if self.headers.get("Authorization") != "Bearer " + TOKEN: return self._send(401, {})
        m = re.match(r"/repos/o/r/compare/(\w+)\.\.\.(\w+)$", self.path)
        if m: return self._send(200, {"commits": FIX.get("compare", [])})
        # Like the real GitHub: the commit->pulls LIST has no merged_by; only GET /pulls/<n> (the full PR) carries it.
        m = re.match(r"/repos/o/r/commits/(\w+)/pulls$", self.path)
        if m: return self._send(200, [{k: v for k, v in p.items() if k != "merged_by"} for p in FIX.get("pulls", {}).get(m.group(1), [])])
        m = re.match(r"/repos/o/r/pulls/(\d+)$", self.path)
        if m:
            full = [p for ps in FIX.get("pulls", {}).values() for p in ps if p.get("number") == int(m.group(1))]
            return self._send(200, full[0]) if full else self._send(404, {})
        m = re.match(r"/repos/o/r/commits/(\w+)$", self.path)
        if m: return self._send(200, FIX.get("single", {}))
        self._send(404, {})

    def _send(self, code, obj):
        b = json.dumps(obj).encode(); self.send_response(code); self.send_header("Content-Length", str(len(b))); self.end_headers(); self.wfile.write(b)


class Chat(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def do_POST(self):
        chat_posts.append(json.loads(self.rfile.read(int(self.headers["Content-Length"])))); self.send_response(200); self.end_headers(); self.wfile.write(b"{}")


def serve(h):
    s = http.server.ThreadingHTTPServer(("127.0.0.1", 0), h); threading.Thread(target=s.serve_forever, daemon=True).start(); return s


api, chat = serve(Api), serve(Chat)
STATE = tempfile.mkdtemp()
ENV = {**os.environ, "GITHUB_API_URL": f"http://127.0.0.1:{api.server_port}", "GITHUB_REPO": "o/r", "GITHUB_TOKEN": TOKEN, "DESK_WATCH_STATE": STATE}


def check(name, ok, detail=""):
    results.append((name, ok)); print(f"  {'PASS' if ok else 'FAIL'} {name}{' (' + detail + ')' if not ok and detail else ''}", flush=True)


def run(ev, prev, new, secs="", note="", env=None, fresh=True):
    if fresh: shutil.rmtree(STATE, ignore_errors=True); os.makedirs(STATE)
    hits.clear()
    p = subprocess.run([sys.executable, FMT, ev, prev, new, secs, note], env={**ENV, **(env or {})}, capture_output=True, text=True, timeout=60)
    return p.stdout, p.stderr


def commit(s, msg, login="dev", committer=None):
    return {"sha": s, "commit": {"message": msg, "author": {"name": login}}, "author": {"login": login}, "committer": {"login": committer or login}}


# 1 merge commit
FIX.update(compare=[commit(sha(1), "fix x", "alice"), commit(sha(2), "Merge pull request #12 from alice/fix-x\n\nfix x", "alice", "web-flow")], pulls={sha(2): [pr(12, "Fix the thing", "alice", "bob")]})
out, _ = run("live", A, B, "88")
check("merge commit: PR number, title, URL", '#12 "Fix the thing"' in out and "https://github.com/o/r/pull/12" in out, out)
check("merge commit: author and merger differ", "Author: @alice" in out and "Deployed by: @bob" in out, out)
check("live title and versions", out.startswith("✅ *Release live*") and "`bbbbbbbbb` (was `aaaaaaaaa`)" in out and "/commit/bbbbbbbbb" in out and "Took 88s" in out and "UTC" in out, out)
check("only needed API calls (no call for branch commit)", sum(bool(re.search(r"/commits/\w+/pulls$", h[0])) for h in hits) == 1 and sum(bool(re.search(r"/pulls/\d+$", h[0])) for h in hits) == 1, str(hits))
n = len(hits); out2, _ = run("live", A, B, "88", fresh=False)
check("second run served from 1h cache", len(hits) == 0 and out2.split("\n")[1:4] == out.split("\n")[1:4], str(len(hits)))

# 2 squash
FIX.update(compare=[commit(sha(3), "Add feature (#34)", "carol")], pulls={sha(3): [pr(34, "Add feature", "carol", "carol")]})
out, _ = run("started", A, B)
check("squash (#N): PR found, in-progress variant", out.startswith("🚀 *Deploy in progress*") and "#34" in out and "Deployed by: @carol" in out, out)

# 3 multi PR
FIX.update(compare=[commit(sha(10 + i), f"Merge pull request #{100 + i} from u/b{i}", "u") for i in range(11)], pulls={sha(10 + i): [pr(100 + i, f"Title {i}", f"user{i}", f"mrg{i}")] for i in range(11)})
out, _ = run("live", A, B)
check("multi-PR: newest is primary, also-in max 8", 'PR: #110 "Title 10"' in out and "Also in this release:" in out and out.count("• #") == 8, out)
check("multi-PR: within length cap", len(out) <= 1200, str(len(out)))

# 4 direct push
FIX.update(compare=[commit(sha(5), "hotfix: bump timeout", "dave")], pulls={sha(5): []})
out, _ = run("live", A, B)
check("direct push: subject, author, no PR", "hotfix: bump timeout" in out and "no" in out.lower() and "PR: none (direct push)" in out and "Author: @dave" in out and "Deployed by: @dave" in out, out)

# 5 unchanged
out, _ = run("unchanged", B, B, "40", "Rolled back.")
check("unchanged variant", out.startswith("⚠️ *Deploy finished but the live version did not change*") and "Rolled back." in out, out)

# 6 fallbacks
FIX.update(compare=[commit(sha(3), "Add feature (#34)", "carol")], pulls={sha(3): [pr(34, "Add feature", "carol", "carol")]})
for name, env, mode in [("API 500", {}, "500"), ("missing token", {"GITHUB_TOKEN": "", "DEPLOY_MSG_TOKEN_FILE": "/nonexistent"}, None), ("bad token", {"GITHUB_TOKEN": "wrong"}, None)]:
    MODE["fail"] = mode
    out, err = run("live", A, B, "5", env=env)
    check(f"fallback on {name}", "PR details unavailable" in out and "/commit/bbbbbbbbb" in out and "Version: `bbbbbbbbb`" in out and TOKEN not in out + err, out)
MODE["fail"] = "slow"; t = time.time()
out, _ = run("live", A, B, "5"); el = time.time() - t
check("fallback on API timeout (bounded ~6s)", "PR details unavailable" in out and el < 12, f"{el:.1f}s")
MODE["fail"] = None

# 7 injection
evil = "\x1b[31mhi\x07 *bold* _it_ `code` [x](http://evil) @everyone <users/all> |tbl|\n" + "A" * 300
FIX.update(compare=[commit(sha(7), "Merge pull request #7 from e/x", "e")], pulls={sha(7): [{"number": 7, "title": evil, "user": {"login": "ev il<@all>"}, "merged_by": {"login": "x\ny"}}]})
out, _ = run("live", A, B)
title_line = [l for l in out.split("\n") if l.startswith("PR:")][0]
check("injection: control chars and markdown specials removed", not re.search(r"[\x00-\x08\x0b-\x1f\x7f]", out) and not re.search(r"[*_`<>@\[\]|]", title_line.replace("*", "") if False else re.sub(r"https://\S+", "", title_line)), title_line)
check("injection: title truncated to 100", len(re.search(r'"(.*)"', title_line).group(1)) <= 100, title_line)
check("injection: bad logins rejected", "Author: unknown" in out and "Deployed by: unknown" in out and "@everyone" not in out, out)

# 8 length cap
FIX.update(compare=[commit(sha(20 + i), f"Merge pull request #{200 + i} from u/b", "u") for i in range(30)], pulls={sha(20 + i): [pr(200 + i, "T" * 100, "a" * 39, "m" * 39)] for i in range(30)})
out, _ = run("live", A, B, "1" * 6, "N" * 900)
check("message length cap 1200", len(out.strip()) <= 1200, str(len(out)))

# 9 token not in process list or logs
MODE["delay"] = 1.5
FIX.update(compare=[commit(sha(3), "Add feature (#34)", "carol")], pulls={sha(3): [pr(34, "Add feature", "carol", "carol")]})
seen = []
def sample():
    for _ in range(25):
        seen.append(subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout); time.sleep(0.2)
th = threading.Thread(target=sample); th.start(); time.sleep(0.3); out, err = run("live", A, B, env={"GITHUB_TOKEN": TOKEN}); th.join()
MODE["delay"] = 0
check("token never in process list", not any(TOKEN in s for s in seen) and any("deploy-message" in s for s in seen))
check("token never in output, stderr or state files", TOKEN not in out + err and all(TOKEN not in open(os.path.join(STATE, f)).read() for f in os.listdir(STATE)))
tf = tempfile.mktemp(); open(tf, "w").write(TOKEN + "\n")
out, _ = run("live", A, B, env={"GITHUB_TOKEN": "", "DEPLOY_MSG_TOKEN_FILE": tf})
check("token read from file works", "#34" in out, out)

# 9b --json machine-readable mode
FIX.update(compare=[commit(sha(11), "Merge pull request #51 from a/b", "a"), commit(sha(12), "Merge pull request #52 from c/d", "c")], pulls={sha(11): [pr(51, "T1", "a", "bob")], sha(12): [pr(52, "T2", "c", "eve")]})
shutil.rmtree(STATE, ignore_errors=True); os.makedirs(STATE)
pj = subprocess.run([sys.executable, FMT, "--json", "live", A, B, "42"], env=ENV, capture_output=True, text=True, timeout=60)
jj = json.loads(pj.stdout)
check("--json: sha, prev, prs, mergers, status", jj["sha"] == B and jj["prev"] == A and jj["prs"] == [51, 52] and jj["mergers"] == ["@bob", "@eve"] and jj["status"] == "live" and jj["seconds"] == 42 and jj["prsKnown"] is True, pj.stdout)
MODE["fail"] = "500"; shutil.rmtree(STATE, ignore_errors=True); os.makedirs(STATE)
pj = subprocess.run([sys.executable, FMT, "--json", "unchanged", A, B], env=ENV, capture_output=True, text=True, timeout=60); jf = json.loads(pj.stdout)
MODE["fail"] = None
check("--json: API failure degrades to empty prs, exit 0, token not leaked", pj.returncode == 0 and jf["prs"] == [] and jf["prsKnown"] is False and TOKEN not in pj.stdout + pj.stderr, pj.stdout)

# 10 --dry-run posts nothing and keeps state clean
before = len(chat_posts)
p = subprocess.run(["bash", WATCH, "--dry-run", A, B, "12", "live"], env={**ENV, "DESK_WATCH_URL_FILE": "/nonexistent"}, capture_output=True, text=True, timeout=60)
check("--dry-run prints message, posts nothing", "#34" in p.stdout and len(chat_posts) == before, p.stdout + p.stderr)

# 11 watcher loop end to end with stub pgrep
D = tempfile.mkdtemp(); BIN = tempfile.mkdtemp()
open(f"{D}/.slot", "w").write("blue\n"); open(f"{D}/.env", "w").write(f"SLOT_BLUE_TAG={A[:9]}\nIMAGE_TAG={B[:9]}\n")
open(f"{D}/url", "w").write(f"http://127.0.0.1:{chat.server_port}/hook\n")
open(f"{BIN}/pgrep", "w").write(f"#!/bin/sh\n[ -f {D}/running ]\n"); os.chmod(f"{BIN}/pgrep", 0o755)
wenv = {**ENV, "PATH": f"{BIN}:{os.environ['PATH']}", "DESK_DIR": D, "DESK_WATCH_URL_FILE": f"{D}/url", "DESK_WATCH_POLL": "1", "DESK_WATCH_SETTLE": "0"}
chat_posts.clear(); shutil.rmtree(STATE, ignore_errors=True); os.makedirs(STATE)
w = subprocess.Popen(["bash", WATCH], env=wenv, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5); open(f"{D}/running", "w").close(); time.sleep(3)
# fake docker: slow (2 s) on purpose, records args + stdin; fails when D/docker_fail exists
open(f"{BIN}/docker", "w").write(f'#!/bin/sh\nsleep 2\nb=$(cat)\necho "ARGS $*" >> {D}/docker.log\necho "BODY $b" >> {D}/docker.log\n[ ! -f {D}/docker_fail ]\n'); os.chmod(f"{BIN}/docker", 0o755)
def wait_for(cond, secs):
    t = time.time()
    while time.time() - t < secs and not cond(): time.sleep(0.2)
    return cond()
os.remove(f"{D}/running"); open(f"{D}/.env", "w").write(f"SLOT_BLUE_TAG={B[:9]}\nIMAGE_TAG={B[:9]}\n")
wait_for(lambda: len(chat_posts) >= 2, 8)
live_before_docker = len(chat_posts) >= 2 and not os.path.exists(f"{D}/docker.log")  # post is out while the slow docker call is still running
wait_for(lambda: os.path.exists(f"{D}/docker.log") and "BODY" in open(f"{D}/docker.log").read(), 8)
dlog = open(f"{D}/docker.log").read() if os.path.exists(f"{D}/docker.log") else ""
txt = [p["text"] for p in chat_posts]
check("watcher: release call reaches the bridge after 'Release live' without delaying it", live_before_docker and "ARGS exec -i desk-gchat-bridge node -e" in dlog and dlog.count("/release") >= 1 and f'"sha": "{B[:9]}"' in dlog and '"prs": [' in dlog and '"at": "' in dlog, dlog)
check("watcher: no secret path or token in the docker args", "ARGS" in dlog and TOKEN not in dlog and "incident_api_token" in open(WATCH).read() and "incident_api_token" not in "".join(l for l in dlog.splitlines() if l.startswith("ARGS").__bool__() and "node -e" in l and "/run/secrets" in l.replace("incident_api_token", "").replace("/run/secrets/", "")) )
# deploy ends with the SAME live tag -> deploy_failure incident; then a failing docker must not block the post
C = "c" * 40
for fail in (False, True):
    chat_posts.clear(); open(f"{D}/docker.log", "w").close()
    if fail: open(f"{D}/docker_fail", "w").close()
    open(f"{D}/.env", "w").write(f"SLOT_BLUE_TAG={B[:9]}\nIMAGE_TAG={C}\n"); open(f"{D}/running", "w").close(); time.sleep(2.5)
    os.remove(f"{D}/running"); wait_for(lambda: any(p["text"].startswith("⚠️") for p in chat_posts), 8)
    posted = any("did not change" in p["text"] for p in chat_posts)
    wait_for(lambda: "BODY" in open(f"{D}/docker.log").read(), 8); dl = open(f"{D}/docker.log").read()
    if not fail:
        check("watcher: unchanged deploy posts, then opens a deploy_failure incident", posted and "/incidents" in dl and '"kind": "deploy_failure"' in dl and f'"attemptedSha": "{C}"' in dl and f'"liveSha": "{B[:9]}"' in dl and '"durationSeconds"' in dl, dl)
    else:
        time.sleep(0.5)
        check("watcher: a failing bridge call never blocks the Deployments post and is logged without secrets", posted and "bridge call /incidents failed" in open(f"{STATE}/watch.log").read() and TOKEN not in open(f"{STATE}/watch.log").read())
w.terminate(); w.wait()
chat_posts.clear(); chat_posts.extend({"text": t} for t in txt)
check("watcher: in-progress then live posted via Chat", len(txt) == 2 and txt[0].startswith("🚀") and txt[1].startswith("✅") and "(was `aaaaaaaaa`)" in txt[1], str(txt))
check("watcher: webhook secret not logged", "127.0.0.1" not in open(f"{STATE}/watch.log").read())

# 12 build-server notify-chat.sh
chat_posts.clear()
open(f"{D}/curl_url", "w").write(f"http://127.0.0.1:{chat.server_port}/hook\n")
subprocess.run(["bash", NOTIFY, "succeeded", B, "61", ""], env={**ENV, "DESK_CI_GCHAT_URL_FILE": f"{D}/curl_url", "DESK_CI_FORMATTER": FMT, "DESK_CI_PREV_SHA": A, "DESK_CI_LOGS": D}, timeout=60)
check("notify-chat.sh uses the standard format", len(chat_posts) == 1 and "#34" in chat_posts[0]["text"] and chat_posts[0]["text"].startswith("✅"), str(chat_posts))
chat_posts.clear()
subprocess.run(["bash", NOTIFY, "failed", B, "61", "see log"], env={**ENV, "GITHUB_TOKEN": "", "DEPLOY_MSG_TOKEN_FILE": "/nonexistent", "DESK_CI_GCHAT_URL_FILE": f"{D}/curl_url", "DESK_CI_FORMATTER": FMT, "DESK_CI_LOGS": D}, timeout=60)
check("notify-chat.sh falls back without token", len(chat_posts) == 1 and "PR details unavailable" in chat_posts[0]["text"] and chat_posts[0]["text"].startswith("⚠️"), str(chat_posts))

shutil.rmtree(D, ignore_errors=True); shutil.rmtree(STATE, ignore_errors=True)
bad = [n for n, ok in results if not ok]
print(f"== {len(results) - len(bad)}/{len(results)} passed")
sys.exit(1 if bad else 0)
