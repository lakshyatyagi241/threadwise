#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python3 webhook.py --selftest
python3 migration-lint.py --selftest
bash -n deploy-main.sh install.sh
bash ../hostinger/tests/ci-entry.test.sh >/dev/null
echo "build-server checks ok"
