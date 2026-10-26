#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python3 webhook.py --selftest
python3 migration-lint.py --selftest
bash -n deploy-main.sh install.sh notify-chat.sh
bash ../hostinger/tests/ci-entry.test.sh >/dev/null

# notify-chat.sh: fake receiver, hanging receiver, missing file, 500. It must always exit 0 and never leak the URL.
T=$(mktemp -d); trap 'kill $(jobs -p) 2>/dev/null; rm -r "$T"' EXIT
export DESK_CI_LOGS="$T" DESK_CI_DIR="$T/none"
serve() { python3 - "$1" "$2" "$T/got" <<'PY' &
import http.server, sys, time
mode, port, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
class H(http.server.BaseHTTPRequestHandler):
    def do_POST(s):
        b = s.rfile.read(int(s.headers.get('content-length', 0)))
        if mode == 'hang': time.sleep(30)
        open(out, 'ab').write(b + b'\n'); s.send_response(500 if mode == '500' else 200); s.end_headers()
    def log_message(*a): pass
http.server.HTTPServer(('127.0.0.1', port), H).serve_forever()
PY
}
port() { python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1])'; }
SECRET=hooktoken123
try() { echo "http://127.0.0.1:$1/v1/spaces/X/messages?key=k&token=$SECRET" > "$T/url"; DESK_CI_GCHAT_URL_FILE="$T/url" bash notify-chat.sh "${@:2}"; }
P=$(port); serve ok $P; sleep 0.5
try $P succeeded abcdef1234567 42 || exit 1
grep -q '"Release succeeded"' "$T/got" && grep -q '/commit/abcdef1234567' "$T/got" || { echo "fake receiver did not get the card"; exit 1; }
DESK_CI_GCHAT_URL_FILE="$T/missing" bash notify-chat.sh started abc || { echo "missing file must exit 0"; exit 1; }
P=$(port); serve 500 $P; sleep 0.5
try $P failed abcdef1234567 || { echo "500 must exit 0"; exit 1; }
grep -q 'http 500' "$T/webhook.log" || { echo "500 not logged"; exit 1; }
P=$(port); serve hang $P; sleep 0.5
t0=$(date +%s); try $P started abcdef1234567 || { echo "hang must exit 0"; exit 1; }
[ $(( $(date +%s) - t0 )) -le 7 ] || { echo "hanging receiver delayed the notifier"; exit 1; }
grep -q 'timed out\|http 000\|http none\|not delivered' "$T/webhook.log" || { echo "hang not logged"; exit 1; }
! grep -q "$SECRET" "$T/webhook.log" || { echo "URL leaked into the log"; exit 1; }
echo "build-server checks ok"
