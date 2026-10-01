#!/usr/bin/env python3
"""Stop hook: do not let a turn end while feature code changed and no WaDesk parity run covers that exact state.

Wired in .claude/settings.json (Stop). Reads the hook JSON on stdin and prints
{"decision":"block","reason":...} to make Claude continue and run the wadesk-playwright-parity skill.

It only ever NUDGES: pure git + file reads, a few milliseconds, no browser, no network. Safe by construction:
  - any error                        -> allow the stop (a broken gate must never trap a session)
  - stop_hook_active                 -> allow (Claude is already continuing because of a hook; no loops)
  - at most 2 blocks per state       -> after that, allow (the user can always end the turn)
  - PARITY_GATE=off or .git/wadesk-parity/disabled -> allow
"""
import json
import os
import sys

sys.dont_write_bytecode = True  # no __pycache__ in the repo (also covers the sibling skill modules we import)

sys.path.insert(0, os.path.dirname(os.path.realpath(__file__)))
import parity_lib as P  # noqa: E402

MAX_BLOCKS = 2


def main():
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}
    try:
        if data.get("hook_event_name", "Stop") != "Stop" or data.get("stop_hook_active"):
            return 0
        if P.gate_disabled():
            return 0
        scope = P.feature_scope()
        if not scope["files"]:
            return 0
        fp = scope["fingerprint"]
        if P.read_stamp(fp):
            return 0
        if P.block_count(fp) >= MAX_BLOCKS:
            return 0
        P.bump_block(fp)
        layers = {}
        for f in scope["files"]:
            layers[f["layer"]] = layers.get(f["layer"], 0) + 1
        summary = ", ".join(f"{k} {v}" for k, v in sorted(layers.items()))
        sample = ", ".join(f["path"] for f in scope["files"][:4]) + (" ..." if len(scope["files"]) > 4 else "")
        reason = (
            f"PARITY GATE: feature code changed ({len(scope['files'])} files: {summary}; e.g. {sample}) and no WaDesk parity run "
            f"is recorded for this exact state (fingerprint {fp}). Invoke the `wadesk-playwright-parity` skill now (Skill tool): it "
            "runs this change against the WaDesk reference in Playwright, compares UI, UX and functionality with edge cases, reports "
            "every difference and spawns fix sub-agents for the defects. If the change has no comparable surface the skill records "
            "that itself with stamp.py. Do not finish the turn before a stamp exists. If the user told you to skip the check, record "
            "it: python3 .claude/skills/wadesk-playwright-parity/scripts/stamp.py write --status skipped --user-approved \"<their words>\"."
        )
        print(json.dumps({"decision": "block", "reason": reason}))
    except Exception as e:  # never trap the session
        print(f"wadesk-playwright-parity gate ignored an error: {e}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
