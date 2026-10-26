# Chat alerts test

`bash script-testing/chat-alerts/run.sh [--quick] [--out DIR]` (exit 0 PASS, 1 FAIL, 2 ERROR; writes `result.json`, `logs/`, `e2e-results.json`).

Runs the unit tests in `tools/chat-bridge`, promtool/amtool checks, `docker compose config`, creates a throwaway database and a throwaway read-only role (both dropped on exit), and runs `tools/chat-bridge/e2e.mjs`: the real bridge+watcher process against a FAKE Google Chat receiver (it never calls chat.googleapis.com). `--quick` skips the burst/digest wait (about 70 s).

Own ports: fake Chat 59611, bridge 59612. Runbook: `docs/runbooks/google-chat-alerts.md`.
