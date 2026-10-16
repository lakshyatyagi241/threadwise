#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python3 webhook.py --selftest
bash -n deploy-main.sh install.sh
echo "build-server checks ok"
