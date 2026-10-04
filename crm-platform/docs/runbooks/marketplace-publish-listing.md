# Runbook: publish a Marketplace listing and write a connector recipe

For the platform operator and for the engineer who adds an integration. The API is in [../api/marketplace.md](../api/marketplace.md); the
catalogue lives in `marketplace_apps` and `marketplace_app_versions`. Everything below is done with the operator API
(`/v2/platform/marketplace`, bearer token of an MFA-enrolled operator): `platform.market.manage` to create and edit, `platform.market.review`
to approve and publish. The seed migration already ships categories and the Webhook listing; you never edit the database by hand.

## 1. Decide what you are publishing

| It is...                                              | Kind          | Connector type            | Needs a recipe                                     |
| ----------------------------------------------------- | ------------- | ------------------------- | -------------------------------------------------- |
| A tool that extends the product (a panel, a greeter)  | `mini_app`    | none                      | no                                                 |
| A portal or service that sends leads to us by webhook | `integration` | `webhook_relay` or `push` | yes                                                |
| A portal whose API we poll                            | `integration` | `pull`                    | yes                                                |
| A service the admin signs in to                       | `integration` | `oauth`                   | yes (not publishable yet)                          |
| Portal alert emails                                   | `integration` | `email_parse`             | yes (not publishable yet; needs the Email channel) |

`webhook_relay`, `push` and `pull` can be published today (the lead portals use `push` and `pull`: section 9). A listing of any other type can be
created, validated and approved, and `publish` answers `409 MKT_CONNECTOR_NOT_AVAILABLE`. That is on purpose: nothing that does not work is shown to a
workspace.

## 2. Verify the portal before you write the recipe (integrations)

A recipe is only as good as what the portal really does. For each lead portal, before any recipe is written, write down and keep with the
listing:

1. **Mechanism**: does the portal push to a webhook we give it, offer an API we poll with the customer's key, offer a partner API, or only
   send alert emails? Read `docs/specs/lead-portals-feasibility.md` first: it holds what was verified per portal, with its sources and a confidence
   rating. Where it says "not found", nothing is guessed and no recipe is shipped.
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

## 7a. Price it (free or paid per month)

A new listing is **free**. The developer's manifest `pricing` is only a proposal (the operator console shows it); what an app costs is set by an
operator holding `platform.market.pricing`, on the listing page or with `PUT /apps/:ref/pricing`. Pick a currency that is enabled on the platform
(the call refuses others). Setting a price creates the billing add-on that sells the app, so **configure and switch on a payment gateway first**
(Settings > Payment gateways; use the gateway's test mode until you have real credentials), or no workspace can pay. Then check the loop as a
workspace: the card shows the price, Install asks for a subscription, Subscribe lands on the checkout, and after a confirmed test payment the
install and consent step opens. To give a partner the app free use **Comp** on the subscriptions page; to stop selling to newcomers while
existing subscribers keep renewing turn **On sale** off; **a price change applies to new subscriptions and to the next payment**, never to a period
already paid for. Switching a paid app back to free keeps what subscribers paid for until it ends. The kill switch (section 7) also stops every
subscription of the app from renewing.

## 8. Reading health and the demand report

`GET /usage` shows per app the installations by status and health and the deliveries accepted, repeated, rejected and failed in 24 hours and
7 days: an app with many `error` or `needs_reauth` installations or a rising `failed` count is breaking (a portal changed its format, a key
expired); patch the recipe in a new version. `GET /requests` is the most-requested list: build order follows it. Mark a request `planned`,
`building`, `shipped` or `declined` with a note.

## What a recipe cannot do (and what to do instead)

- Run code. A portal that needs a custom transform, a signed request we do not support, or a multi-step login needs a small adapter in
  `apps/api/src/infra/providers/marketplace` (a new connector type or a change to one) written and reviewed as code; the recipe stays data.
- Be published while its connector type is only a framework (`oauth`, `email_parse`). When the first recipe of such a type has been verified against
  its portal, flip `implemented` on that type in its connector class in the same change that adds the recipe (`pull` was flipped with the portal
  recipes of section 9).
- Show a secret again. A lost secret is rotated (`rotate-secret`), a lost credential is entered again.

## 9. Worked example: adding a lead-portal recipe (IndiaMART)

A portal is **data plus tests**, and a seed migration when it ships with the platform. The steps, with IndiaMART (the best documented portal, and the
only one with both doors) as the example. Its recipe is in `packages/db/migrations/20261024090100_mkt_portal_recipes.sql`; the specs read that file.

**1. Write down what the portal documents, and what it does not.** From `docs/specs/lead-portals-feasibility.md`, IndiaMART publishes:

| Question       | IndiaMART's answer (official help pages)                                                                                                                                                                   | Goes into the recipe as                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Push           | the seller pastes an `https` address (an identifier may follow it) in Lead Manager, confirms an OTP; IndiaMART POSTs JSON, 10 s timeout, HTTP 200 = delivered, retries; deactivated after 48 h of refusals | `push` door: `path_token`, `mode: async` (answer at once, store first) |
| Pull           | `GET https://mapi.indiamart.com/wservce/crm/crmListing/v2/` with `glusr_crm_key`, `start_time`, `end_time` (`DD-MM-YYYYHH:MM:SS`, IST); answers HTTP 200 and a `CODE` in the body                          | `request`, `window.format`, `response.statusPath: CODE`                |
| Limits         | at most 7 days per request, 365 days of history, one request every 5 minutes, a key used more than 5 times in a minute is blocked for 15 minutes, a key unused for 7 days expires                          | `window.maxSeconds`, `maxLookbackSeconds`, `limits`, `errorMapping`    |
| Payload        | `{ CODE, STATUS, RESPONSE: {...} }` (an object when pushed, a list when pulled); `UNIQUE_QUERY_ID`, `QUERY_TIME`, `SENDER_*`, `QUERY_*`                                                                    | `mapping.itemsPath: RESPONSE`, `externalId`, the field rules           |
| Auth           | none documented for push (the secret goes in the path); `glusr_crm_key` for pull                                                                                                                           | `auth.scheme: path_token`; an `authFields` secret `crmKey`             |
| Not documented | an IP allow-list, a signature header, a latency figure                                                                                                                                                     | nothing is invented; the docs say so                                   |

Then the **honesty fields**: what is only proposed, and what the customer must do that we cannot (an account manager, an add-on, a key). They become the
listing's `maturity` and `notice` (IndiaMART: `stable` with a notice about the add-on and the 48 hour rule; JustDial: `needs_portal_setup`; TradeIndia:
`beta`).

**2. Choose the connector shape.** A portal that posts to us is `push`. A portal we ask is `pull`. IndiaMART is both, so it is a `pull` recipe with a
`push` block: one installation, one lead source, one mapping, and a lead that arrives by both doors is one lead. Set `delivery.mode: async` for any portal
that turns its sender off after failures; keep `sync` for a generic tool that retries.

**3. The request (pull).** Everything is a template over the declared auth fields and the window:

```json
"request": {
  "method": "GET", "baseUrl": "https://mapi.indiamart.com", "path": "/wservce/crm/crmListing/v2/",
  "query": { "glusr_crm_key": "{{cred.crmKey}}", "start_time": "{{window_start}}", "end_time": "{{window_end}}" }
},
"response": { "itemsPath": "RESPONSE", "statusPath": "CODE", "emptyStatuses": [204] },
"window": { "format": "DD-MM-YYYYHH:mm:ss", "utcOffsetMinutes": 330, "maxSeconds": 518400, "overlapSeconds": 1800,
            "initialLookbackSeconds": 86400, "maxLookbackSeconds": 31536000 },
"pollIntervalSeconds": 900,
"limits": { "minIntervalSeconds": 300, "requestsPerMinute": 5 },
"push": { "delivery": { "methods": ["POST"], "formats": ["json"], "mode": "async" } }
```

The window is how nothing is missed (a high-water mark, an overlap so a late-listed lead is still fetched) and how the portal's 7 day cap is kept (six days
here, to stay clear of the edge). A portal that wants a signed request declares `request.sign` (Housing.com: HMAC-SHA256 of the request time with the
secret key). A portal that pages declares `pagination`. A portal with no lead id declares `mapping.externalIdDerive` (a hash of the buyer, the project
and the portal's own time); never derive from OUR receive time, or a retry is a new lead.

**4. Error mapping: one rule per thing the portal documents**, most specific first, each with the code, whether to retry, the health and any stated penalty:
`429` + "Too Many Requests" is a 15 minute block (`retryAfterSeconds: 900`), another `429` waits 5 minutes, `401` + "expired" and any other `401` are
`needs_reauth` and `retry: false` (the connection stops and says why; entering the new key starts it again), `5xx` retries. The text a person reads is
`message`: write it for them ("Generate a new key in IndiaMART and enter it here"). Where the portal's own status is in the body, name it in
`response.statusPath`; the rules then match that number.

**5. The mapping.** Field names come from the portal's document, never from memory. IndiaMART: `UNIQUE_QUERY_ID` is the id (the same in push and pull),
`QUERY_TIME` is IST (`receivedAt` with `utcOffsetMinutes: 330`), `SENDER_MOBILE` falls back to the alternate numbers and goes through `phone`,
`SENDER_NAME` is nothing when it is "IndiaMART Buyer" (`ignore`), `QUERY_MESSAGE` may carry the two characters `\n` (`unescape`), `QUERY_TYPE` letters become
words (`map`) and the platform is `indiamart`. For a portal whose payload nobody has seen (JustDial, 99acres, MagicBricks, Shiksha, Sulekha) use
`mapping: { "mode": "auto", "platform": "justdial", "receivedAtApproximate": true, "utcOffsetMinutes": 330 }`: the usual names are read, everything else
is kept, the lead is labelled, and a lead with no time says so. Its setup text must say "send a sample so the mapping can be checked", and the first real
payload replaces the proposal with an explicit mapping in a new version.

**6. Plain-words setup instructions** (at most 12, 1000 characters each): what to ask the portal for and of whom; which key to paste and where it is; what the
portal does if we are slow or wrong (IndiaMART: Push is switched off after 48 hours); what we never do (store the portal login). They are the customer's
only documentation: the support guide `docs/runbooks/lead-portal-setup.md` repeats the same steps with the unverified ones marked.

**7. Test payloads and the specs.** Put one real-shaped example (invented people, never real ones) in `testPayloads`: it runs through the mapping for **Send
sample lead**, and `test/unit/marketplace/portal-recipes.spec.ts` maps every sample of every shipped recipe. Then add to `pull-engine.spec.ts` a fake of the
portal that follows its documented rules (`test/unit/marketplace/fake-portals.ts`: the parameters it checks, the answers it gives, the limits it
enforces) and assert what the connector asks for and what happens on each documented refusal. **No test talks to a real portal.** A fake is only as good as
the document: say in the spec header what it was written from.

**8. Ship it.** Author the recipe in a seed migration for a platform listing (a new `2026...` file, idempotent: insert version `1.0.0` published only for a
listing that is still an untouched draft, never overwrite an operator's edit), or publish it through the operator API (section 5) for a one-off. Then run, on a
throwaway workspace and the portal's sandbox when it has one: install, **Test connection**, **Send sample lead**, a real delivery (push) or **Sync now** (pull),
and look at the connection page (last sync, next poll, counters, health) and **Recent events**.

**9. Before you call it verified.** A recipe verified only against a fake is **not** verified against the portal: keep its `maturity` honest (`beta` until a pilot
customer's real account has produced a real lead through it, then `stable`), record in `docs/backlog.md` what the portal still has to confirm, and capture
the first real payload (with the customer's consent, personal data removed) as the next test payload.
