#!/usr/bin/env bash
# Runs INSIDE the WSL distro as root. Driven by wsl-runtime.ts (and scripts/test-no-docker-clean.mjs). Everything it creates is
# named tc_nodocker_<id> under /tmp so the janitor can find it. It NEVER touches the shared dev cluster (16/main, port 55710).
#   pg-start <id> <port> <db> <user> <password> [key=value ...]   new throwaway Postgres 16 cluster (initdb), prints "READY <port>"
#   pg-stop <id>                                                  stop + delete
#   redis-start <id> <port>                                       new throwaway Redis, prints "READY <port>"
#   redis-stop <id>
#   clean [--all]                                                 stop + delete leftovers (default: older than 3h; --all: everything)
#   clean-run <tag>                                               stop + delete everything one vitest run started
# NOTE: this script is piped to `bash -s` over stdin; main runs with </dev/null so no command can swallow the rest of the script.
set -u
PGBIN=/usr/lib/postgresql/16/bin
ROOT=/tmp
PREFIX=tc_nodocker_
main() {
cmd="${1:-}"; shift || true

port_free() { [ -z "$(ss -tan "sport = :$1" 2>/dev/null | tail -n +2)" ]; }

pg_stop_dir() {
  local d="$1"
  if [ -f "$d/data/postmaster.pid" ]; then
    runuser -u postgres -- "$PGBIN/pg_ctl" -D "$d/data" -m immediate -w stop >/dev/null 2>&1 || true
    # postgres may have been started by a different pg_ctl: make sure nothing is left
    local pid; pid=$(head -1 "$d/data/postmaster.pid" 2>/dev/null || true)
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null || true
  fi
  rm -rf "$d"
}
redis_stop_dir() {
  local d="$1"
  if [ -f "$d/redis.pid" ]; then local rp; rp=$(cat "$d/redis.pid" 2>/dev/null || true); [ -n "$rp" ] && { kill "$rp" 2>/dev/null || true; sleep 0.1; kill -9 "$rp" 2>/dev/null || true; }; fi
  rm -rf "$d"
}

case "$cmd" in
  pg-start)
    id="$1"; port="$2"; db="$3"; user="$4"; pass="$5"; shift 5
    d="$ROOT/${PREFIX}pg_$id"
    port_free "$port" || { echo "PORT_BUSY"; exit 3; }
    # lazy reaper: clusters left by killed runs (older than 3 h)
    find "$ROOT" -maxdepth 1 -name "${PREFIX}*" -mmin +180 2>/dev/null | while read -r old; do
      case "$old" in *_pg_*) pg_stop_dir "$old";; *_redis_*) redis_stop_dir "$old";; esac
    done
    install -d -o postgres -g postgres -m 700 "$d" "$d/data" "$d/sock"
    pwfile="$d/pw"; printf '%s' "$pass" > "$pwfile"; chown postgres "$pwfile"
    runuser -u postgres -- "$PGBIN/initdb" -D "$d/data" -U "$user" --pwfile="$pwfile" --auth-host=scram-sha-256 --auth-local=trust \
      -E UTF8 --locale=C.UTF-8 --no-sync >"$d/initdb.log" 2>&1 || { cat "$d/initdb.log"; rm -rf "$d"; echo "INITDB_FAILED"; exit 4; }
    rm -f "$pwfile"
    opts="-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=$d/sock -c fsync=off -c synchronous_commit=off -c full_page_writes=off -c shared_buffers=16MB -c max_connections=100 -c jit=off -c max_wal_size=256MB -c log_min_messages=fatal"
    for kv in "$@"; do opts="$opts -c $kv"; done
    if ! runuser -u postgres -- "$PGBIN/pg_ctl" -D "$d/data" -l "$d/server.log" -w -t 60 -o "$opts" start >"$d/start.log" 2>&1; then
      cat "$d/start.log" "$d/server.log" 2>/dev/null | tail -20
      if grep -qE "could not create any TCP/IP sockets|Address already in use" "$d/server.log" 2>/dev/null; then rm -rf "$d"; echo "PORT_BUSY"; exit 3; fi
      rm -rf "$d"; echo "START_FAILED"; exit 5
    fi
    if [ "$db" != "postgres" ]; then
      "$PGBIN/psql" -h "$d/sock" -p "$port" -U "$user" -d postgres -v ON_ERROR_STOP=1 -qc "CREATE DATABASE \"$db\"" >/dev/null 2>&1 \
        || { pg_stop_dir "$d"; echo "CREATEDB_FAILED"; exit 6; }
    fi
    echo "READY $port"
    ;;
  pg-stop) pg_stop_dir "$ROOT/${PREFIX}pg_$1"; echo STOPPED ;;
  redis-start)
    id="$1"; port="$2"; d="$ROOT/${PREFIX}redis_$id"
    port_free "$port" || { echo "PORT_BUSY"; exit 3; }
    mkdir -p "$d"
    redis-server --port "$port" --save "" --appendonly no --bind 127.0.0.1 --daemonize yes --dir "$d" \
      --pidfile "$d/redis.pid" --logfile "$d/redis.log" --protected-mode no --maxmemory 64mb >/dev/null 2>&1 </dev/null
    for _ in $(seq 1 50); do
      if redis-cli -h 127.0.0.1 -p "$port" ping 2>/dev/null </dev/null | grep -q PONG; then echo "READY $port"; exit 0; fi
      sleep 0.1
    done
    if grep -q "Address already in use" "$d/redis.log" 2>/dev/null; then redis_stop_dir "$d"; echo "PORT_BUSY"; exit 3; fi
    tail -5 "$d/redis.log" 2>/dev/null; redis_stop_dir "$d"; echo "REDIS_FAILED"; exit 5
    ;;
  redis-stop) redis_stop_dir "$ROOT/${PREFIX}redis_$1"; echo STOPPED ;;
  clean)
    mode="${1:-}"
    n=0
    for x in "$ROOT"/${PREFIX}*; do
      [ -e "$x" ] || continue
      if [ "$mode" != "--all" ] && [ -z "$(find "$x" -maxdepth 0 -mmin +180)" ]; then continue; fi
      case "$x" in *_pg_*) pg_stop_dir "$x";; *_redis_*) redis_stop_dir "$x";; *) rm -rf "$x";; esac
      n=$((n+1))
    done
    # Orphans whose directory is already gone (only our -D /tmp/tc_nodocker_ data dirs; never the shared 16/main cluster).
    pkill -9 -f "postgres -D /tmp/${PREFIX}" 2>/dev/null || true
    pkill -9 -f "redis-server.*/tmp/${PREFIX}" 2>/dev/null || true
    echo "CLEANED $n"
    ;;
  clean-run)
    # everything started by one vitest run (its global-setup teardown calls this, so a worker that was killed leaks nothing)
    tag="$1"; n=0
    for x in "$ROOT"/${PREFIX}*_"${tag}"_*; do
      [ -e "$x" ] || continue
      case "$x" in *_pg_*) pg_stop_dir "$x";; *_redis_*) redis_stop_dir "$x";; *) rm -rf "$x";; esac
      n=$((n+1))
    done
    echo "CLEANED $n"
    ;;
  list) ls -d "$ROOT"/${PREFIX}* 2>/dev/null | sed "s#$ROOT/##"; echo END ;;
  *) echo "usage: wsl-ctl.sh pg-start|pg-stop|redis-start|redis-stop|clean|list"; exit 2 ;;
esac
}
main "$@" </dev/null
