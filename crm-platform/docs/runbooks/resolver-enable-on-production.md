# Enable the auto-resolver (cancel) on production

**Production stays in `AUTO_REMEDIATE=dry-run` until the owner approves after the 7-day review below. Nothing in this PR touched production.**

What `on` does: cancels (`pg_cancel_backend`, never terminate) a runaway pure SELECT running longer than `HARD_CANCEL_SECONDS` (default 120 s), and terminates an idle-in-transaction session only if it blocks others for >= `IDLE_BLOCKER_SECONDS` (60 s). Max `AUTO_REMEDIATE_MAX_PER_HOUR` (3) actions per playbook. Writes, DDL, COPY, `FOR UPDATE`, `nextval`, advisory locks, allow-listed apps and superuser sessions are never touched.

## Risk to accept first
A legitimate long SELECT (analytics export, report) over `HARD_CANCEL_SECONDS` WILL be cancelled; the user sees `57014 canceling statement due to user request`. A SELECT that calls a user function with side effects is NOT detected by text; the cancel rolls back the statement but not non-transactional effects (see the drill report). Exempt apps before enabling: `SLOW_EXCLUDE_APP_REGEX` (application_name, replaces the default list, so keep `gchat-watcher|pg_dump|...`) and `SLOW_EXCLUDE_USER_REGEX`.

## 1. Dry-run review (7 days, already the default)
```bash
docker logs gchat-bridge --since 168h 2>&1 | grep remediation_audit | grep '"result":"dry-run"' | wc -l
docker logs gchat-bridge --since 168h 2>&1 | grep remediation_audit | grep -E '"result":"(dry-run|refused)"'
curl -s localhost:<bridge-port>/incidents | jq '.incidents[] | select(.playbook=="cancel_select")'
```
Also read the "DRY-RUN: would cancel pid N" replies in the Slow Queries space. For each: which app/user, was it a legit report/export? Add its app to `SLOW_EXCLUDE_APP_REGEX`, or fix the query.
Go: every "would cancel" is a genuine runaway or has been exempted, 7 days, no `watcher_poll_error`, owner approves in writing. No-go: any legit job listed and not exempted.

## 2. Enable
```bash
PW=$(openssl rand -base64 24 | tr -d '/+=')
psql "$ADMIN_URL" -v pw="'$PW'" -v dbname=crm -f crm-platform/tools/chat-bridge/create-cancel-role.sql
umask 077; echo "postgres://slow_query_cancel:$PW@<db-host>:5432/crm" > secrets/slow_query_cancel_pg_url
# /opt/desk/.env: AUTO_REMEDIATE=on  (and SLOW_EXCLUDE_APP_REGEX if needed)
docker compose up -d --force-recreate gchat-bridge
```
Verify: `docker logs gchat-bridge | grep remediation_audit` shows `"mode":"on"`.

## 3. Rollback
Set `AUTO_REMEDIATE=dry-run` in `/opt/desk/.env`, `docker compose up -d --force-recreate gchat-bridge`; then `DROP OWNED BY slow_query_cancel; DROP ROLE slow_query_cancel;` and delete the secret file.
