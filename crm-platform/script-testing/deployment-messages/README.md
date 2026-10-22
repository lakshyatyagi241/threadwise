# Deployment messages test

`bash script-testing/deployment-messages/run.sh [--quick] [--out DIR]` (exit 0 PASS, 1 FAIL, 2 ERROR; writes `result.json`, `logs/`).

Runs `tests.py`: a local fake GitHub REST API and a fake Chat receiver, then drives `deploy/hostinger/deploy-message.py`, `deploy/hostinger/desk-release-watch.sh` (loop mode with a stub `pgrep`, and `--dry-run`) and `deploy/build-server/notify-chat.sh`. It never contacts api.github.com or chat.googleapis.com. Standard and runbook: `docs/runbooks/deployment-messages.md`.
