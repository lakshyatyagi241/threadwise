#!/usr/bin/env bash
# Master runner: runs every script-testing/<test>/run.sh and aggregates. See README.md. Logic lives in _lib/master.mjs.
set -euo pipefail
exec node "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/_lib/master.mjs" "$@"
