#!/bin/sh
# Runs once, on the first start of an empty database, as the superuser. It creates the NON-SUPERUSER roles the app and
# worker connect as (a superuser would bypass every Row-Level Security policy). Migrations later grant them their
# crm_app / crm_worker membership (0007_rls_policies).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE crm_app_user    LOGIN PASSWORD '${APP_DB_PASSWORD}'    NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE crm_worker_user LOGIN PASSWORD '${WORKER_DB_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
SQL
