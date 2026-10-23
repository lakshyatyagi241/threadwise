# Stack deploy test

`bash script-testing/stack-deploy/run.sh [--quick]` (exit 0 PASS, 1 FAIL).

Runs `bash -n` (and shellcheck when installed) on `deploy/hostinger/deploy-observability.sh` and `stack-selfcheck.sh`, the deploy script in `DESK_DEPLOY_DRYRUN=1` with fake webhook files (nothing is contacted), and the self-check against stub `docker`, `systemctl`, `curl` and `df` on PATH. No network, no docker, no ssh. Runbook: `docs/runbooks/stack-health-24h.md`.
