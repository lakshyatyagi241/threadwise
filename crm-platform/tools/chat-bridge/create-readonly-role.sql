-- Least-privilege role for the slow-query watcher. Idempotent. Run as a superuser:
--   psql "$ADMIN_URL" -v pw="'<generated password>'" -v dbname=crm -f create-readonly-role.sql
-- pg_read_all_stats lets it see other roles' queries in pg_stat_activity and pg_stat_statements. No table privileges are granted.
SELECT format('CREATE ROLE slow_query_ro LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :pw)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slow_query_ro') \gexec
SELECT format('ALTER ROLE slow_query_ro PASSWORD %L', :pw) \gexec
GRANT pg_read_all_stats TO slow_query_ro;
ALTER ROLE slow_query_ro SET default_transaction_read_only = on;
ALTER ROLE slow_query_ro SET statement_timeout = '5s';
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO slow_query_ro', :'dbname') \gexec
