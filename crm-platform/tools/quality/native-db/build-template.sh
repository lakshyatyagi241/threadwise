#!/usr/bin/env bash
# Builds the empty Postgres cluster every test file copies (UTF-8: the CHECK constraints count characters, a C/SQL_ASCII cluster counts bytes).
# Needs: Linux, root (it runs Postgres as the `postgres` user with runuser), postgresql-16 and the pgvector 0.8 extension installed.
set -euo pipefail
T=${PG_TEMPLATE_DIR:-/tmp/native-db/template}
BIN=${PGBIN:-/usr/lib/postgresql/16/bin}
mkdir -p "$(dirname "$T")"; chown postgres "$(dirname "$T")"; chmod 755 "$(dirname "$T")"
rm -rf "$T"
runuser -u postgres -- "$BIN/initdb" -D "$T" -U crm --auth=trust -E UTF8 --locale=C.UTF-8 > /dev/null
cat >> "$T/postgresql.conf" <<CONF
max_connections = 200
shared_buffers = 128MB
work_mem = 16MB
fsync = off
synchronous_commit = off
full_page_writes = off
shared_preload_libraries = 'pg_stat_statements'
log_min_messages = warning
CONF
runuser -u postgres -- "$BIN/pg_ctl" -D "$T" -o "-p 55432 -c listen_addresses=127.0.0.1 -c unix_socket_directories=$T" -l "$T/log.txt" -w start > /dev/null
PGHOST=127.0.0.1 PGPORT=55432 psql -U crm -d postgres -qc "CREATE DATABASE crm OWNER crm ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'"
runuser -u postgres -- "$BIN/pg_ctl" -D "$T" -m fast -w stop > /dev/null
echo "template ready at $T"
