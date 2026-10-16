#!/usr/bin/env python3
"""GitHub push webhook for the build server (see README.md in this folder).

Accepts `POST /hooks/github`, checks GitHub's HMAC signature, and when the push is to the deploy branch of the deploy repo starts
`deploy-main.sh`. The script serialises itself (flock) and always builds the CURRENT tip of the branch, so the payload is only a
trigger: nothing from it reaches a shell, a path or a command line.
"""
import hashlib
import hmac
import json
import os
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SECRET_FILE = os.environ.get("DESK_CI_SECRET_FILE", "/etc/desk-ci/webhook-secret")
BRANCH_REF = os.environ.get("DESK_CI_REF", "refs/heads/main")
REPO = os.environ.get("DESK_CI_REPO", "lakshyatyagi241/threadwise")
DEPLOY = os.environ.get("DESK_CI_DEPLOY", "/opt/desk-ci/deploy-main.sh")
BIND = os.environ.get("DESK_CI_BIND", "172.17.0.1")
PORT = int(os.environ.get("DESK_CI_PORT", "9099"))
PATH = "/hooks/github"
MAX_BODY = 2_000_000


def signature_ok(secret: bytes, body: bytes, header) -> bool:
    """True when `header` is `sha256=<hex>` of the body under `secret` (constant-time compare)."""
    if not secret or not header or not header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header)


def should_deploy(event: str, payload: dict):
    """(deploy?, reason). Only a non-deleting push to the deploy branch of the deploy repo counts."""
    if event == "ping":
        return False, "pong"
    if event != "push":
        return False, f"ignored event {event}"
    if payload.get("ref") != BRANCH_REF:
        return False, f"ignored ref {payload.get('ref')}"
    if (payload.get("repository") or {}).get("full_name") != REPO:
        return False, "ignored repository"
    if payload.get("deleted"):
        return False, "branch deleted"
    return True, "push to the deploy branch"


class Handler(BaseHTTPRequestHandler):
    server_version = "desk-ci"

    def _reply(self, code: int, text: str) -> None:
        data = (text + "\n").encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):  # health probe for the proxy
        self._reply(200, "ok") if self.path == "/hooks/health" else self._reply(404, "not found")

    def do_POST(self):
        if self.path != PATH:
            return self._reply(404, "not found")
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > MAX_BODY:
            return self._reply(413, "bad size")
        body = self.rfile.read(length)
        try:
            with open(SECRET_FILE, "rb") as f:
                secret = f.read().strip()
        except OSError:
            return self._reply(500, "not configured")
        if not signature_ok(secret, body, self.headers.get("X-Hub-Signature-256")):
            return self._reply(401, "bad signature")
        try:
            payload = json.loads(body)
        except ValueError:
            return self._reply(400, "bad json")
        deploy, why = should_deploy(self.headers.get("X-GitHub-Event", ""), payload)
        if not deploy:
            return self._reply(200, why)
        # detached: the request returns at once; the script logs to /var/log/desk-ci
        child = subprocess.Popen([DEPLOY], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL, start_new_session=True)
        threading.Thread(target=child.wait, daemon=True).start()  # reap it when it ends
        return self._reply(202, "deploy started")

    def log_message(self, fmt, *args):
        sys.stderr.write("%s %s\n" % (self.address_string(), fmt % args))


def selftest() -> None:
    body = b'{"ref":"refs/heads/main"}'
    good = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert signature_ok(b"s3cret", body, good)
    assert not signature_ok(b"s3cret", body, good[:-1] + ("0" if good[-1] != "0" else "1"))
    assert not signature_ok(b"s3cret", body, None) and not signature_ok(b"s3cret", body, "sha1=abc")
    assert not signature_ok(b"", body, good), "an empty secret must never validate"
    main = {"ref": BRANCH_REF, "repository": {"full_name": REPO}}
    assert should_deploy("push", main)[0]
    assert not should_deploy("push", {**main, "ref": "refs/heads/feature"})[0]
    assert not should_deploy("push", {**main, "repository": {"full_name": "someone/else"}})[0]
    assert not should_deploy("push", {**main, "deleted": True})[0]
    assert not should_deploy("ping", main)[0] and not should_deploy("issues", main)[0]
    print("webhook selftest ok")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        ThreadingHTTPServer((BIND, PORT), Handler).serve_forever()
