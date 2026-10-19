#!/usr/bin/env bash
# Fault fixture RES-050 / RES-093: what a queue Redis does at maxmemory with noeviction. Starts a throwaway redis-server on a spare
# port (never touches a real one), fills it past maxmemory and checks four things:
#   1. a write past the limit is REFUSED with an OOM error (it is not silently dropped)
#   2. keys written before the limit are all still there (nothing was evicted)
#   3. reads and deletes still work, so a consumer can drain and free memory
#   4. after memory is freed, writes work again
# Needs `redis-server` and `redis-cli` on PATH. Output is one line per check, PASSED or FAILED; exit 1 on any FAILED.
set -u
PORT=${PORT:-6399}
DIR=$(mktemp -d)
trap 'redis-cli -p "$PORT" shutdown nosave >/dev/null 2>&1; rm -rf "$DIR"' EXIT
redis-server --port "$PORT" --dir "$DIR" --save "" --appendonly no --maxmemory 8mb --maxmemory-policy noeviction --daemonize yes >/dev/null
for _ in $(seq 50); do redis-cli -p "$PORT" ping 2>/dev/null | grep -q PONG && break; sleep 0.1; done
R() { redis-cli -p "$PORT" "$@"; }
fail=0
check() { if [ "$2" = ok ]; then echo "PASSED $1"; else echo "FAILED $1 ($2)"; fail=1; fi; }

R set sentinel:first "kept" >/dev/null
payload=$(head -c 2048 /dev/zero | tr '\0' x)
written=0; refused=""
for i in $(seq 1 20000); do
  out=$(R set "job:$i" "$payload")
  if [ "$out" = OK ]; then written=$i; else refused="$out"; break; fi
done
case "$refused" in *OOM*) check "write past maxmemory is refused with OOM (after $written keys)" ok ;; *) check "write past maxmemory is refused with OOM" "got: ${refused:-no refusal in 20000 writes}" ;; esac
[ "$(R get sentinel:first)" = kept ] && [ "$(R get job:1)" = "$payload" ] && [ "$(R get "job:$written")" = "$payload" ] && check "nothing was evicted" ok || check "nothing was evicted" "a key written before the limit is gone"
[ "$(R exists "job:$written")" = 1 ] && check "reads still work at the limit" ok || check "reads still work at the limit" "read failed"
for i in $(seq 1 "$written"); do R del "job:$i" >/dev/null; done
[ "$(R set job:after "x")" = OK ] && check "writes work again after memory is freed" ok || check "writes work again after memory is freed" "still refused"
echo "evicted_keys=$(R info stats | tr -d '\r' | sed -n 's/^evicted_keys://p') used_memory_peak=$(R info memory | tr -d '\r' | sed -n 's/^used_memory_peak_human://p')"
exit $fail
