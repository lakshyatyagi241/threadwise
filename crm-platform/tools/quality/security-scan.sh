#!/usr/bin/env bash
# The three security scans (QA tasks 28, 27, 39) on your own machine, the same commands as .github/workflows/security.yml.
#   bash crm-platform/tools/quality/security-scan.sh            secrets + dependencies
#   bash crm-platform/tools/quality/security-scan.sh --images   also build and scan both Docker images (slow)
# Needs Docker (the scanners run from their official images) and pnpm. Exits non-zero at the first scan that fails.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
GITLEAKS_IMAGE="${GITLEAKS_IMAGE:-zricethezav/gitleaks:v8.30.1}"
TRIVY_IMAGE="${TRIVY_IMAGE:-aquasec/trivy:0.75.0}"
OUT="$(mktemp -d)"
step() { printf '\n==> %s\n' "$*"; }

step "Secrets in the whole git history"
docker run --rm -v "$ROOT:/repo" "$GITLEAKS_IMAGE" detect --source /repo --log-opts="--all" \
  --config /repo/.gitleaks.toml --redact --no-banner

step "Dependencies: audit and the gate"
cd "$ROOT/crm-platform"
node --test tools/quality/audit-gate.test.mjs
pnpm audit --prod --json > "$OUT/audit-prod.json" || true
pnpm audit --json > "$OUT/audit-all.json" || true
node tools/quality/audit-gate.mjs "$OUT/audit-prod.json" "$OUT/audit-all.json"

step "Dependencies: Trivy over the lockfile (production)"
docker run --rm -v "$PWD:/src" "$TRIVY_IMAGE" fs --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 /src/pnpm-lock.yaml

if [ "${1:-}" = "--images" ]; then
  for app in api web; do
    step "Docker image: $app"
    docker build -f "apps/$app/Dockerfile" -t "desk-$app:scan" .
    docker run --rm -v /var/run/docker.sock:/var/run/docker.sock -v "$ROOT/.trivyignore:/.trivyignore:ro" "$TRIVY_IMAGE" \
      image --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --ignorefile /.trivyignore "desk-$app:scan"
  done
fi
printf '\nAll security scans passed.\n'
