#!/usr/bin/env python3
"""Stop hook: do not let a turn end while code changed and no security review covers that exact state.

Wired in .claude/settings.json (Stop). Reads the hook JSON on stdin and prints
{"decision":"block","reason":...} to make Claude continue and run the security-review-gate skill.

Only ever NUDGES: pure git + file reads, no network. Safe by construction:
  - any error                    -> allow the stop (a broken gate must never trap a session)
  - stop_hook_active             -> allow (no loops)
  - at most 2 blocks per state   -> allow after that (the user can always end the turn)
  - SECURITY_GATE=off or <git-dir>/threadwise-security/disabled -> allow
"""
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import sec_lib as S  # noqa: E402

MAX_BLOCKS = 2


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    try:
        if data.get("hook_event_name", "Stop") != "Stop" or data.get("stop_hook_active"):
            return 0
        if S.gate_disabled():
            return 0
        sc = S.scope()
        if not sc["files"]:
            return 0
        fp = sc["fingerprint"]
        if S.read_stamp(fp) or S.block_count(fp) >= MAX_BLOCKS:
            return 0
        S.bump_block(fp)
        sample = ", ".join(sc["files"][:4]) + (" ..." if len(sc["files"]) > 4 else "")
        reason = (
            f"SECURITY GATE: code changed ({len(sc['files'])} files; e.g. {sample}) and no security review is recorded for this "
            f"exact state (fingerprint {fp}). Invoke the `security-review-gate` skill now (Skill tool): repo audits, secret scan, "
            "then the built-in `security-review` and `code-review` skills, triage and fix confirmed findings, then record the "
            "stamp with stamp.py. Do not finish the turn before a stamp exists. If the user told you to skip the review, record it: "
            "python3 .claude/skills/security-review-gate/scripts/stamp.py write --status skipped --user-approved \"<their words>\"."
        )
        print(json.dumps({"decision": "block", "reason": reason}))
    except Exception as e:
        print(f"security-review-gate ignored an error: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
