#!/usr/bin/env python3
"""Record (and read) that a parity run covers the current feature state. The Stop hook trusts these stamps.

  stamp.py status                          fingerprint of the current state and whether it is stamped
  stamp.py write --status STATUS [...]     STATUS: clean | fixed | open-defects | blocked-env | skipped
        --report PATH   --features TW-X-001 TW-X-002   --domains a b   --defects N   --note TEXT
        --user-approved "words the user used"     required for `skipped` when the change HAS a comparable surface
  stamp.py list                            recent stamps of this clone
  stamp.py disable | enable                switch the Stop-hook gate off/on for this clone (user decision only)

Statuses mean: clean = no defects; fixed = defects found and fixed, re-run clean; open-defects = defects remain after the
fix rounds (reported to the user); blocked-env = the comparison could not run (say why in --note); skipped = no
comparable surface, or the user said to skip.
"""
import argparse
import glob
import json
import os
import subprocess
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo (also covers the sibling skill modules we import)

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import parity_lib as P  # noqa: E402

STATUSES = ["clean", "fixed", "open-defects", "blocked-env", "skipped"]


def current():
    scope = P.feature_scope()
    return scope, P.read_stamp(scope["fingerprint"]) if scope["fingerprint"] else None


def cmd_status(_a):
    scope, st = current()
    if not scope["files"]:
        print("no feature files differ from the base: nothing to compare")
        return 0
    print(json.dumps({"fingerprint": scope["fingerprint"], "files": len(scope["files"]), "stamp": st or None}, indent=2))
    return 0 if st else 1


def cmd_write(a):
    scope, _ = current()
    if not scope["files"]:
        print("no feature files differ from the base: nothing to stamp", file=sys.stderr)
        return 0
    if a.status == "skipped" and not a.user_approved:
        here = os.path.dirname(os.path.realpath(__file__))
        out = subprocess.run([sys.executable, os.path.join(here, "detect_scope.py")], capture_output=True, text=True)
        try:
            surface = json.loads(out.stdout).get("surface", True)
        except Exception:
            surface = True
        if surface:
            print("refused: this change has a comparable surface (routes/UI/contracts/db). A skip needs the user's explicit "
                  "words: --user-approved \"<what they said>\". Otherwise run the parity check.", file=sys.stderr)
            return 3
    data = {"status": a.status, "report": a.report, "features": a.features or [], "domains": a.domains or [], "defects": a.defects,
            "note": a.note, "files": len(scope["files"]), "branch": P.git("rev-parse", "--abbrev-ref", "HEAD").strip()}
    if a.user_approved:
        data["user_approved"] = a.user_approved
    P.write_stamp(scope["fingerprint"], data)
    print(f"stamped {scope['fingerprint']} as {a.status}")
    return 0


def cmd_list(_a):
    rows = []
    for f in glob.glob(os.path.join(P.state_dir("stamps"), "*.json")):
        try:
            rows.append(json.load(open(f, encoding="utf-8")))
        except Exception:
            pass
    for r in sorted(rows, key=lambda r: r.get("at", ""), reverse=True)[:15]:
        print(f"{r.get('at', '')[:19]}  {r['fingerprint']}  {r['status']:<13} files={r.get('files', '?')} features={','.join(r.get('features', [])) or '-'}  {r.get('report') or ''}")
    return 0


def cmd_toggle(a):
    p = os.path.join(P.state_dir(), "disabled")
    if a.cmd == "disable":
        open(p, "w").write("disabled by the user\n")
        print("Stop-hook gate disabled for this clone. Re-enable with: stamp.py enable")
    else:
        if os.path.exists(p):
            os.remove(p)
        print("Stop-hook gate enabled")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("status").set_defaults(fn=cmd_status)
    w = sp.add_parser("write")
    w.add_argument("--status", required=True, choices=STATUSES)
    w.add_argument("--report")
    w.add_argument("--features", nargs="*")
    w.add_argument("--domains", nargs="*")
    w.add_argument("--defects", type=int)
    w.add_argument("--note")
    w.add_argument("--user-approved")
    w.set_defaults(fn=cmd_write)
    sp.add_parser("list").set_defaults(fn=cmd_list)
    for n in ("disable", "enable"):
        sp.add_parser(n).set_defaults(fn=cmd_toggle)
    a = ap.parse_args()
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
