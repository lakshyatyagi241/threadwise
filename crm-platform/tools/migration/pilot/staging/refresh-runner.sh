#!/usr/bin/env bash
# Rebuilds the migration tool from this checkout and puts it on the staging runner, so the next run uses the current code.
#
#   bash pilot/staging/refresh-runner.sh            (from tools/migration; needs node_modules for tsx, drizzle-orm, pg, zod)
#
# Steps: build the two single-file programs (bundle.mjs, writes dist/ and BUILD-INFO.json), tar the tool tree without node_modules,
# overlay it on the runner's copy (files the runner has and this checkout does not, such as its env files, are kept), then check that
# the runner's BUILD-INFO names the same commit. preflight refuses a bundle whose migrations differ from the deployed directory, so a
# skipped refresh stops the run instead of running against the wrong schema.
#
# Environment: RUNNER_HOST (default desk.wabo.ai), RUNNER_USER (root), SSH_KEY (default ~/.ssh/desk_deploy),
# RUNNER_TOOL_DIR (default /opt/waboo-runner/crm-platform/tools/migration).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOOL="$(cd "$HERE/../.." && pwd)"
RUNNER_HOST="${RUNNER_HOST:-desk.wabo.ai}"
RUNNER_USER="${RUNNER_USER:-root}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/desk_deploy}"
RUNNER_TOOL_DIR="${RUNNER_TOOL_DIR:-/opt/waboo-runner/crm-platform/tools/migration}"
SSH=(ssh -i "$SSH_KEY" -o BatchMode=yes "$RUNNER_USER@$RUNNER_HOST")

cd "$TOOL"
echo "== building the bundle from $(git rev-parse --short HEAD)"
node pilot/staging/bundle.mjs

sha="$(git rev-parse HEAD)"
dirty="$(git status --porcelain -- . | head -1 || true)"
if [ -n "$dirty" ]; then echo "warning: the tree has uncommitted changes; BUILD-INFO will say gitDirty"; fi

archive="$(mktemp -t mig-tool.XXXXXX.tgz)"
trap 'rm -f "$archive"' EXIT
echo "== packing the tool tree"
tar czf "$archive" -C "$TOOL" --exclude=node_modules --exclude=.git .

echo "== overlaying $RUNNER_HOST:$RUNNER_TOOL_DIR"
scp -i "$SSH_KEY" -q "$archive" "$RUNNER_USER@$RUNNER_HOST:/tmp/mig-tool.tgz"
"${SSH[@]}" "set -e; mkdir -p '$RUNNER_TOOL_DIR'; tar xzf /tmp/mig-tool.tgz -C '$RUNNER_TOOL_DIR'; rm -f /tmp/mig-tool.tgz"

echo "== checking the runner's bundle"
runner_sha="$("${SSH[@]}" "python3 -c \"import json;print(json.load(open('$RUNNER_TOOL_DIR/pilot/staging/dist/BUILD-INFO.json'))['gitSha'])\"")"
if [ "$runner_sha" != "$sha" ]; then
  echo "error: the runner's bundle is $runner_sha, expected $sha" >&2
  exit 1
fi
echo "ok: the runner has the bundle built from $(git rev-parse --short HEAD)"
