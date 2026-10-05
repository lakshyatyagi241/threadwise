# Backups and restore (desk.wabo.ai)

What exists, how to check it, how to bring data back. Compose project `desk` in `/opt/desk` on the host
(`deploy/hostinger/`).

## What is backed up

The `backup` service in `docker-compose.yml` writes a `pg_dump -Fc` of the whole database to `/opt/desk/backups/` on the host:

| File                                  | When                                                      |
| ------------------------------------- | --------------------------------------------------------- |
| `desk-initial-<timestamp>.dump`       | once, when the service starts and no good dump exists yet |
| `desk-daily-<timestamp>.dump`         | every day at `BACKUP_HOUR_UTC` (default 02:00 UTC)        |
| `desk-pre-<release>-<timestamp>.dump` | at the start of every release, before migrations run      |
| `desk-manual-<timestamp>.dump`        | when you ask (below)                                      |

- A dump counts only after `pg_restore --list` can read it back; until then it is a `.part` file that is deleted on failure.
- Dumps older than `BACKUP_KEEP_DAYS` (default 14) are removed, **but the newest three are always kept**, so a stretch of failed
  nights cannot age out the last good copies.
- Files are mode 600. `/opt/desk/backups/.last-ok` is touched on every good dump; the container is `healthy` while it is under
  26 hours old.
- A release stops, before touching anything, if the pre-release dump fails. The one exception is the first release after the
  service was added, when it may not be running yet: that release goes ahead and says so.

The dumps in `/opt/desk/backups/` live on the same machine as the database: they protect against a bad migration, a dropped
table or a bad deploy. The `offsite` service (below, "Off the host") copies them to R2 once it is configured. The database volume
is not snapshotted and there is no point-in-time recovery (WAL archiving).

## Check that it is working

```bash
cd /opt/desk
docker compose --env-file .env ps backup                      # STATUS should say (healthy)
docker compose --env-file .env logs --tail 20 backup          # "backup: ok desk-daily-... 2.7M"
ls -lh backups | tail                                         # newest dumps and their size
```

A dump of a few hundred KB that suddenly becomes a few KB, or stops growing for weeks, deserves a look.

## Take a dump now

```bash
docker compose --env-file .env exec -T backup desk-backup once manual
```

## Prove a backup can be restored (do this, on a schedule)

A backup nobody has restored is a hope. This restores the newest dump into a throwaway database on the same server, compares
it with the live one, and drops it. It does not touch the live database.

```bash
cd /opt/desk
docker compose --env-file .env exec -T backup bash -c '
  f=$(ls -1t /backups/desk-*.dump | head -1)
  echo "restoring $f"
  createdb restore_check &&
  pg_restore --no-owner --no-acl --exit-on-error -d restore_check "$f" &&
  for d in "$PGDATABASE" restore_check; do
    echo "$d: migrations=$(psql -d $d -Atc "select count(*) from _migrations") contacts=$(psql -d $d -Atc "select count(*) from contacts")"
  done
  dropdb restore_check'
```

The two lines should agree, apart from rows written since the dump. If `createdb` says the database exists, a previous run was
interrupted: `dropdb restore_check` and run it again. (Tested on 2026-10-04 against a dump of the development database: 229
migrations and the same row counts after the restore.)

## Bring data back

### Undo a bad migration or a bad deploy (same server, same database)

The release already took `desk-pre-<release>-*.dump` before migrating. Choose the dump from just before the damage.

1. Note the current release tag: `grep IMAGE_TAG /opt/desk/.env`.
2. Stop the writers: `docker compose --env-file .env stop api worker web`.
3. Restore over the live database. This **replaces** its contents with the dump's:

   ```bash
   docker compose --env-file .env exec -T backup bash -c '
     pg_restore --clean --if-exists --exit-on-error -d "$PGDATABASE" /backups/<the-dump>.dump'
   ```

   Owners and grants are restored as dumped, because the objects belong to the database owner and that is the user the backup
   service connects as. Do **not** add `--no-owner` here.

4. Start the release that matches the data. If the dump predates a migration, the matching release is the previous one: set
   `IMAGE_TAG` in `.env` to it (the previous images are kept on the host) and `docker compose --env-file .env up -d api worker web`.
5. Check `https://desk.wabo.ai/ready`.

Everything written between the dump and step 2 is lost. Say so to whoever owns the data before you start.

### The host or disk is gone

1. New host, same layout: `deploy/hostinger/ship.sh` creates `/opt/desk`, a fresh `.env` and an empty database whose roles
   `init-roles.sh` creates. Put the **old** `.env` back first: without the old `CREDENTIALS_ENCRYPTION_KEY`, stored channel
   credentials cannot be read.
2. Copy a dump back to `/opt/desk/backups/` and run step 3 above (without stopping anything that is not running).

This path assumes you have an off-host copy of the dumps and of `.env`. If you do not, there is nothing to restore from.

## Off the host (Cloudflare R2)

The `offsite` service copies every verified dump in `/opt/desk/backups/` to an R2 bucket, so losing the host or its disk does
not lose the data. It runs in the API image next to `backup`, every 30 minutes (`OFFSITE_SYNC_MINUTES`).

- **Sealed before upload.** Each dump is encrypted on the host with `OFFSITE_BACKUP_KEY` (AES-256-GCM) and only the sealed copy
  leaves it. A dump holds every tenant's contacts and messages; with this, someone who obtains the **bucket keys** still cannot
  read it. That key is **not** the bucket token and **not** `CREDENTIALS_ENCRYPTION_KEY`.
- **Checked after upload.** A dump counts as copied only when the bucket reports the same size and MD5 as what was sent. The
  next pass retries anything that failed; the local dumps are never touched.
- **Retention in the bucket:** every dump from the last 30 days, the first dump of each calendar month for the last 12 months,
  and always the newest three. Only files named `desk-<label>-<timestamp>.dump.enc` are ever deleted.
- Healthy (`docker compose ps offsite`) while a whole pass succeeded within the last two hours.

### One-time setup (about ten minutes)

1. **In Cloudflare:** R2, create a bucket (for example `desk-backups`; leave public access off). Create an API token with
   **Object Read & Write**, restricted to **that bucket only**. Note the account's S3 endpoint
   (`https://<account id>.r2.cloudflarestorage.com`), the token's access key id and secret.
2. **Make the backup key and keep it somewhere that is not this server:** `openssl rand -base64 32`. Put a copy in your password
   manager / secret store **before** the first upload. Lose it and every copy in the bucket is unreadable.
3. **On the server**, add to `/opt/desk/.env` (mode 600): `OFFSITE_S3_ENDPOINT`, `OFFSITE_S3_BUCKET`, `OFFSITE_S3_ACCESS_KEY_ID`,
   `OFFSITE_S3_SECRET_ACCESS_KEY`, `OFFSITE_BACKUP_KEY` (see `.env.example`).
4. **Prove the settings work:**
   `docker compose --env-file .env run --rm --no-deps offsite node dist/src/modules/platform-infrastructure/offsite-backup/offsite-backup.cli.js check`
   It writes, reads back and deletes a small test object, and says which step failed (a wrong secret is `HTTP 403`, a wrong bucket
   `NoSuchBucket`).
5. **Start it:** `docker compose --env-file .env up -d offsite`. Watch `docker compose logs -f offsite` for
   `uploaded desk-...dump (... bytes sealed)`, then `... list` (below) to see the objects.
6. **Restore a copy once, now, while nothing is wrong** (next section). An untried backup is a hope.

Until step 3 is done the service starts, prints `not configured (missing ...)` and stops. That is expected.

### Look at what is in the bucket

```bash
docker compose --env-file .env exec -T offsite node dist/src/modules/platform-infrastructure/offsite-backup/offsite-backup.cli.js list
```

### Get a dump back from the bucket

Works on any machine that has the API image (or this repo built) and the same settings, so it works on a new host too:

```bash
# on the host, or anywhere with the OFFSITE_* settings in the environment
node dist/src/modules/platform-infrastructure/offsite-backup/offsite-backup.cli.js fetch desk-daily-20261004T020000Z.dump ./restored.dump
```

It downloads the sealed file and opens it with `OFFSITE_BACKUP_KEY`; if the key is wrong or the file was altered, it fails and
writes nothing. Then restore `restored.dump` with `pg_restore` as in "Bring data back" above. If you changed the backup key
since the dump was made, list the old key in `OFFSITE_BACKUP_PREVIOUS_KEYS`.

### Changing the backup key

Set the new key as `OFFSITE_BACKUP_KEY` and move the old one to `OFFSITE_BACKUP_PREVIOUS_KEYS` (comma-separated). New dumps are
sealed with the new key; old copies in the bucket stay readable with the old one, so keep it until the oldest of them has aged out
(12 months).

### What this does not cover

- Both the bucket keys and the backup key live in `/opt/desk/.env`, so someone who owns the **server** can read and delete the
  copies. Protection against that needs a bucket the server cannot delete from (R2 bucket locks or a lifecycle you control) or a
  second, separately-held copy; not set up.
- The sealed copy hides the data, not the fact that backups exist or how big they are.
- Copies are only as fresh as the last dump (nightly, plus one before every release), not point-in-time.

## Settings

| Variable           | Default | Meaning                                   |
| ------------------ | ------- | ----------------------------------------- |
| `BACKUP_HOUR_UTC`  | `2`     | hour of the nightly dump, 0 to 23         |
| `BACKUP_KEEP_DAYS` | `14`    | how long a dump is kept (newest 3 always) |

Set them in `/opt/desk/.env`, then `docker compose --env-file .env up -d backup`.
