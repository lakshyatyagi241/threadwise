# Runbook: price and publish the Email (Gmail) integration, and give it Google credentials (operators and developers)

Email (the Gmail channel) is a **paid first-party Marketplace integration** (kind `integration`, category Messaging and email, connector type `client`): it is listed on the Marketplace Integrations tab, and its tile is in **Settings > Integrations** (not in the sidebar). It is sold like Forms is: a monthly subscription whose price the operator sets. On every database the migrations leave it **unpriced and
unpublished**, so no workspace can see or buy it, and every workspace answers `PLAN_FEATURE_LOCKED` on the Email routes. That is by design: the price is
the platform operator's decision, so nothing is hard-coded. Plan and rules: [../threadwise-port/plan/channel-email-build.md](../threadwise-port/plan/channel-email-build.md);
the marketplace side: [../api/marketplace.md](../api/marketplace.md); the deviation from Reference:
[../threadwise-port/parity/product-extensions.md](../threadwise-port/parity/product-extensions.md) (row 23).

Two independent things must be done before a workspace can connect a mailbox: **sell the integration** (sections 1 to 4) and **give the platform a Google OAuth client**
(section 5). Either one missing leaves Email locked or "not set up".

**On a local development database, one command does the selling part:** `pnpm --filter @crm/api build && pnpm --filter @crm/api seed:email -- --workspace <slug>`
(price 499 INR, billing add-on pack, plan visibility, publish, and a comped subscription for that workspace so the Email tile in Settings > Integrations unlocks). See
[dev-seed-marketplace-apps.md](dev-seed-marketplace-apps.md). Below is what it does, as the console / operator API steps (the manual fallback, and what a real
environment uses). No workspace used the Gmail channel before it existed, so there is **nothing to comp** except the workspaces you pick.

## What the migrations already did

| Migration                              | Effect                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261118090000_mail_mailboxes`        | the `mail_mailboxes` table and the rest of the channel's tables                                                                                                                                                                                                                                                                                                      |
| `20261118090100_mail_permissions`      | the keys `mail.mailboxes.read` and `mail.mailboxes.manage`, tagged with the plan feature `email_channel`                                                                                                                                                                                                                                                             |
| `20261118100100_mkt_email_app`         | the listing `email` as a **draft** (seeded as a mini app, converted by the next row), `paid_monthly`, **price not set**, `grants_plan_features: [email_channel]`, `grandfather_existing: false`, category Inbox and chat, version `1.0.0` draft (scopes `email.read`, `email.write`); `email_channel: false` and `email_mailboxes: 3` on every plan row              |
| `20261119120000_mkt_email_integration` | converts that listing to an **integration** in place: kind `integration`, category Messaging and email, connector type `client` (the Google sign-in and the mailbox sync are built into the Email screen, so the listing issues and receives nothing), the manifest without surfaces plus a client recipe; the price, status and pricing model are left as they were |

## 1. Set the price (operator console, Marketplace, the `email` listing)

The price is yours to choose. The local seed uses 499 INR a month as a placeholder. Open the listing `email` and use **Pricing**. Or the operator API
(`platform.market.pricing`, an MFA-enrolled operator's bearer token):

```http
PUT /v2/platform/marketplace/apps/email/pricing
{ "rowVersion": <the listing's>, "model": "paid_monthly", "amount": "499.00", "currency": "INR", "trialDays": 0, "purchasable": true }
```

This creates the billing add-on pack that sells the integration (`mkt_email`). The currency must be enabled on the platform. Publishing is refused with
`409 MKT_VERSION_STATE` / `price_not_set` until this is done. Email has no cost per use on the platform's side (mail is not metered against the message cap
or the wallet), so a trial is safe to offer.

## 2. Show the billing add-on on the plans that should offer it

A workspace sees a paid listing in its Marketplace only if its plan makes the billing add-on that sells it visible. In the console, **Plans > edit a plan > Add-ons**, tick the Email pack
on each plan that may buy it, and save.

Check the cap on the plan's **Limits** tab: **Email mailboxes** (`email_mailboxes`) is 3 on plan rows that existed at migration time. A plan created later
starts with **no cap (unlimited)**: set it. A workspace override can raise or lower it per workspace. A disconnected mailbox does not count.

## 3. Approve and publish

Review is a separate permission (`platform.market.review`):

```http
POST /v2/platform/marketplace/apps/email/versions/<versionId>/submit     (manage)
POST /v2/platform/marketplace/apps/email/versions/<versionId>/approve    (review)
POST /v2/platform/marketplace/apps/email/publish                         (review)
```

The first-party manifest asks for `email.read` and `email.write`; the person who installs may only grant scopes whose permission keys they hold themselves
(`MKT_SCOPE_EXCEEDS_INSTALLER`).

## 4. Comp workspaces (design partners, your own test workspace)

- `POST /v2/platform/marketplace/apps/email/subscriptions/comp` `{ "workspaceId": "<organization uuid>", "months": null, "note": "design partner" }`
  (`platform.market.pricing`) gives the integration to one workspace without a payment. `months: null` has no end date.
- Or, for a throwaway database only, give the workspace the feature directly with a plan override of `email_channel: true`.

When a paid subscription lapses the workspace keeps its connected mailboxes and conversations, but sending and syncing stop and the Email routes answer
`PLAN_FEATURE_LOCKED` until it is renewed.

## 5. Google credentials (the OAuth client)

Once per platform, not per workspace. Email uses its **own** Google OAuth client, separate from the Google Calendar one, because the Gmail scopes are
**restricted** and need Google's own verification, which should not hold up the Calendar client. The steps for the client itself are the same as in
[google-calendar-setup.md](google-calendar-setup.md); what differs is below.

1. In [Google Cloud Console](https://console.cloud.google.com/) create (or pick) a project owned by the company and enable the **Gmail API**.
2. _OAuth consent screen_ (External). Add exactly these scopes:

   | Scope                                            | Why                                      |
   | ------------------------------------------------ | ---------------------------------------- |
   | `openid`, `.../auth/userinfo.email`              | show which Google account is connected   |
   | `https://www.googleapis.com/auth/gmail.readonly` | read the mail that becomes conversations |
   | `https://www.googleapis.com/auth/gmail.send`     | send a reply from the connected mailbox  |

3. Verification. `gmail.readonly` and `gmail.send` are **restricted** scopes. Until Google verifies the Google app (privacy policy, a demo video of the consent flow,
   a justification per scope, and for restricted scopes an independent security assessment), only test users you list can connect, a grant ends after 7 days
   in Testing, and an unverified app is capped at 100 users. Start this early; plan for weeks, not days. Publish the app (_In production_) once verified.
4. _Credentials, Create credentials, OAuth client ID_, type **Web application**. **Authorised redirect URIs**: add exactly the address the console shows
   (_Admin, Settings, Gmail_, "Redirect URI"). By default it is

   ```
   <APP_URL>/v2/public/email/google/callback
   ```

   It must match character for character (scheme, host, path, no trailing slash) or Google stops at `redirect_uri_mismatch`. Register one per environment.

5. Give the client to the platform, either (read in this order; a field left empty falls through to the next):
   - **Console:** _Admin, Settings, Gmail_: paste the client ID and the client secret, leave _Allow workspaces to connect Gmail_ on, save. The secret is
     stored encrypted and never shown again; a blank field on a later save keeps it.
   - **Environment:** `GOOGLE_MAIL_CLIENT_ID` and `GOOGLE_MAIL_CLIENT_SECRET` on the API and the worker (optionally `GOOGLE_MAIL_REDIRECT_URI`). Restart the processes.

The console's switch turns Gmail off for every workspace without deleting the client: no mailbox can be connected, no mail is read or sent, and the stored
mailboxes and conversations are kept. Turning it back on resumes.

## Check it works

On a staging workspace that owns the integration (comped), with a Google account that is a test user (or after verification):

1. _Settings, Integrations, Email_ (the hub): **Connect a mailbox**. Google shows the consent screen listing the Gmail permissions; accept all. You land back on Email with the
   mailbox connected.
2. Send a mail to that address from another account. Within about a minute it is a conversation in the team inbox, on a channel named after the mailbox.
3. Reply from the inbox. The reply arrives in the same Gmail thread.
4. Connect a fourth mailbox on a plan with the default cap of 3: it is refused with the plan-limit message.
5. In the Google account's _Security, Third-party access_ remove the app: the mailbox shows **Needs reconnecting** after the next sync. **Reconnect** restores it.

None of this has been run against a real Google account yet (the repository's tests use a local stand-in written from Google's documentation), so treat this
checklist as the first real acceptance run and report anything that differs.

## Problems

| What you see                                                   | Cause and fix                                                                                                    |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Email routes answer `PLAN_FEATURE_LOCKED`                      | the workspace does not own the integration: comp it or subscribe (section 4), and check the listing is published |
| Connect says the platform has no Google credentials            | section 5 not done, or the console switch is off                                                                 |
| Google page says `redirect_uri_mismatch`                       | the redirect URI on the client differs from the one the console shows (APP_URL, scheme, trailing slash)          |
| Google page says `access_blocked` / "app not verified"         | the app is in Testing and the person is not a test user, or it is unverified past the 100-user cap               |
| A mailbox shows **Needs reconnecting** a week after connecting | the consent screen is still in Testing: Google ends grants after 7 days                                          |
| Publishing is refused with `price_not_set`                     | do section 1 first                                                                                               |
