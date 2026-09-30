---
name: threadwise-run-reference
description: >-
  Start, stop, check, or first-time-install the local Reference reference app
  (the Laravel product we are porting) so its real behavior can be looked at
  in a browser or queried in its database. Use this whenever someone says
  "run threadwise", "start the reference app", "open threadwise locally", "check how
  threadwise does X", "compare with threadwise", "threadwise is not running", "install
  threadwise", "php not found" or "threadwise login", or whenever another threadwise-*
  skill needs the reference app up. Reference is READ-ONLY reference: this skill
  never edits it, and nothing in it is ported code.
---

# Run the Reference reference app

Reference lives outside this repo (it is a licensed CodeCanyon product and must
never be committed here). Default location, relative to this repo:
`../reference/app`. Override with `THREADWISE_REF=/path/to/Threadwise`
(the folder that contains `artisan`). Default port 8000, override with
`THREADWISE_PORT`.

## Day to day

```bash
bash .claude/skills/threadwise-run-reference/scripts/start.sh     # background, idempotent
bash .claude/skills/threadwise-run-reference/scripts/status.sh    # up? which URL? log path
bash .claude/skills/threadwise-run-reference/scripts/stop.sh      # only ever kills Laravel's dev server
```

`start.sh` prints the URL and the seeded admin login. It refuses to start when
PHP is missing/too old, `.env` or `storage/installed` is missing, the database
is unreachable or not migrated, or the port is held by something that is not a
Laravel dev server (it never kills a foreign process). Log:
`${TMPDIR:-/tmp}/threadwise-ref-$USER/serve.log`.

- URL: <http://127.0.0.1:8000> (marketing site), `/login`, admin console after login.
- Admin: `test@example.com` / `password` (seeded by `DatabaseSeeder`, role `admin`).
- Frontend assets are prebuilt in `public/build`, so no Vite dev server is needed.
  If `public/hot` ever exists, delete it; Laravel would point at a dead dev server.
- The Node/Baileys bridge is **not** started by this skill. Anything that needs a
  live WhatsApp session (QR pairing, sending, Baileys health) cannot be exercised
  here; verify those from source plus seeded data, and say so in your notes.
- Read the database directly when a screen is not enough:
  `mysql -uthreadwise -pthreadwise_local_pw threadwise -e 'SHOW CREATE TABLE contacts\G'` (read-only use only).

## Driving it with a browser

Use the browser tools against `http://127.0.0.1:8000`. Sign in with the seeded
admin above; that is a local test account for this reference app, never reuse
those values for anything else. Do not connect real channels, send real
messages, or enter real payment details; test/sandbox credentials only.

## First-time setup on a new machine (Ubuntu 24.04, what was actually run)

Only needed when `start.sh` fails a prerequisite. Ask before running the
`sudo` lines; they change the machine.

1. PHP 8.2 with the extensions Laravel + Reference need (Ubuntu 24.04 ships 8.3, so use the Ondrej PPA):

   ```bash
   sudo add-apt-repository -y ppa:ondrej/php && sudo apt-get update
   sudo apt-get install -y php8.2-cli php8.2-common php8.2-mysql php8.2-mbstring php8.2-xml php8.2-curl php8.2-zip php8.2-bcmath php8.2-gd php8.2-intl php8.2-redis
   ```

   (Installing the bare `php8.2` metapackage also pulls in Apache; not needed.)

2. MySQL/MariaDB database and user:

   ```bash
   sudo mysql -e "CREATE DATABASE IF NOT EXISTS threadwise; CREATE USER IF NOT EXISTS 'threadwise'@'localhost' IDENTIFIED BY 'threadwise_local_pw'; GRANT ALL PRIVILEGES ON threadwise.* TO 'threadwise'@'localhost'; FLUSH PRIVILEGES;"
   ```

3. In `$THREADWISE_REF/.env` set: `APP_ENV=local`, `APP_DEBUG=true`, `APP_URL=http://127.0.0.1:8000`,
   `DB_CONNECTION=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_DATABASE=threadwise`,
   `DB_USERNAME=threadwise`, `DB_PASSWORD=threadwise_local_pw`. Keep the shipped `APP_KEY`.

4. Schema, seed data, install marker (the web installer is bypassed because the DB is prepared by hand):

   ```bash
   cd "$THREADWISE_REF"
   php artisan migrate --force
   php artisan db:seed --force
   touch storage/installed          # EnsureInstalled middleware checks this file
   php artisan storage:link         # "already exists" is fine
   ```

5. Then `bash .claude/skills/threadwise-run-reference/scripts/start.sh`.

If someone does want the Vite dev server (only to edit Reference assets, which we
never do): `chmod +x node_modules/.bin/vite node_modules/vite/bin/vite.js`, and if
Rollup complains about `@rollup/rollup-linux-x64-gnu`, delete `node_modules` and
`package-lock.json` and run `npm install` (npm optional-dependency bug).

## Rules

- Never modify anything under `THREADWISE_REF` (except the runtime dirs Laravel itself writes: `storage/`, `bootstrap/cache/`).
- Never copy Reference source, views, JS/CSS, images or copy text into this repo. Describe behavior, then rebuild it.
- Do not run Reference's seeders/migrations against any database other than the local `threadwise` one.
