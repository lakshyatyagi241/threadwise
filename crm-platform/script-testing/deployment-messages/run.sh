#!/usr/bin/env bash
# Deployment message standard: formatter + release watcher + build-server notifier against a LOCAL fake GitHub API and fake Chat receiver.
# Exit: 0 PASS, 1 FAIL, 2 ERROR. Needs only bash, python3, curl. Never calls api.github.com or chat.googleapis.com.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/../_lib/common.sh"
st_init deployment-messages "Deployment message standard (PR, commit, author, deployer)"
st_help() { echo "bash script-testing/deployment-messages/run.sh [--quick|--full] [--out DIR]  (both modes run the same ~1 min suite)"; }
st_parse_args "$@"
command -v python3 >/dev/null || st_error "python3 not found"
command -v curl >/dev/null || st_error "curl not found"
D="$ST_ROOT/deploy"
for f in hostinger/desk-release-watch.sh hostinger/install-release-watch.sh build-server/notify-chat.sh build-server/deploy-main.sh; do st_run "syntax_$(basename "$f")" bash -n "$D/$f"; done
st_run syntax_deploy-message.py python3 -m py_compile "$D/hostinger/deploy-message.py"
st_run unit_file_present test -f "$D/hostinger/desk-release-watch.service"
python3 "$HERE/tests.py" > "$OUT/logs/tests.log" 2>&1; rc=$?
while read -r s name; do st_check "$name" "$s"; done < <(sed -n 's/^  \(PASS\|FAIL\) \(.*\)$/\1 \2/p' "$OUT/logs/tests.log")
[ "$rc" = 0 ] || [ -n "$(grep -c '^  FAIL' "$OUT/logs/tests.log" | grep -v '^0$')" ] || st_check tests_crashed FAIL "see logs/tests.log"
st_finish
