#!/usr/bin/env bash
# Moved: the VAPT runner now lives in script-testing/vapt/run.sh
exec bash "$(dirname "$0")/../../script-testing/vapt/run.sh" "$@"
