#!/usr/bin/env python3
"""Record (and read) that a security review covers the current code state. The Stop hook trusts these stamps.

  stamp.py status                       fingerprint of the current state and whether it is stamped
  stamp.py write --status STATUS [...]  STATUS: clean | fixed | open-findings | blocked-env | skipped
        --confirmed N --fixed N --dismissed N --note TEXT
        --user-approved "words the user used"     required for `skipped`
  stamp.py list                         recent stamps of this clone
  stamp.py disable | enable             switch the Stop-hook gate off/on for this clone (user decision only)

clean = nothing found; fixed = findings fixed and re-checked; open-findings = confirmed findings left for the owner
(listed in the report); blocked-env = a check could not run (say why in --note); skipped = the user said to skip.
Write the stamp only AFTER the audits, security-review and code-review ran on this exact state. Any later edit to a
covered file changes the fingerprint and the gate asks again.
"""
import argparse
import glob
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import sec_lib as S  # noqa: E402

STATUSES = ["clean", "fixed", "open-findings", "blocked-env", "skipped"]


def cmd_status(_a):
    sc = S.scope()
    if not sc["files"]:
        print("no code files differ from the base: nothing to review")
        return 0
    st = S.read_stamp(sc["fingerprint"])
    print(json.dumps({"fingerprint": sc["fingerprint"], "files": len(sc["files"]), "stamp": st}, indent=2))
    return 0 if st else 1


def cmd_write(a):
    sc = S.scope()
    if not sc["files"]:
        print("no code files differ from the base: nothing to stamp", file=sys.stderr)
        return 0
    if a.status == "skipped" and not a.user_approved:
        print("refused: a skip needs the user's explicit words: --user-approved \"<what they said>\".", file=sys.stderr)
        return 3
    if a.status == "blocked-env" and not a.note:
        print("refused: blocked-env needs --note saying which check could not run and why.", file=sys.stderr)
        return 3
    data = {"status": a.status, "confirmed": a.confirmed, "fixed": a.fixed, "dismissed": a.dismissed, "note": a.note,
            "files": len(sc["files"]), "branch": S.P.git("rev-parse", "--abbrev-ref", "HEAD").strip()}
    if a.user_approved:
        data["user_approved"] = a.user_approved
    S.write_stamp(sc["fingerprint"], data)
    print(f"stamped {sc['fingerprint']} as {a.status}")
    return 0


def cmd_list(_a):
    rows = []
    for f in glob.glob(os.path.join(S.state_dir("stamps"), "*.json")):
        try:
            with open(f, encoding="utf-8") as fh:
                rows.append(json.load(fh))
        except Exception:
            pass
    for r in sorted(rows, key=lambda r: r.get("at", ""), reverse=True)[:15]:
        print(f"{r.get('at', '')[:19]}  {r['fingerprint']}  {r['status']:<13} files={r.get('files', '?')} "
              f"confirmed={r.get('confirmed')} fixed={r.get('fixed')} dismissed={r.get('dismissed')}")
    return 0


def cmd_toggle(a):
    p = os.path.join(S.state_dir(), "disabled")
    if a.cmd == "disable":
        with open(p, "w") as f:
            f.write("disabled by the user\n")
        print("security Stop-hook gate disabled for this clone. Re-enable with: stamp.py enable")
    else:
        if os.path.exists(p):
            os.remove(p)
        print("security Stop-hook gate enabled")
    return 0


def main():
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest="cmd", required=True)
    sp.add_parser("status").set_defaults(fn=cmd_status)
    w = sp.add_parser("write")
    w.add_argument("--status", required=True, choices=STATUSES)
    w.add_argument("--confirmed", type=int)
    w.add_argument("--fixed", type=int)
    w.add_argument("--dismissed", type=int)
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
