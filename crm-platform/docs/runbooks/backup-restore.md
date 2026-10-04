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

Not covered, on purpose and still open: **the dumps live on the same machine as the database.** They protect against a bad
migration, a dropped table or a bad deploy, not against losing the host or its disk. Copy `/opt/desk/backups/` somewhere else
(see "Off the host"). The database volume is not snapshotted and there is no point-in-time recovery (WAL archiving).

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

## Off the host

Not automated. Until it is, run from a machine that can reach the server, ideally daily:

```bash
rsync -a --ignore-existing root@<host>:/opt/desk/backups/ /path/on/another/machine/desk-backups/
```

and keep a copy of `/opt/desk/.env` (it holds the encryption key) in a password manager or secret store, not next to the dumps.
Moving this into the service itself needs a destination (an object-storage bucket or a second host) and a decision about who
holds its credentials.

## Settings

| Variable           | Default | Meaning                                   |
| ------------------ | ------- | ----------------------------------------- |
| `BACKUP_HOUR_UTC`  | `2`     | hour of the nightly dump, 0 to 23         |
| `BACKUP_KEEP_DAYS` | `14`    | how long a dump is kept (newest 3 always) |

Set them in `/opt/desk/.env`, then `docker compose --env-file .env up -d backup`.
