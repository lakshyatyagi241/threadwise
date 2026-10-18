# Runbook: data retention (archive and drop closed partitions)

Why and how: [the spec, section 6](../superpowers/specs/2026-10-16-event-based-analytics-design.md), [scale.md](../architecture/scale.md) (partition
retention). This page is for the person running it.

## What the job does

Every day at 03:50 (container time, UTC in production) the worker walks the streams in `STREAM_POLICIES`
(`apps/api/src/modules/data-retention/retention-policies.ts`). Today that is one: `an_events`, 60 days live. For each month whose end is more than the live
window ago:

1. reads the partition once, in id order, 20,000 rows at a time, without the columns the policy omits (`contact_id`), and writes one gzipped NDJSON file per
   workspace to a temp directory;
2. uploads `archive/<stream>/<yyyy-mm>/<org_id>.ndjson.gz` for each workspace, then `_manifest.json` (rows, bytes and SHA-256 of the uncompressed text, per workspace);
3. reads every object back and checks its row count, size and hash against the manifest;
4. locks the partition against writers, counts it again per workspace, and if the counts still equal the manifest calls `drop_closed_partition()`, which
   detaches and drops it.

Then, for streams with an archive window, it deletes the archive months older than live days plus archive days (`an_events` keeps its archive forever).

It never touches the `_default` partition, the current or the previous month inside the live window, or any stream that is not in the list. Any doubt
(a damaged object, a changed count, an unreachable store) means nothing is dropped; the next night starts the month again.

## Settings

| Variable            | Default       | Meaning                                                                                                                         |
| ------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `RETENTION_ENABLED` | `false`       | The job does nothing at all unless this is `true`.                                                                              |
| `RETENTION_DRY_RUN` | `true`        | With the job on, only log what it would do.                                                                                     |
| `ARCHIVE_DRIVER`    | `local`       | `s3` for the bucket (S3, R2). `local` writes to `ARCHIVE_LOCAL_DIR` (default `.archive`) and is for development only.    |
| `S3_BUCKET_ARCHIVE` | `crm-archive` | Created on the first write. Uses `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE`. |

`RETENTION_DRY_RUN=false` with `ARCHIVE_DRIVER=local` in production is refused (`retention refused` in the log): a local archive lives in the container and a
redeploy erases it, after which dropping the partition would be data loss. `ARCHIVE_DRIVER=s3` with a missing endpoint or key stops the process at boot.

## First rollout

1. Deploy with the defaults. Nothing runs.
2. Set `ARCHIVE_DRIVER=s3` and the `S3_*` settings the worker already has for media. The archive bucket should be on storage that survives the host, or be
   copied off it (the same question as the database backup; see `deploy/hostinger/README.md`).
3. Set `RETENTION_ENABLED=true`, leave `RETENTION_DRY_RUN=true`, restart the worker. After 03:50 the log has one `retention dry run` line per stream
   with the months it would archive and, for each, an estimated row count and size in bytes read from the catalog (the row estimate is `unknown` until
   the partition has been analysed). The same figures by hand:

   ```sql
   SELECT relname, reltuples::bigint AS est_rows, pg_size_pretty(pg_total_relation_size(oid)) AS size
     FROM pg_class WHERE relname ~ '^an_events_[0-9]{6}$' ORDER BY relname;
   ```

4. Check free space where the worker writes its temp files (`/tmp` in the container, unless `TMPDIR` is set): about the compressed size of the biggest
   month. Check the bucket has room for the same.
5. Take one real run at a quiet hour: set `RETENTION_DRY_RUN=false`, restart the worker before 03:50 and watch the log (below). Months go one at a time, oldest first.
   The first night archives every closed month that is older than the window, so expect it to take the longest.

The partition drop needs a short exclusive lock on `an_events`; the function waits three seconds and gives up, so event writes can stall for at most that long
once a night, and only if something else holds a long lock on the table.

## Watching it

Worker log lines:

| Line                                                              | Meaning                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `retention dry run`                                               | planned months per stream (`wouldArchive`) and archive months that would expire                     |
| `partition archived and dropped`                                  | one month done: rows, workspaces, bytes, and whether this run exported it or only finished the drop |
| `archive verification failed`                                     | an object did not match its manifest; nothing dropped; the reason names the workspace               |
| `rows changed after the export; the month will be exported again` | a row arrived or was erased between export and drop; nothing dropped; retried next night            |
| `retention failed for stream`                                     | an error (store unreachable, lock timeout, database); other streams still ran                       |
| `retention refused: ...`                                          | a real run with the local driver in production                                                      |
| `retention run skipped: the previous run is still going`          | the last night's run is still working                                                               |

```sql
-- partitions still hot, oldest first (the open months stay; anything older than the window should be gone after a successful night)
SELECT relname FROM pg_class WHERE relname ~ '^an_events_[0-9]{6}$' ORDER BY relname;
-- rows that never get archived: must be 0 (partition maintenance fell behind otherwise)
SELECT count(*) FROM an_events_default;
```

## Check a month by hand

The manifest says what each object must contain:

```
archive/an_events/2026-08/_manifest.json
archive/an_events/2026-08/7.ndjson.gz
```

```bash
# with any S3 client (alias "archive" pointing at the store); any S3 client works the same
mc cat archive/crm-archive/archive/an_events/2026-08/_manifest.json
mc cat archive/crm-archive/archive/an_events/2026-08/7.ndjson.gz | gunzip | wc -l          # rows
mc cat archive/crm-archive/archive/an_events/2026-08/7.ndjson.gz | gunzip | sha256sum      # sha256
```

The row count and hash must equal that workspace's `rows` and `sha256` in the manifest. (`bytes` is the size of the compressed object.)

## Restore a month into a side table

For an audit or a lost report. This does not touch `an_events`. Run from a machine with `psql` and access to the objects; `contact_id` is not in the archive,
so it comes back NULL.

```bash
mkdir restore && cd restore
mc cp archive/crm-archive/archive/an_events/2026-08/7.ndjson.gz .      # the workspaces you need
```

```sql
CREATE TABLE an_events_restore (LIKE an_events INCLUDING DEFAULTS);  -- a plain table: no partitions, no RLS, no keys
CREATE TEMP TABLE raw (j jsonb);
-- csv with quote and delimiter characters that cannot appear in JSON loads each line whole
\copy raw FROM PROGRAM 'gunzip -c 7.ndjson.gz' WITH (FORMAT csv, QUOTE E'\x01', DELIMITER E'\x02')
INSERT INTO an_events_restore SELECT (jsonb_populate_record(NULL::an_events_restore, j)).* FROM raw;
```

Repeat the `\copy` and `INSERT` for each workspace file. Drop the side table when done. Check it first on a handful of rows: timestamps come back exactly,
microseconds included.

To read archived rows from code (an export, a drill-down past 60 days) use `ArchiveReader.stream('an_events', orgId, from, to)` from
`apps/api/src/modules/data-retention`; it opens only that workspace's objects, one per month in range, and streams them. Inside a request it
only serves the request's own workspace (platform operators excepted). Outside a request (a worker job) pass `{ trusted: true }` as the
fifth argument, which says the workspace id came from the job's own data and not from a client; without it the read is refused.

## When something goes wrong

| Symptom                                                    | Cause and action                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paused after 3 failed attempts ...` for a month           | The month failed (a failed check, changing rows, or an error) three nights in a row, so the job leaves it alone for a week instead of exporting it again every night; the log has `retention paused for this month after repeated failures`. Fix the cause (a writer still inserting into the closed month, the store, the disk), then either wait or delete `archive/<stream>/<yyyy-mm>/_failures.json` to retry at the next run. The file is removed when the month is dropped. |
| Same month fails verification every night                  | The store is corrupting or truncating uploads. Look at the `reason`; try the manual check above. The source rows are still in Postgres, so nothing is lost.                                                                                                                                                                                                                                                                                                                       |
| `rows changed after the export` every night                | Something still writes to a closed month (a backfill, a clock far off). Find the writer; once it stops the next run archives and drops.                                                                                                                                                                                                                                                                                                                                           |
| `lock timeout` on the drop                                 | A long query held a lock on `an_events`. It retries the next night; look at `pg_stat_activity` for long transactions.                                                                                                                                                                                                                                                                                                                                                             |
| Worker out of disk during an export                        | The temp directory is too small for the month. Free space or set `TMPDIR` to a bigger volume; the partial temp files are removed on failure.                                                                                                                                                                                                                                                                                                                                      |
| `permission denied for function drop_closed_partition`     | The worker is not connecting as `crm_worker_user`. Only that role may call it (the API role may not).                                                                                                                                                                                                                                                                                                                                                                             |
| `... is not an archivable stream`                          | The stream is in `STREAM_POLICIES` but its migration has not added it to `archivable_streams()`. Add the stream there (see below).                                                                                                                                                                                                                                                                                                                                                |
| A month was dropped but its objects are missing or damaged | Restore from the database backup if inside its window; otherwise the month's rollups (`an_rollup_day`) still hold the totals. This is why the check runs before every drop.                                                                                                                                                                                                                                                                                                       |
| Need to stop it now                                        | `RETENTION_ENABLED=false` and restart the worker. The restart ends a run in progress; nothing half-done is harmful, the next run starts the month over.                                                                                                                                                                                                                                                                                                                           |

## Erasing a workspace

The workspace erase queues one marker row (`archive-erase/<org>/all`) in `storage_purge_queue`; the purge worker deletes that workspace's
`<org>.ndjson.gz` objects in every stream and month (`ArchiveEraser`), and retries until it succeeds. Month manifests are not rewritten: they keep the
numeric workspace id and a row count, no personal data. Archive objects never carry `contact_id`, so a contact erase needs no archive work.

## Adding a stream

A stream's cut ships only after every reader of its old rows has switched to the rollups (the metric loop in [analytics.md](../architecture/analytics.md)).
Then, in one change:

1. add its `StreamPolicy` to `STREAM_POLICIES` (partition key, id and workspace columns, live days, archive days, columns to omit);
2. a migration that replaces `archivable_streams()` with the stream added (the database refuses to drop anything else);
3. a test with a real Postgres like `apps/api/test/integration/data-retention/partition-archiver.spec.ts`, and a dry run in production before the first real one.
