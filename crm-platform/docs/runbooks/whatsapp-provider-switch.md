# Runbook: add a WhatsApp provider (BSP) and switch a workspace to it

For the platform operator. API reference: [../api/whatsapp-providers.md](../api/whatsapp-providers.md). Needs the platform permissions
`platform.whatsapp_providers.view` (read), `.manage` (providers, default, assignments, test) and `.switch` (move numbers); the Super
Admin and Admin roles hold all three.

Nothing in this runbook was run against a live BSP account: the first real switch is a trial. Do it on a test workspace first.

## 0. What you are changing, in one minute

- A **provider** is a row: address, API version, how the platform authenticates (a bearer token or its own headers), whose credential
  does it (the platform's partner token, or each number's own token), and how its webhooks prove themselves.
- A new number connects through: the workspace's override, else the **registry default**, else the platform setting on the console
  **WhatsApp** page (`WABA_DEFAULT_PROVIDER`). With no override and no default nothing changed since before the registry existed.
- A connected number stays on the provider it was connected under until you **switch** it. Changing a default or an override never
  moves a live number.
- The two built-in providers, `meta` and `interakt`, are the platform's existing routes. Their address, version and secrets are edited on
  the console WhatsApp page, not here.

## 1. Add the provider

1. Get from the BSP: the API base URL (`https://...`, public DNS name), the API version, how it authenticates (header names, e.g.
   `x-api-key: <token>`), the partner token, whether it signs webhooks (and with what: a Meta-style `X-Hub-Signature-256` with an app
   secret, or a secret in a header you name), and whether it accepts a media upload.
2. `POST /v2/platform/whatsapp-providers`:

```json
{
  "key": "pinnacle",
  "label": "Pinnacle BSP",
  "baseUrl": "https://api.pinnacle.example-bsp.com/wa",
  "apiVersion": "v24.0",
  "authScheme": "custom_headers",
  "headerTemplates": {
    "x-api-key": "{{providerToken}}",
    "x-waba-id": "{{wabaId}}",
    "x-phone-number-id": "{{phoneNumberId}}"
  },
  "credentialMode": "platform_token",
  "webhookMode": "number_level_override",
  "signatureScheme": "shared_secret_header",
  "signatureHeaderName": "x-bsp-secret",
  "billingMode": "provider_credit_line",
  "capabilities": { "mediaUpload": false },
  "onboarding": "embedded_signup",
  "credentials": { "providerToken": "...", "webhookSecret": "...", "verifyToken": "..." }
}
```

- The secrets are sealed on save and never come back (you see `set` and the last four characters). To change one, send it again; to
  remove one, `clearCredentials: ["webhookSecret"]`.
- A bearer-only provider: `"authScheme": "bearer"`, no header templates.
- A provider where each number keeps its own token (a proxy in front of Meta): `"credentialMode": "channel_token"`; use
  `{{channelToken}}` in a header, or `bearer`.
- If the BSP signs nothing, set `"signatureScheme": "none"`: only the secret in the callback URL (`?k=`) then authenticates its
  deliveries. Leave the default (`meta_app_secret_sha256`) when it signs, and store its `appSecret`: with no secret stored, every
  delivery of that provider is refused (fail closed).
- An address that is not `https`, not a public name, or that resolves to a private address is refused (422 `WAP_BASE_URL_REFUSED`).

3. Register the platform's webhook with the BSP: `<public origin>/v2/public/webhooks/whatsapp` (`webhookPath` in the answer). One URL
   serves every provider and every workspace.
4. **Test it**: `POST /:id/test` with `{ "wabaId": "<a test WABA id>" }` (and `"channelToken"` for a `channel_token` provider). It makes
   one authenticated `GET <baseUrl>/<apiVersion>/me`; pass `"path"` for a read the BSP actually has. `ok: true` means it answered 2xx
   with your credential. A 401 or 404 shows the BSP's own words (secrets removed). Fix the address, headers or token and test again.
5. **Activate it**: `POST /:id/activate` `{ "rowVersion": n }`. It needs its partner token first if it is `platform_token`.

## 2. Point new numbers at it

- Everyone: `POST /:id/default` makes it the registry default (at most one). `DELETE /default` goes back to the console setting.
- One workspace: `PUT /workspaces/:workspaceId/assignment` `{ "providerId": "<id>" }`. `DELETE` the same path to follow the default.
- A number connected from now on uses it. Numbers already connected do not move. `GET /assignments` shows, per workspace, its override,
  the effective provider and how many numbers sit on another one.

## 3. Switch a workspace's existing numbers

1. **Dry run**: `POST /workspaces/:workspaceId/switch` `{ "targetProviderId": "<id>", "dryRun": true }`. For each number it says
   `ready` or `blocked` and why:
   - `number_token_needed`: the target uses each number's own token and this number has none. Have the workspace paste one on the
     number's health page (or reconnect), then dry-run again.
   - `provider_token_needed`: the target has no partner token stored: add it (step 1) first.
   - `ids_missing`: the connection has no WABA or phone number id; reconnect it.
   - `reconnect_needed`: the number is disconnected. It is only re-pointed; the workspace must reconnect it before it can send.
2. **Check the queue**: nothing waits for a switch, but pick a quiet moment. A send that is in flight when the number is re-pointed
   finishes through the old route or fails and retries through the new one.
3. **Apply**: the same call with `"dryRun": false` (optionally `"setOverride": true` so numbers the workspace connects later follow, and a
   `"reason"` that goes into the audit trail). Per number:
   - the webhook is re-subscribed through the **new** provider first; if that fails the number is `failed` and untouched, and the
     answer says why;
   - otherwise it is re-pointed, with an audit row naming you and the outbox event `whatsapp.connection.connected`, so the inbox
     channel stays linked and keeps its history;
   - `inboundWired: false` or a message about the app-level callback means the BSP accepted the subscription but not a per-number
     callback: set the callback on the BSP/Meta app to the webhook URL above.
4. **Verify**: send a test message from the workspace, then watch for the delivery receipt and an inbound reply (they arrive on
   `/v2/public/webhooks/whatsapp` and must pass the provider's signature scheme). `GET /v2/waba/numbers/:id/health` (the workspace's
   own view) shows whether inbound is wired.

## 4. Roll back

Switch back: `POST /workspaces/:workspaceId/switch` with the previous provider as `targetProviderId` (the per-number answer named it as
`from`; or pass `fromProviderId` = the new one to move exactly what you moved). A number keeps every credential it ever had (its own
token, the Interakt partner key), so a rollback needs nothing new for a `channel_token` route; a `platform_token` route needs its token
stored. Message history, message ids and receipts do not depend on the provider and are untouched either way.

If the BSP itself is down and you must stop traffic through it: **disable** it (new numbers stop going to it; numbers on it keep
sending, so this does not stop them), then switch the workspaces away. There is no "pause" that blocks sending through a provider; the
emergency halt is the platform's send halt, not this registry.

## 5. Retire a provider

When no number and no workspace override uses it (`GET /` shows `numberCount` and `workspaceCount`): `POST /:id/archive`. A default
cannot be archived: clear it first (`DELETE /default`). Archived providers no longer route; a number still on one reads as having no
usable credentials until it is switched.

## Gotchas

- The registry is read by each process every 15 seconds. A worker may take up to 15 seconds to notice a new provider or a changed
  token. A number whose provider the process does not know triggers a reload, so "create, then switch" works.
- `billingMode` is a label (it points at the reseller billing engine's modes). Switching a provider does **not** move a Meta credit
  line or change the wallet; do that in the reseller console if the billing arrangement differs.
- A custom provider cannot upload a template header example, and the "renew token" / "verify token" helpers on the number page talk to
  Meta Graph only. Say so to the workspace before moving it.
- The WABA built-in `interakt` route registers the WABA with Interakt (`tp-signup`) during a switch; a custom provider relies on the BSP's
  own onboarding.
