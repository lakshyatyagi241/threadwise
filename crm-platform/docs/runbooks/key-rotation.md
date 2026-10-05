# Rotating the credentials encryption key

`CREDENTIALS_ENCRYPTION_KEY` seals every secret the API stores so it can read it back: channel and gateway credentials, OAuth
tokens, MFA secrets, webhook secrets, and in some domains personal data (sales-document buyers, appointment notes, task notes).
It is not a password hash: lose it and the secrets are gone; leak it together with a database copy and they are readable.

Rotate it on a schedule (yearly is reasonable), when someone who held it leaves, and immediately if it may have leaked.

## How it works

- Every blob names the key that sealed it (`v1:<iv>:<tag>:<ciphertext>:<key id>`); older blobs without a key id are tried against
  every key.
- The API reads with a **ring**: `CREDENTIALS_ENCRYPTION_KEY` (new blobs are sealed with it) plus
  `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` (comma-separated, read only).
- `rotate-keys.cli.js` moves everything that is stored onto the current key. It finds the blobs by **scanning every text and
  jsonb column of every table**, not from a list of known places, so a domain added next year is rotated without anyone
  remembering to register it. It writes one row at a time, only if the row is unchanged since it was read; a row a user edited
  in the meantime is skipped and reported, and a rerun picks it up.

## Before you start

1. **Take a dump and keep it:** `docker compose --env-file .env exec -T backup desk-backup once pre-rotation`
   (see [backup-restore](backup-restore.md)).
2. **Copy the current `.env`** (it holds the current key) to your secret store. Do not lose the old key by overwriting it.
3. Off-peak. The scan reads every text/jsonb column; on a large database it takes a while and is I/O heavy, though it takes no
   locks beyond the row it is updating. `--only=` / `--exclude=` take table names if you need to split it up.

## Steps

```bash
cd /opt/desk
NEW=$(openssl rand -base64 32)      # keep this; it is the new CREDENTIALS_ENCRYPTION_KEY
```

1. **Edit `.env`**: put the key that is there now at the front of `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` (comma-separated if
   there is one already), then set `CREDENTIALS_ENCRYPTION_KEY` to the new key. Never paste keys into a shell history or a chat.
2. **Restart so the API and the worker use the ring:** `docker compose --env-file .env up -d api worker`. Check
   `https://desk.wabo.ai/ready` and open a page that reads a stored secret (a connected channel's status, MFA sign-in). New blobs
   are now sealed with the new key and old ones still open.
3. **Preview:** `docker compose --env-file .env run --rm --no-deps api node dist/src/modules/platform-infrastructure/crypto-rotation/rotate-keys.cli.js --dry-run`
   It prints, per column, how many blobs it found, and a table of blobs by the key that sealed them. `UNREADABLE` lines are
   blobs no key in the ring can open: read "If something is unreadable" before going on.
4. **Move them:** the same command without `--dry-run`. Exit code 0 means everything it found is now under the new key. Exit 2
   means something could not be read, or changed while it ran: fix what it names or just run it again.
5. **Confirm:** the same command with `--dry-run` must now say `nothing is left under an old key` and exit 0.
6. **Drop the old key from the ring — but not yet, see below.** Remove it from `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS`,
   `docker compose --env-file .env up -d api worker`.

### Keep the old key for as long as a backup could be restored

**Backups made before step 4 hold blobs sealed with the old key.** If you restore one after the old key is gone, those secrets
are unreadable for good. The nightly and pre-release dumps are kept 14 days (`BACKUP_KEEP_DAYS`) and any copy you made off the
host lives as long as you keep it. So do step 6 only when the **oldest dump you could still restore is newer than step 4**, or
keep the old key in the secret store (labelled with the date) until then, and put it back into `PREVIOUS_KEYS` if you ever
restore an older dump.

## If something is unreadable

`UNREADABLE <column>: <table> (ctid) (<key id>)` means the blob was sealed with a key that is not in the ring, or only looks like
a blob. The key id says which. If you have that key, add it to `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` and run again. If you do
not, the secret cannot be recovered: re-enter it (reconnect the channel, re-issue the token). The tool never changes or deletes an
unreadable value, so nothing is lost by running it.

## Limits

- It rotates what is in the database. Not rotated: `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` (rotating them signs everyone out),
  `WHATSAPP_APP_SECRET`, SMTP and other settings that live only in `.env`.
- Short-lived sealed values that are not stored in a column (signed chat-media links, a half-finished MFA enrolment held in Redis)
  stop working once the old key is dropped; they are minutes to hours old by then.
- **A suspected leak is not fixed by rotating alone.** Anyone who held the old key and a database copy can read every secret as
  it was. Rotate the encryption key **and** re-issue the credentials themselves at the providers (Meta, Shopify, Google,
  payment gateways), then drop the old key promptly.
- Columns of type `bytea` and values nested inside text-encoded JSON are not scanned; none exist today.

## Settings

| Variable                               | Meaning                                                         |
| -------------------------------------- | --------------------------------------------------------------- |
| `CREDENTIALS_ENCRYPTION_KEY`           | 32 bytes, base64 (`openssl rand -base64 32`): seals new blobs   |
| `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS` | comma-separated older keys, read only; empty outside a rotation |
