-- OPTIONAL separate role for AUTO_REMEDIATE=on (secrets/slow_query_cancel_pg_url). pg_signal_backend lets it cancel or end sessions of
-- NON-superusers only. The resolver code uses it for exactly two playbooks (cancel of a runaway SELECT, end of an idle-in-transaction
-- blocker); see resolver.mjs. No table access. Without this secret the resolver only suggests and ESCALATES.
--   psql "$ADMIN_URL" -v pw="'<generated password>'" -v dbname=crm -f create-cancel-role.sql
SELECT format('CREATE ROLE slow_query_cancel LOGIN PASSWORD %L NOSUPERUSER NOCREATEDB NOCREATEROLE', :pw)
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'slow_query_cancel') \gexec
SELECT format('ALTER ROLE slow_query_cancel PASSWORD %L', :pw) \gexec
GRANT pg_signal_backend TO slow_query_cancel;
GRANT pg_read_all_stats TO slow_query_cancel;
ALTER ROLE slow_query_cancel SET statement_timeout = '5s';
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'dbname') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO slow_query_cancel', :'dbname') \gexec
