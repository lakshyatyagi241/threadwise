---
name: wadesk-run-reference
description: >-
  Start, stop, check, or first-time-install the local WaDesk reference app
  (the Laravel product we are porting) so its real behavior can be looked at
  in a browser or queried in its database. Use this whenever someone says
  "run wadesk", "start the reference app", "open wadesk locally", "check how
  wadesk does X", "compare with wadesk", "wadesk is not running", "install
  wadesk", "php not found" or "wadesk login", or whenever another wadesk-*
  skill needs the reference app up. WaDesk is READ-ONLY reference: this skill
  never edits it, and nothing in it is ported code.
---

# Run the WaDesk reference app

WaDesk lives outside this repo (it is a licensed CodeCanyon product and must
never be committed here). Default location, relative to this repo:
`../wadesk-reference/WaDesk`. Override with `WADESK_REF=/path/to/WaDesk`
(the folder that contains `artisan`). Default port 8000, override with
`WADESK_PORT`.

## Day to day

```bash
bash .claude/skills/wadesk-run-reference/scripts/start.sh     # background, idempotent
bash .claude/skills/wadesk-run-reference/scripts/status.sh    # up? which URL? log path
bash .claude/skills/wadesk-run-reference/scripts/stop.sh      # only ever kills Laravel's dev server
```

`start.sh` prints the URL and the seeded admin login. It refuses to start when
PHP is missing/too old, `.env` or `storage/installed` is missing, the database
is unreachable or not migrated, or the port is held by something that is not a
Laravel dev server (it never kills a foreign process). Log:
`${TMPDIR:-/tmp}/wadesk-ref-$USER/serve.log`.

- URL: <http://127.0.0.1:8000> (marketing site), `/login`, admin console after login.
- Admin: `test@example.com` / `password` (seeded by `DatabaseSeeder`, role `admin`).
- Frontend assets are prebuilt in `public/build`, so no Vite dev server is needed.
  If `public/hot` ever exists, delete it; Laravel would point at a dead dev server.
- The Node/Baileys bridge is **not** started by this skill. Anything that needs a
  live WhatsApp session (QR pairing, sending, Baileys health) cannot be exercised
  here; verify those from source plus seeded data, and say so in your notes.
- Read the database directly when a screen is not enough:
  `mysql -uwadesk -pwadesk_local_pw wadesk -e 'SHOW CREATE TABLE contacts\G'` (read-only use only).

## Driving it with a browser

Use the browser tools against `http://127.0.0.1:8000`. Sign in with the seeded
admin above; that is a local test account for this reference app, never reuse
those values for anything else. Do not connect real channels, send real
messages, or enter real payment details; test/sandbox credentials only.

## First-time setup on a new machine (Ubuntu 24.04, what was actually run)

Only needed when `start.sh` fails a prerequisite. Ask before running the
`sudo` lines; they change the machine.

1. PHP 8.2 with the extensions Laravel + WaDesk need (Ubuntu 24.04 ships 8.3, so use the Ondrej PPA):

   ```bash
   sudo add-apt-repository -y ppa:ondrej/php && sudo apt-get update
   sudo apt-get install -y php8.2-cli php8.2-common php8.2-mysql php8.2-mbstring php8.2-xml php8.2-curl php8.2-zip php8.2-bcmath php8.2-gd php8.2-intl php8.2-redis
   ```

   (Installing the bare `php8.2` metapackage also pulls in Apache; not needed.)

2. MySQL/MariaDB database and user:

   ```bash
   sudo mysql -e "CREATE DATABASE IF NOT EXISTS wadesk; CREATE USER IF NOT EXISTS 'wadesk'@'localhost' IDENTIFIED BY 'wadesk_local_pw'; GRANT ALL PRIVILEGES ON wadesk.* TO 'wadesk'@'localhost'; FLUSH PRIVILEGES;"
   ```

3. In `$WADESK_REF/.env` set: `APP_ENV=local`, `APP_DEBUG=true`, `APP_URL=http://127.0.0.1:8000`,
   `DB_CONNECTION=mysql`, `DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_DATABASE=wadesk`,
   `DB_USERNAME=wadesk`, `DB_PASSWORD=wadesk_local_pw`. Keep the shipped `APP_KEY`.

4. Schema, seed data, install marker (the web installer is bypassed because the DB is prepared by hand):

   ```bash
   cd "$WADESK_REF"
   php artisan migrate --force
   php artisan db:seed --force
   touch storage/installed          # EnsureInstalled middleware checks this file
   php artisan storage:link         # "already exists" is fine
   ```

5. Then `bash .claude/skills/wadesk-run-reference/scripts/start.sh`.

If someone does want the Vite dev server (only to edit WaDesk assets, which we
never do): `chmod +x node_modules/.bin/vite node_modules/vite/bin/vite.js`, and if
Rollup complains about `@rollup/rollup-linux-x64-gnu`, delete `node_modules` and
`package-lock.json` and run `npm install` (npm optional-dependency bug).

## Rules

- Never modify anything under `WADESK_REF` (except the runtime dirs Laravel itself writes: `storage/`, `bootstrap/cache/`).
- Never copy WaDesk source, views, JS/CSS, images or copy text into this repo. Describe behavior, then rebuild it.
- Do not run WaDesk's seeders/migrations against any database other than the local `wadesk` one.
