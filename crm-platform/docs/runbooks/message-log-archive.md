# Runbook: message log archive and export

What it is: `message_events` (the delivery log of every message) keeps 90 days live; a daily worker sweep moves older days into
`message_event_archives` and deletes them from the live table; the archive keeps a year. A user can export a range (up to 365 days back)
as a CSV by email. Design and rules: [docs/api/chat-conversations.md](../api/chat-conversations.md) ("The message log").

## Is it healthy

```sql
-- the oldest event still in the live table: should be at most ~91 days old once the sweep has run
SELECT min(created_at) FROM message_events;
-- the archive: one row per workspace and day
SELECT min(day), max(day), count(*), pg_size_pretty(sum(length(payload_gz))::bigint) FROM message_event_archives;
-- exports that are stuck
SELECT uuid, org_id, status, requested_at, started_at FROM message_log_exports WHERE status IN ('queued', 'running') ORDER BY requested_at;
```

The worker logs `[MSGLOG] archive sweep` with `{ days, events, purgedDays, expiredExports, failedExports }` whenever it did something. A sweep
that throws logs `[MSGLOG] archive sweep failed`; the next night starts from the oldest event left, so nothing is lost by a missed night.

## The oldest live event is much older than 90 days

The sweep stopped, or it is catching up (it archives at most 45 days a run). Look for `archive sweep failed` in the worker log. A common cause is the
integrity check: `archive of <day> for workspace <id> moved N events but deleted M`, which rolls that day back and leaves both copies untouched.
Fix the cause, then run the sweep by hand from a worker shell (`MessageLogArchiveService.sweep()`), or wait for 02:17.

## An export is stuck `queued`

The job never reached a worker (Redis down when it was requested is already handled: the row is marked `failed`). Check the `msg-log-export` queue in the
queue dashboard and that a worker is running. Delete the stuck row's job (`msglog-export-<uuid>`) and set the row to `failed`; the user requests it again. A
`running` row older than an hour is failed by the sweep on its own.

## Disk

The archive is `bytea` (TOASTed, gzip already). A busy workspace is a few hundred KB a day. Export files are held for 7 days and then set to NULL by the sweep.
`message_events` space freed by the sweep is reused by Postgres after autovacuum; to give it back to the OS, drop a month's partition once every day in it is archived.

## Restore

The archive is in the database, so a database restore brings it back with everything else ([backup-restore.md](backup-restore.md)).
