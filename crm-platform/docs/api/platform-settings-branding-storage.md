# Platform settings, branding and storage API (SET)

All operator routes are under `/v2/platform/settings`, behind the operator guard (platform operator token, IP allowlist,
MFA for super admins). Every operator role may read; only `super_admin` may write, test and export. Errors are
`application/problem+json` with a stable `code`.

A settings **group** is one typed document edited as a page. Groups: `general`, `branding`, `site`, `mail`, `seo`, `privacy`,
`analytics`, `customCode`, `pwa`, `storage`, `realtime`, and `googleCalendar` (the Google OAuth client every workspace connects its
calendar through: `enabled`, `clientId`, `redirectUri`, secret `clientSecret`; the group's `extra.redirectUri` is the address to register at Google;
see [appointments-booking.md](appointments-booking.md#google-calendar-tw-appt-012-028-029-d-08)). Field lists are the zod schemas in
`packages/contracts/src/platform-settings-branding-storage/groups.ts`.

## GET /groups

The hub: which groups are saved, which need a connection test, key numbers.

```json
{
  "kpis": {
    "savedGroups": 2,
    "totalGroups": 11,
    "needsTest": ["mail"],
    "secretFields": 1,
    "lastUpdatedAt": "2026-10-02T04:10:00.000Z"
  },
  "groups": [
    { "group": "mail", "saved": true, "updatedAt": "2026-10-02T04:10:00.000Z", "needsTest": true }
  ]
}
```

`needsTest`: a testable group (mail, storage, real-time) that is configured (mail with a host, the others enabled) and has no
successful test yet.

## GET /groups/:group

```json
{
  "group": "mail",
  "values": {
    "mailer": "smtp",
    "host": "smtp.acme.test",
    "port": 587,
    "username": "mailer",
    "encryption": "tls",
    "fromName": "Acme",
    "fromAddress": "no-reply@acme.test"
  },
  "secrets": { "password": { "isSet": true } },
  "rowVersion": 3,
  "updatedAt": "2026-10-02T04:10:00.000Z",
  "test": { "ok": true, "at": "2026-10-02T04:11:00.000Z" }
}
```

A never-saved group answers `rowVersion: 0`, `updatedAt: null` and its defaults (`general.appName` from `APP_NAME`; mail fields from
the `SMTP_*` environment). Secrets are never returned, only `isSet`. Unknown group: 422.

## PATCH /groups/:group (super admin)

```json
{
  "rowVersion": 3,
  "values": { "port": 465, "encryption": "ssl" },
  "secrets": { "password": "new-password" }
}
```

- `rowVersion` is required and must equal the one you read; a mismatch is `409 ROW_VERSION_CONFLICT` and nothing changes.
- `values` is a partial of the group; unknown fields are refused (`422 VALIDATION_FAILED`, `errors[].path` such as `values.appUrl`).
  A nested object (`logos`, `colors`) is replaced as a whole.
- `secrets`: a string replaces, `null` removes, a blank string or an absent key keeps the stored value.
- A patch that changes nothing answers 200 with the current document and does not bump the version or write an audit event.
- One audit event `platform.settings.<group>_updated` in `security_events`, in the same transaction, with the changed field
  names only (`{"fields": ["port", "password"], "rowVersion": 4}`).

Response: the same shape as GET.

## GET /export (super admin)

```json
{
  "app": "Acme Chat",
  "exportedAt": "2026-10-02T04:20:00.000Z",
  "note": "Secret values and account identifiers are replaced with [REDACTED].",
  "settings": [
    {
      "key": "set.mail",
      "value": { "host": "smtp.acme.test", "username": "[REDACTED]" },
      "secret": false
    },
    { "key": "set.mail.password", "value": "[REDACTED]", "secret": true }
  ]
}
```

Redaction comes from the secret flag and a per-group list of account identifiers (storage `accessKeyId`, mail `username`,
analytics `posthogKey` and `mixpanelToken`, real-time `appKey`), not from key-name patterns. Audited as `platform.settings.exported`.

## POST /mail/test, /storage/test, /realtime/test (super admin)

Always use the SAVED settings. Answer `200 { "ok": boolean, "message": string }` (Reference used 422 on failure; the page shows the
message either way). Mail takes `{ "to": "me@acme.test" }`.

- Mail: sends "Mail settings test" through the configured transport. Failure messages name a reason (`the server refused the
username or password`, `the server refused the connection`, ...), never server text.
- Storage: writes `<basePath>/connection-tests/<random>.txt` to the bucket with a hand-signed S3 request, then deletes it.
  Failure: `Connection failed: HTTP 403 AccessDenied` (the provider's error code, never the body).
- Real-time: fires a `ping` event at Pusher's REST API.

A success is remembered (clears "needs test"); every test writes `platform.settings.<group>_test` with status success or failure.

## Public (no authentication)

- `GET /v2/public/site-config`: brand (name, URL, favicon, logos with paper fallback, font, platform footer), defaults, maintenance
  flag, `themeCss`, SEO tags, footer, cookie banner, tracker ids (non-empty only), custom code (empty unless enabled), PWA flag,
  real-time flag. Built field by field; never echoes a stored document.
- `GET /v2/public/manifest.webmanifest`: 404 until the PWA switch is on.
- `GET /v2/public/robots.txt`: from the SEO robots directive; a `Sitemap:` line only when the app URL is set.

## Maintenance mode

While `general.maintenanceMode` is on, every route answers `503` (`code: SET_MAINTENANCE`, `Retry-After: 3600`) except health
probes, `/v2/platform/*`, `/v2/auth/*`, `/v2/public/*`, `/v2/webhooks/*` and `/public/v1/*`, and any request carrying a valid
platform operator token.

## Mail at runtime

Saved mail settings override `.env` on every send (only non-empty fields override). Mailer `smtp` sends through the saved host;
`log` and `array` record instead of sending; `sendmail` and the API mailers (`mailgun`, `ses`, `postmark`, `resend`) fail with
`not_configured` until their adapters exist.
