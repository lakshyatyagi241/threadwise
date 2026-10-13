# WhatsApp credential import (Waboo -> WaDesk)

Migration tooling, not an app feature. One file, `import-whatsapp-credentials.cjs`, runs inside the desk-api image (needs only `pg`, already in `/app/node_modules`). It lets a migrated client keep its WhatsApp number without a new Meta login by storing Waboo's existing token in WaDesk through the app's encrypted path. **Nothing is made live.**

## What it does

- Reads `dumps/<client>/chatbot_misc_config.ndjson` and the inbox step's `dumps/<client>/channel-map.json`.
- Keeps ONLY the WhatsApp documents (`config_key` in the mapping, default `META_WHATSAPP_CONFIG`) and only these fields: `access_token`, `phoneID`, `waba_id`, `auth_key`, `provider` (names are configurable, below). Google OAuth, OpenAI, SMS and webhook documents are ignored. A WhatsApp document with a credential-looking key that is not mapped, a token that does not match the pattern, a missing id, a list instead of an object, a WhatsApp-shaped document under an unlisted `config_key`, or two live documents for one number that disagree: **refused, nothing guessed**.
- Per number of the channel map: finds the channel the inbox step made (`kind='whatsapp_cloud'`, `external_id` = phone number id) in the migrated organization. Refuses: no channel, more than one, a channel not made by this client's migration, a channel already `connected`, an organization whose `settings.legacy.waboo.client` is not `--client`.
- Writes (one transaction per number, as `crm_worker_user`, tenant GUCs set like `withTenant`) a `wa_provider_configs` row: `provider='waba'`, **`status='pending'`**, `credentials_json` = `CryptoService` blob (`v1:<iv>:<tag>:<ct>:<keyid>`, AES-256-GCM, `CREDENTIALS_ENCRYPTION_KEY`), `meta_json` with ids only (`waba_id`, `phone_number_id`, `provider`, `provider_key`, `connected_via='migration'`, `inbound_wired=false`), `phone_number`/`display_label` from the channel map, `is_primary` for the first row of the organization.
- **Why not `channels.credentials_enc`:** for `whatsapp_cloud` the app ignores it. `ChannelRegistryService.runtime()` reads the credentials of the LINKED `wa_provider_configs` row (`channels.waba_config_id`). The channel row is not changed by this tool at all (a test compares every column before and after).
- No `event_outbox`, audit, notification or any other table is written (a test diffs the row count of every table). No network call exists in the file (a test greps for it).
- Idempotent: same source -> `unchanged`, nothing written. A different stored value is refused unless `--refresh-secrets`. A connection that is not `pending`/`disconnected` or was not made by this tool is never touched.

## Imported but not live

Sending needs `channels.status='connected'` (`ChannelDispatcher.assertChannelCan`) and the linked connection `connected`. After the import the channel is `disconnected` and **unlinked** (`waba_config_id` NULL), the connection is `pending`. Do not link them by hand: if a linked channel meets a not-connected connection, `WabaChannelLinkService.ensure` releases the channel's `external_id`, which would split the migrated threads. The app flips a number live only through `WabaConnectService.persist` (status, audit, `whatsapp.connection.connected` outbox event that links and connects the channel). **Activation is therefore NOT implemented here**: no single safe column exists, and a raw SQL flip would skip the event. It needs a separate reviewed step or an app-side admin action (open decision).

## Export the input (operator, separately, never into git)

`chatbot_misc_config` is on the exporter's denylist because it holds tokens; export it alone, to an encrypted volume, with the explicit override and the data owner's approval:

```
node bin/mongo-export.cjs --db <database> --client <client> --out <dir> --i-confirm-encrypted-volume \
     --collections chatbot_misc_config --i-know-what-i-am-doing \
     --reason 'WhatsApp credential import for <client>, approved by <name>, <date>'
```

(or the `--to-ssh --i-confirm-server-is-staging` form). Put the file at `$MIG/dumps/<client>/chatbot_misc_config.ndjson` on the server; delete it after the import and `--verify`.

## Run (server, inside the desk-api image; same pattern as `cycle.cjs` / `set-owner-password.cjs`)

```bash
cd /opt/desk && MIG=/opt/desk/migration
# 1. dry run (default): per number what it WOULD do, key NAMES only
docker compose --env-file .env run --rm --no-deps -T --user 10001:10001 \
  -v $MIG/bundle/import-whatsapp-credentials.cjs:/app/import-whatsapp-credentials.cjs:ro -v $MIG/dumps:/mig/dumps:ro worker \
  sh -c 'TARGET_DATABASE_URL="$DATABASE_URL" exec node /app/import-whatsapp-credentials.cjs \
         --client iskm --org-slug <slug> --confirm-db-name crm --allow-docker-host postgres --dumps-dir /mig/dumps' </dev/null
# 2. apply: the same command plus
#      --apply --confirm-org-slug <slug>
# 3. verify (decrypts in memory, FORMAT and source match only, prints booleans): the same command plus --verify
```

The worker container already has `CREDENTIALS_ENCRYPTION_KEY` (and `CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS`). To seal with the app's own compiled service instead of the byte-identical copy in the file, add `-e CRYPTO_FROM=/app/dist/src/common/crypto` (a directory holding `crypto.service.js`; verify the path in the image first, it is not exercised against a real image).

| Flag | Meaning |
| --- | --- |
| `--mapping FILE` | JSON merged over the defaults: `configKeys`, `fields` (our name -> name inside `config_value`), `knownIgnored`, `tokenPattern`, `providers`, `defaultProvider`. Names and a pattern only, never a value. |
| `--auth-key skip\|source\|env` | `skip` (default, spec B.4: the interakt `auth_key` is Geta's platform-wide partner key), `source` (copy it), `env` (use `INTERAKT_PARTNER_AUTH_KEY` of the container, like `WabaConnectService`). `pinnacle`: `auth_key` becomes `channel_token`, always. |
| `--refresh-secrets` | overwrite a stored credential that differs from the source |
| `--input`, `--channel-map` | explicit files (default under `--dumps-dir/<client>/`) |

Exit: 0 ok, 3 refused (any number refused), 1 failed, 2 usage.

## Manual check that the token still works (not implemented: no network here)

For each number, from a trusted machine and without pasting the token anywhere that logs it: `GET https://graph.facebook.com/debug_token?input_token=<token>` with an app access token of the Meta app that issued it; `is_valid` must be true, `expires_at` 0 (or in the future), scopes must include `whatsapp_business_messaging` and `whatsapp_business_management`. Only then do activation and the webhook move (spec C, B.6).

## Tests

`node --test pilot/credentials/import-whatsapp-credentials.test.cjs` (local scratch DB, `node pilot/scratch-db.cjs up`, invented tokens): dry run writes nothing, apply writes only the whitelisted keys and only `wa_provider_configs`, sealed blobs open with the app's real `CryptoService` compiled from the repo source (and the reverse), no secret in any stdout/stderr or column, every refusal above, idempotency, `--verify`, other channels and organizations untouched.
