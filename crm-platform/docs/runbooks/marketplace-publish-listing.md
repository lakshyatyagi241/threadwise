# Runbook: publish a Marketplace listing and write a connector recipe

For the platform operator and for the engineer who adds an integration. The API is in [../api/marketplace.md](../api/marketplace.md); the
catalogue lives in `marketplace_apps` and `marketplace_app_versions`. Everything below is done with the operator API
(`/v2/platform/marketplace`, bearer token of an MFA-enrolled operator): `platform.market.manage` to create and edit, `platform.market.review`
to approve and publish. The seed migration already ships categories and the Webhook listing; you never edit the database by hand.

## 1. Decide what you are publishing

| It is...                                              | Kind          | Connector type            | Needs a recipe                                        |
| ----------------------------------------------------- | ------------- | ------------------------- | ----------------------------------------------------- |
| A tool that extends the product (a panel, a greeter)  | `mini_app`    | none                      | no                                                    |
| A portal or service that sends leads to us by webhook | `integration` | `webhook_relay` or `push` | yes                                                   |
| A portal whose API we poll                            | `integration` | `pull`                    | yes (not publishable until the first one is verified) |
| A service the admin signs in to                       | `integration` | `oauth`                   | yes (not publishable yet)                             |
| Portal alert emails                                   | `integration` | `email_parse`             | yes (not publishable yet; needs the Email channel)    |

Only `webhook_relay` and `push` can be published today. A listing of any other type can be created, validated and approved, and `publish`
answers `409 MKT_CONNECTOR_NOT_AVAILABLE`. That is on purpose: nothing that does not work is shown to a workspace.

## 2. Verify the portal before you write the recipe (integrations)

A recipe is only as good as what the portal really does. For each lead portal, before any recipe is written, write down and keep with the
listing:

1. **Mechanism**: does the portal push to a webhook we give it, offer an API we poll with the customer's key, offer a partner API, or only
   send alert emails? (IndiaMART, JustDial, 99acres, MagicBricks, Housing.com and Shiksha are draft listings whose planned mechanism is a plan,
   not a fact.)
2. **Authentication** the portal uses (a header token, a signature, a key in the query) and where the customer finds it.
3. **Payload**: one real example, the sender's own lead id, the time field, whether one delivery carries several leads, the field names of name,
   phone, email, message and campaign.
4. **Limits**: delivery retries, rate limits, any IP allow-list. A portal that needs a **signed partner agreement or whitelisted IPs** is a
   per-connector checklist item, not a blocker for the framework (spec 6.4); note it on the listing.
5. **Errors**: the status codes and bodies for a wrong key, an expired key and "slow down".

## 3. Write the manifest

```json
{
  "manifestVersion": 1,
  "id": "acme-leads",
  "name": "Acme Leads",
  "kind": "integration",
  "category": "lead-sources",
  "version": "1.0.0",
  "description": "Receive Acme portal enquiries as leads in your workspace.",
  "scopes": ["leads.write"],
  "pricing": { "model": "free" },
  "support": { "website": "https://example.com/acme", "docs": "https://example.com/acme/docs" },
  "connector": { "type": "push" }
}
```

Ask for the **fewest scopes** that work: the admin sees each in plain words, and a later version that asks for more makes every
installation wait for a new consent. A lead source needs `leads.write` only. Plan gating is set on the listing (`planFeature`), not in the
manifest.

## 4. Write the recipe

```json
{
  "schemaVersion": 1,
  "key": "acme-leads",
  "name": "Acme Leads",
  "category": "lead-sources",
  "logo": "https://example.com/acme-logo.png",
  "connector": {
    "type": "push",
    "auth": { "scheme": "header_token", "header": "X-Acme-Key", "credentialField": "portalKey" }
  },
  "authFields": [
    {
      "key": "portalKey",
      "label": "Portal key",
      "kind": "secret",
      "required": true,
      "help": "From Acme > Settings > Integrations."
    },
    { "key": "account", "label": "Account id", "kind": "text", "required": false }
  ],
  "mapping": {
    "mode": "explicit",
    "itemsPath": "queries",
    "externalId": { "from": "query.id" },
    "receivedAt": { "from": "query.time" },
    "fields": [
      { "to": "name", "from": "query.sender_name", "required": true },
      { "to": "phone", "from": "query.sender_mobile", "transform": ["phone"], "required": true },
      { "to": "email", "from": "query.sender_email", "transform": ["trim", "lower"] },
      { "to": "message", "from": "query.message" }
    ],
    "attribution": { "platform": { "const": "acme" }, "campaign": { "from": "query.campaign" } }
  },
  "rateLimits": { "perMinute": 120 },
  "errorMapping": [],
  "setupInstructions": [
    {
      "title": "Copy the address",
      "body": "Paste the webhook address below into Acme > Integrations > Webhook."
    },
    {
      "title": "Paste the key",
      "body": "Enter the portal key above. Acme sends it with every lead."
    }
  ],
  "testPayloads": [
    {
      "name": "One lead",
      "payload": {
        "queries": [
          {
            "query": {
              "id": "q-1",
              "sender_name": "Ravi",
              "sender_mobile": "98765 43210",
              "message": "Need a quote"
            }
          }
        ]
      }
    }
  ]
}
```

Rules the API enforces when you save it (every problem comes back with its path):

- `key`, `category` and `connector.type` equal the manifest's `id`, `category` and `connector.type`.
- **Auth fields**: a `secret` field is sealed and never returned (the admin sees "set, ends in ####"); a `text` field is shown as typed. A push
  recipe whose portal gives the customer a key names that field in `connector.auth.credentialField` (it must be a `secret` field); with none, the
  platform generates the connection's secret and shows it once.
- **Mapping**: `auto` is the generic webhook. A portal recipe maps explicitly. Paths are `a.b[0].c` only. `phone` turns `98765 43210` into
  `+919876543210` (`defaultCountryCode` defaults to `91`). Mark `required` the fields without which a lead is useless (usually the phone or the email):
  an item missing one is **rejected and counted**, never silently dropped. Give `externalId` whenever the portal has its own lead id; without it a
  hash of the body is the id (a repeat of the same body is still a duplicate).
- **Addresses** (pull and OAuth only): https, a public DNS name, the default port, no credentials, no query. At save time every address the name
  resolves to must be public, and the check runs again before every call. A recipe is never a way to reach the platform's own network.
- **Templates** (pull): `{{cred.<field>}}`, `{{config.<key>}}`, `{{cursor}}`, `{{since_iso}}`, `{{now_iso}}`. A name the recipe does not declare is
  refused. Values are URL-encoded in the path.
- **Error mapping**: match a status, a status range or a text in the answer, and say the code, whether to retry, and the health it causes
  (`degraded`, `error`, `needs_reauth`). A refusal that retrying cannot fix should be `needs_reauth` and `retry: false`.
- **Test payloads** (at most five, 8 KB each) are what **Send sample lead** and **Test connection** run through the mapping. Put a real example
  there: it is also your regression test.

## 5. Create, review, publish

```
POST /v2/platform/marketplace/apps                       { manifest, recipe, tagline, listing, firstParty, planFeature? }   (manage)
POST /v2/platform/marketplace/apps/:ref/versions/:v/submit                                                                   (manage)
POST /v2/platform/marketplace/apps/:ref/versions/:v/approve   { note? }                                                      (review)
POST /v2/platform/marketplace/apps/:ref/publish                                                                              (review)
```

`listing` carries the long description, highlights, screenshots (https links) and the **data-processing disclosure** (what the app stores,
where, how it is deleted: the DPDP statement shown on the app page). A rejected version comes back with the reviewer's reason; edit it with
`PUT .../versions/:v`, submit again. Publishing re-validates, retires the previous published version, and for every installation either moves it
to the new version (it asks for no new scopes) or sets it waiting for the admin's consent. The answer says how many of each.

**Test it on a throwaway workspace before you publish to everyone**: create the listing, approve and publish it, install it from a test
workspace with the real API, press **Send sample lead** and look at the lead; point the portal's sandbox at the address and look at **Recent
events** (delivery id and outcome). If the portal offers no sandbox, do this with the sample payload and a captured real one.

## 6. Ship a new version

`POST /apps/:ref/versions` with the same `id`, a **higher** `version` and a changelog the admin will read ("what changed in the last version"
is on the app page). If it asks for more scopes, say why in the changelog: every installation keeps running on the old version until its admin
accepts. If it asks for fewer or the same, installations move to it at once.

## 7. Hide, kill, restore

- **Hide** (`POST /apps/:ref/hide`): the listing leaves browse and search; existing installations keep working. Use it to stop new installs.
- **Kill** (`POST /apps/:ref/kill { reason }`): the emergency stop. In one transaction the listing becomes `killed`, every installation becomes
  `killed`, every connection becomes `disabled`, and each workspace gets an audit row and an event. The delivery address answers 410 from the next
  request on. Use it when an app leaks data, misroutes leads or its portal asks us to stop. Workspaces can then only uninstall.
- **Restore** (`POST /apps/:ref/unkill`): the listing becomes `hidden`. Fix it, publish a new version, and workspaces **install it again**: killed
  installations are never switched back on by a new version.

## 8. Reading health and the demand report

`GET /usage` shows per app the installations by status and health and the deliveries accepted, repeated, rejected and failed in 24 hours and
7 days: an app with many `error` or `needs_reauth` installations or a rising `failed` count is breaking (a portal changed its format, a key
expired); patch the recipe in a new version. `GET /requests` is the most-requested list: build order follows it. Mark a request `planned`,
`building`, `shipped` or `declined` with a note.

## What a recipe cannot do (and what to do instead)

- Run code. A portal that needs a custom transform, a signed request we do not support, or a multi-step login needs a small adapter in
  `apps/api/src/infra/providers/marketplace` (a new connector type or a change to one) written and reviewed as code; the recipe stays data.
- Be published while its connector type is only a framework. When the first `pull`, `oauth` or `email_parse` recipe has been verified against
  its portal, flip `implemented` on that type in its connector class in the same change that adds the recipe.
- Show a secret again. A lost secret is rotated (`rotate-secret`), a lost credential is entered again.
