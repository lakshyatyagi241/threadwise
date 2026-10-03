# WhatsApp provider registry API

The platform operator chooses which WhatsApp Business Solution Provider (BSP) the SaaS sends through, per platform and per workspace,
and can move a workspace's connected numbers from one provider to another, all from the admin panel. This is an owner-requested
extension of the WABA module (`docs/wadesk-port/parity/product-extensions.md`, item 17); the WhatsApp number API is
[whatsapp-cloud-api-waba.md](whatsapp-cloud-api-waba.md), the runbook is
[../runbooks/whatsapp-provider-switch.md](../runbooks/whatsapp-provider-switch.md).

Operator bearer JWT (platform session, MFA enrolled). Errors are problem+json; branch on `code`. Schemas:
`packages/contracts/src/whatsapp-providers/`. Nothing here was exercised against a live BSP account: the tests run against a stand-in
HTTP server and recorded shapes.

## How it relates to the existing WhatsApp settings

Nothing is replaced. The WABA module still reaches a number through its two built-in routes, `meta` (Graph, the number's own token)
and `interakt` (partner key and headers), configured by the environment (`WABA_ENV`) and overridden by the console **WhatsApp**
settings page (`META_APP_ID`, the Interakt partner key, `WABA_DEFAULT_PROVIDER`, ...). The registry sits on top:

| Question                                                                | Answer                                                                                                                                                                                         |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which provider does a NEW number use?                                   | The workspace's override, else the registry default, else the platform setting (`WABA_DEFAULT_PROVIDER` / the console page). With no override and no default the registry changes nothing.     |
| Which provider is an EXISTING number on?                                | `wa_provider_configs.meta_json.provider_key`. Numbers connected before the registry have none: their old `provider` value (`interakt`, anything else `meta`) is the key, so they keep working. |
| Where do the two built-in providers' address, version and secrets live? | On the console WhatsApp page / `WABA_ENV`. The registry rows `meta` and `interakt` mirror them read-only (values are read live, never copied). Label, notes and billing mode are editable.     |
| Where do a custom provider's secrets live?                              | Sealed in the registry (`whatsapp_providers.credentials_enc`, CryptoService). Write only: responses say `set` and the last four characters.                                                    |

Built-in `meta` and `interakt` go through the existing code paths unchanged. A custom provider (a Graph-compatible BSP: same paths and
payloads as the Cloud API) is sent through `WabaHttp` with a resolved descriptor: the provider's base URL and version, headers rendered
from its templates with the number's values, and the token of its credential mode.

## Provider fields

| Field                                                 | Meaning                                                                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`                                                 | Stable id, `^[a-z][a-z0-9_-]{1,39}$`, unique. `meta` and `interakt` are taken.                                                                                                                                                                                                                                              |
| `adapterKind`                                         | `meta_graph` (the only one): Meta Graph paths and payloads, directly or behind a proxy.                                                                                                                                                                                                                                     |
| `baseUrl`, `apiVersion`                               | `https://host[/prefix]` and `vNN.N`. See "Address rules".                                                                                                                                                                                                                                                                   |
| `authScheme`                                          | `bearer`: `Authorization: Bearer <token>`. `custom_headers`: `headerTemplates` rendered per call.                                                                                                                                                                                                                           |
| `headerTemplates`                                     | Header name to value; placeholders `{{providerToken}}`, `{{channelToken}}`, `{{wabaId}}`, `{{phoneNumberId}}`. A header whose value is not known on a call is left out, never sent as a literal placeholder.                                                                                                                |
| `credentialMode`                                      | `platform_token`: the provider's own token (a partner token) authenticates, customers hold none. `channel_token`: each number's own access token authenticates.                                                                                                                                                             |
| `webhookMode`                                         | `number_level_override`: after subscribing the WABA the platform sets the callback per number through the provider (`webhook_configuration`). `meta_app_level`: only subscribe; the callback is set once on the Meta app.                                                                                                   |
| `signatureScheme`, `signatureHeaderName`              | How this provider's deliveries prove themselves: `meta_app_secret_sha256` (`X-Hub-Signature-256`, the provider's `appSecret`), `shared_secret_header` (the named header carries `webhookSecret`), `none` (only the URL secret `?k=`). Unsigned deliveries are refused for the first two. Default: `meta_app_secret_sha256`. |
| `billingMode`                                         | A label that points at the reseller billing engine (`provider_credit_line`, `customer_direct` = engine `meta_direct`, `meta_reseller` = engine `reseller`). Recorded and shown; **it changes no billing behaviour**.                                                                                                        |
| `capabilities.mediaUpload`                            | Whether the provider takes a media upload (otherwise files go by public link). Read by the media pipeline and shown to workspaces.                                                                                                                                                                                          |
| `onboarding`, `onboardingAppId`, `onboardingConfigId` | `manual` or `embedded_signup`, with the platform Meta app's public ids.                                                                                                                                                                                                                                                     |
| `status`                                              | `active`: selectable. `disabled`: not offered for new numbers or assignments; numbers already on it **keep sending**. `archived`: retired, refused while a number or workspace uses it. New providers start `disabled`.                                                                                                     |
| `isDefault`                                           | At most one (partial unique index). Must be active.                                                                                                                                                                                                                                                                         |
| `credentials`                                         | Write: `{ providerToken, appSecret, webhookSecret, verifyToken }` (8 to 4096 printable characters). Read: `{ <name>: { set, last4 } }`. `clearCredentials: [names]` removes some.                                                                                                                                           |

## Endpoints (`/v2/platform/whatsapp-providers`)

| Method and path                              | Permission                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /`                                      | `platform.whatsapp_providers.view`   | Every provider (built-in ones included) with `numberCount` and `workspaceCount`.                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `GET /:id`                                   | `.view`                              | One provider.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `POST /`                                     | `.manage`                            | Add a provider (starts `disabled`). 409 `WAP_PROVIDER_KEY_TAKEN`, 422 `WAP_BASE_URL_REFUSED`.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `PATCH /:id`                                 | `.manage`                            | Change it; `rowVersion` required (409 `ROW_VERSION_CONFLICT`). Absent secrets keep their value. A built-in provider only takes `label`, `notes`, `billingMode` (409 `WAP_PROVIDER_BUILTIN`). `credentialMode` cannot change while numbers are on the provider (409 `WAP_PROVIDER_IN_USE`).                                                                                                                                                                                                                                  |
| `POST /:id/activate` `/disable` `/archive`   | `.manage`                            | Body `{ rowVersion }`. Activating a `platform_token` provider needs its token (409 `WAP_CREDENTIALS_MISSING`). The default cannot be disabled or archived (409 `WAP_PROVIDER_IS_DEFAULT`). Archiving needs no number and no override on it (409 `WAP_PROVIDER_IN_USE`); built-in providers cannot be archived.                                                                                                                                                                                                              |
| `POST /:id/default`                          | `.manage`                            | Make it the default for new numbers. Active only (409 `WAP_PROVIDER_DISABLED`).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `DELETE /default`                            | `.manage`                            | Clear the default: new numbers follow the platform setting again. Answers the list.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /:id/test`                             | `.manage`                            | One authenticated `GET <baseUrl>/<apiVersion><path>` (default `/me`). Body `{ path?, wabaId?, phoneNumberId?, channelToken? }`: the ids and token only fill header placeholders for this call and are forgotten. Answer `{ provider, result: { ok, testedAt, latencyMs, httpStatus, errorCode, message } }`; the message has every secret replaced by `[redacted]`. The last result is kept on the provider (`lastTest`). A refusal to even call (address refused, credential missing) is `ok: false`, not an error status. |
| `GET /assignments`                           | `.view`                              | Workspaces (keyset paged; `search`, `overrideOnly`) with override, effective provider and numbers on another provider.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `PUT /workspaces/:workspaceId/assignment`    | `.manage`                            | Body `{ providerId, note? }`: the provider new numbers of the workspace connect through. Existing numbers do not move.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `DELETE /workspaces/:workspaceId/assignment` | `.manage`                            | Clear the override.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /workspaces/:workspaceId/switch`       | `platform.whatsapp_providers.switch` | Move the workspace's connected numbers to another provider. See below.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Tenant-safe read, for the workspace's own screens: **`GET /v2/waba/provider-info`** (permission `waba.numbers.read` or
`waba.numbers.connect`) answers `{ newNumbers: { providerKey, providerLabel, credentialMode, capabilities, onboardingMethods } | null,
numbers: [{ id, label, phoneNumber, providerKey, providerLabel, credentialMode, capabilities }] }`. It names the provider and says
whether media upload is supported and whose credential is used. It never carries an address, header, id of the provider's or secret.

Permissions are platform-staff keys (`platform_permissions`, system keys, granted to the Super Admin and Admin roles by the migration;
other roles get them in the role editor). A staff role without the key gets 403 `RBAC_PLATFORM_PERMISSION_REQUIRED` naming it.

## Address rules (SSRF)

A provider's address is typed by an operator and every call to it carries a credential, so it must not be a way into the platform's own
network. Enforced when a provider is saved, when it is tested, and **before every call** through it:

- `https` only, default port, no credentials, query or fragment;
- a public DNS name: no IP literal, no `localhost`, no single-label name, no `.local .internal .lan .svc .test ...` suffix;
- the name must resolve, and **every** address it resolves to must be public (private, loopback, link-local, carrier-grade NAT,
  multicast and reserved ranges, IPv4-mapped and NAT64 forms included, are refused);
- header templates may not name hop-by-hop or framing headers (`host`, `content-length`, `transfer-encoding`, ...), may not hold
  control characters, and only the four placeholders exist; a rendered value with a line break refuses the call.

Development only: `WABA_PROVIDER_ALLOW_PRIVATE_HOSTS=true` accepts plain `http` on `localhost` / `127.0.0.1` and skips the DNS check so a
stand-in server can be used. It is **ignored when `NODE_ENV=production`**. Resolving and then connecting is not atomic (a rebinding DNS
server could answer differently the second time); the check narrows the window to one request and `https` stops a rebound address from
presenting a certificate for the provider's name.

## The switch

`POST /workspaces/:workspaceId/switch`, body `{ targetProviderId, fromProviderId?, numberIds?, dryRun?, setOverride?, reason? }`.

- Numbers are the workspace's connected WABA numbers not already on the target (optionally only those on `fromProviderId`, or the
  `numberIds`). At most 50 per request. None to move: 409 `WAP_SWITCH_NOTHING_TO_DO`. The target must be active (409 `WAP_PROVIDER_DISABLED`).
- **Dry run** changes and calls nothing and answers, per number: `state` (`ready` | `blocked`), `requirements`
  (`number_token_needed`: the target is `channel_token` and the number holds no token; `provider_token_needed`: the target has no
  partner token stored; `ids_missing`; `reconnect_needed`: the number is disconnected), and whether the webhook would be re-subscribed.
- **Apply**, per number, one at a time:
  1. a number with a blocking requirement is `blocked` and untouched;
  2. a connected number is re-subscribed through the new route first (`subscribed_apps`, then the per-number callback when the
     provider's `webhookMode` is `number_level_override`; for the built-in Interakt target the WABA is also registered with Interakt);
     if that fails the number is `failed` and **nothing is changed**;
  3. otherwise `meta_json.provider_key` is set (and the number's `provider`, `provider_switched_at`, `provider_switched_from`), and
     the audit row (`audit_log`, module `wa_provider_configs`, actor = the operator, with `reason`) and the outbox event
     `whatsapp.connection.connected` (`{ connectionId, provider, providerKey, fromProviderKey, reconnect: true, switched: true }`)
     are written in the same transaction, so the inbox channel stays linked;
  4. a disconnected number is only re-pointed (`repointed`), without the event (it must not be revived); it needs a reconnect.
- `channel_token` numbers keep their token; a `platform_token` target needs only the provider's token. A number keeps all its stored
  credentials, so **rolling back is switching back** (the per-number answer names the provider it came from).
- `setOverride: true` also makes the target the workspace's override, so numbers connected later follow.
- The operator trail is a `security_events` row `platform.whatsapp_providers.workspace_switched` (counts, no secrets).

Provider messages already sent keep their provider message ids and receipts; nothing about history changes.

## Webhooks

The one public door stays `/v2/public/webhooks/whatsapp` (GET handshake, POST receiver). Numbers on the built-in routes keep their rule
(Meta signature or the URL secret). For every number named in a payload that is on a **registry** provider, that provider's
`signatureScheme` is the rule (and the URL secret alone no longer suffices unless the scheme is `none`); a payload whose provider is gone
from the registry verifies nothing and is refused. The GET handshake accepts the platform verify token or a provider's own `verifyToken`.
Register `<public origin>/v2/public/webhooks/whatsapp` (the response's `webhookPath`) with the BSP.

## Operations notes

- The registry is read into memory by each process (`WabaRegistryRoutes`) and refreshed every 15 seconds and after any write through
  the API of that process; a worker sees a change within 15 seconds. A number whose provider key is unknown to a process triggers a
  reload (at most every 2 seconds), so a provider created and used moments later works.
- Sending, the inbox adapter, the media pipeline, template calls, broadcasts and the node-bridge Cloud API transport all resolve a number's
  route through the registry. Not supported through a custom provider: uploading a template header example (refused with a clear
  message), renewing or verifying a pasted token (Meta Graph only), the Interakt `tp-signup` registration (built-in Interakt only).
- `platform_settings` is not used; the registry's data is in `whatsapp_providers` and `org_whatsapp_provider_assignment`
  (migration `20261018090000_whatsapp_providers`).
