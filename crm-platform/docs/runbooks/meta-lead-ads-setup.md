# Runbook: Meta lead ads (set up the Meta app, connect a Page, test with the Lead Ads Testing Tool)

For the operator who holds the Meta app. Everything here uses the **same Meta app, secret and webhook the Facebook Pages channel already uses**; there
is no separate Meta credential and no new environment variable. API and behaviour: [api/meta-lead-ads.md](../api/meta-lead-ads.md).

> **Status: not yet verified against Meta.** The code was tested against a fake of Meta's Graph API and a real database; no request has been made
> to Meta from this build. Step 5 is how to do the first real test with the approved app. Meta's dashboard wording changes: if a label below
> differs, follow the intent (callback URL + verify token + the `leadgen` field on the `Page` object).

## 1. What the app needs

In the Meta app (developers.facebook.com) the following permissions need **Advanced access** and the app must be **Live** for leads from people
who are not app admins or testers:

| Permission              | Why                                                         |
| ----------------------- | ----------------------------------------------------------- |
| `leads_retrieval`       | read the leads (approved for this app)                      |
| `pages_manage_ads`      | lets the Page token reach the Page's lead forms             |
| `pages_read_engagement` | read side of the Page                                       |
| `pages_show_list`       | list the Pages the person manages (the Facebook channel)    |
| `pages_manage_metadata` | subscribe the Page to webhook fields (the Facebook channel) |

The person who connects the Page in the product must be able to open that Page's leads in Meta (a Page role with **Leads access** in Meta Business
Suite / the Page's settings). Without it Meta answers with a permission error and the Page shows **needs lead access**.

## 2. Environment (API and worker processes)

Read from the same place the Facebook channel reads them (`apps/api/src/infra/providers/channel-facebook/facebook-graph.client.ts`). Set them on
**both** the API and the worker (the worker fetches the leads):

| Variable                                                 | Meaning                                                                                                                                  |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `FB_APP_ID` (else `META_APP_ID`)                         | the Meta app id                                                                                                                          |
| `FB_APP_SECRET` (else `WHATSAPP_APP_SECRET`)             | the app secret: signs the webhook (`X-Hub-Signature-256`) and exchanges the login code                                                   |
| `FB_WEBHOOK_VERIFY_TOKEN` (else `WHATSAPP_VERIFY_TOKEN`) | the string you type in the Meta dashboard as the verify token                                                                            |
| `FB_GRAPH_VERSION` (else `META_GRAPH_VERSION`)           | Graph version, default `v21.0`                                                                                                           |
| `FB_CONFIG_ID` (optional)                                | a Login-for-Business configuration; when set, Meta takes the login's permissions from it: add the lead permissions to that configuration |
| `APP_URL`                                                | the public https origin of the API; the webhook and the login callback are built from it                                                 |
| `WEB_APP_URL`                                            | the public origin of the web app: where the login returns the person                                                                     |

A WhatsApp-only install that has `WHATSAPP_APP_SECRET` and `WHATSAPP_VERIFY_TOKEN` and no `FB_*` values already works: they are the fallbacks. Nothing
is hard-coded and nothing is stored in the repository; `.env.example` lists the variable names only.

## 3. Register the webhook and the login in the Meta app dashboard

1. **Facebook Login > Settings > Valid OAuth Redirect URIs:** add `https://<API origin>/v2/facebook/callback` (the Facebook channel's callback;
   the lead-access login reuses it, so if Pages already connect, this is already there).
2. **Webhooks > Page** (object `Page`, not User or Instagram):
   - Callback URL: `https://<API origin>/v2/facebook/webhook`
   - Verify token: the value of `FB_WEBHOOK_VERIFY_TOKEN` (or its fallback). **Verify and save** calls `GET /v2/facebook/webhook`; a wrong token is 403.
   - Subscribe to the field **`leadgen`** (the Facebook channel already uses `feed`, `messages`, ...).
     The screen **Settings > Channels > Social leads > Ads > Meta lead forms** shows this callback URL and whether the verify token is set. The exact
     address is `GET /v2/meta-lead-ads` -> `webhookUrl`.
3. The app secret signs every delivery; this build refuses an event with a missing or wrong signature (403) as soon as a secret is configured.

## 4. Connect a Page and pick a form (in the product)

1. **Settings > Channels > Social leads > Ads > Meta lead forms.** Needs the plan features Lead sources and Facebook/extra channels, and the roles
   `leads.sources.manage` and `fb.pages.manage`.
2. **Grant lead access** (or **Connect a Facebook Page** the first time). A Page connected before this feature has no lead permission: this login
   asks for it again (`auth_type=rerequest`). Accept every permission in Facebook's dialog and choose the Page(s).
3. **Turn on lead sync** for the Page. This subscribes the Page to `leadgen` without removing its Messenger and comment fields, and reads the
   subscription back; it fails with Meta's own words if Meta did not accept it.
4. **Choose lead forms**, **Pick** a form, check **Map fields**, and set the owner and deal rules (**Assignment and deal**). The form becomes a source on
   the **Webhook** tab (kind "Meta lead forms").

## 5. First real test with Meta's Lead Ads Testing Tool

1. Open <https://developers.facebook.com/tools/lead-ads-testing>, sign in as a person with Leads access on the Page, choose the **Page** and the
   **form** you picked, fill in the fields and **Create lead**. The tool creates a real test lead and sends the `leadgen` webhook; its **Track status**
   shows whether Meta delivered it to your callback and what we answered.
2. In the product, within seconds: the contact exists (source "Facebook"), the lead appears in the source's **Leads received**, the Page shows a
   **Last lead** time and the source's **Meta lead form health** card shows "Receiving".
3. If nothing arrives: the table below. Meta also keeps a lead for about 90 days, so the **sweep** (every 10 minutes) brings in a lead whose
   webhook was missed once the Page is healthy. To bring one in at once, open **Lead inbox**, then **Sync now** next to the form. To bring in
   leads from before the form was picked (up to 90 days, which is as far as Meta keeps them), use **Backfill...** there: the leads become
   contacts and are assigned and notified like new ones, but they are **not** sent the automatic first message unless they are younger than the
   form's limit (one hour by default, set under the form's first message setting).
4. Delete the test lead in the tool and the test contact in the product afterwards.

| Symptom                                              | Likely cause and fix                                                                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Meta's "Verify and save" fails                       | verify token differs from `FB_WEBHOOK_VERIFY_TOKEN` (or its fallback) on the API, or the API is not reachable on https at `APP_URL`           |
| Tool says delivered, product shows 403 in Meta's log | `FB_APP_SECRET` (or the fallback) differs from the app's secret: the signature does not match                                                 |
| Delivered, no contact                                | Page not **subscribed** (state), the form not picked, its source paused, lead sync off, or the worker is not running / has no Meta app values |
| State **needs lead access**                          | the Page was connected without the lead permissions, or the connecting person lacks Leads access: run **Grant lead access** again             |
| State **needs reconnect**                            | the Page token was revoked, the password changed, or the 90 day data-access window lapsed: **Reconnect** (same login)                         |
| `needs_review` lead                                  | the form has no email or phone question the mapping can read: fix **Map fields**, then **Retry** the lead in the source                       |
| Instagram form lead missing                          | Instagram placements use the Facebook Page's lead form: pick the form on the Page; no separate Instagram connection is needed                 |

## 6. What this does not verify

No real Meta call was made while building this: Graph field names (`leadgen_forms`, `custom_disclaimer`, `custom_disclaimer_responses`,
`platform`), the `subscribed_apps` read-back and the `time_created` filter follow Meta's documented shapes, but only the fake exercised them. The
adapter retries a lead without `platform` and the disclaimer responses when a Graph version rejects them (code 100). If the first real lead shows a
shape this build did not expect, one of two things happens: Meta's answer cannot be read as a lead at all, so nothing is stored and the Page shows
Meta's refusal as its last error; or it is read but does not map, so the lead is stored `needs_review` with its raw payload (open it in the source to
see Meta's answer) and can be retried after the mapping is fixed.
