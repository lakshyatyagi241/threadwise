# First real Meta / Interakt run

Nothing in this repo has talked to the real Meta or Interakt yet. Do these in order; each stage proves more than the one before,
and a failure at a stage tells you exactly which layer to look at. Run them on a machine that can reach `graph.facebook.com`
(the cloud session's network policy blocks it).

## What you need

| For | You need |
| --- | --- |
| Stage 1 (adapters only) | a WABA id, a phone number id, a System User token with `whatsapp_business_messaging` + `whatsapp_business_management`, a phone you can read WhatsApp on |
| Stage 2 (full stack, manual connect) | the above, plus Docker (Postgres, Redis) |
| Stage 3 (Embedded Signup + inbound) | the Meta app's id, secret and Embedded Signup config id; for the Interakt route also the partner key and solution id; a public HTTPS URL (tunnel) |

Use a Meta **test number** (WhatsApp > API Setup in the Meta app) if you do not want to touch a production number. A test number can only
send to up to five phone numbers you have verified in the dashboard.

## Stage 1: adapters against real Meta, no stack (5 minutes)

```bash
cd crm-platform
corepack pnpm install --frozen-lockfile --prefer-offline
corepack pnpm --filter "@crm/api^..." build
cd apps/api
export WABA_ID=<waba id> WABA_PHONE_ID=<phone number id> WABA_TOKEN=<system user token>
export META_APP_ID=<app id> META_APP_SECRET=<app secret>      # optional: adds token inspection
corepack pnpm waba:smoke                                         # read only: phone + templates
corepack pnpm waba:smoke --create-template                       # creates, reads back, deletes crm_smoke_<time>
corepack pnpm waba:smoke --send-template=<your number, digits>   # Meta's hello_world
corepack pnpm waba:smoke --send-text=<your number, digits>       # only inside the 24 h window (message the number first)
```

Interakt route: `export WABA_ROUTE=interakt INTERAKT_PARTNER_AUTH_KEY=<key>` instead of `WABA_TOKEN`.

Read the output as:

| Output | Meaning |
| --- | --- |
| `read phone number` fails, code 190 | token wrong or expired |
| `read phone number` fails, code 100 | wrong phone number id, or the token cannot see it |
| `platform=ON_PREMISE` | register the number on the Cloud API in WhatsApp Manager first |
| `create template` fails, code 100 / subcode 2388xxx | Meta rejected the payload: send me the full line |
| `create template` fails, code 200 / 3 | the app lacks `whatsapp_business_management` Advanced Access |
| `send hello_world` fails, 131030 | the recipient is not on the test number's allowed list |
| `send hello_world` fails, 133010 | the number is not registered: set `WABA_PIN=<6 digits>` and rerun |
| send passes, nothing arrives | the number is in a restricted state; check the quality and tier lines |

When this stage passes, the adapters are proven against Meta. Tell me which steps passed (and paste any failing lines with the code).

## Stage 2: the whole stack with a pasted token

```bash
cd crm-platform
corepack pnpm dev            # API :3000, worker, web :3001 (see the setup skill for the first-time database steps)
```

1. Sign in, open **Channels > WhatsApp numbers** (`/channels/whatsapp`).
2. Add WABA account > paste Phone Number ID, WABA ID and token > **Verify token** (all lines should be green) > **Probe + connect**.
3. Open the number's **Health**: overall should be Healthy; if inbound shows "not wired" you have not given Meta a public URL yet (Stage 3).
4. Create a broadcast with the connected number as sender and an approved template, send to your own number, and watch the receipts
   move queued > sent > delivered > read. Delivery receipts also need Stage 3 (they come in through the webhook).

## Stage 3: inbound, receipts and Embedded Signup

1. Start a tunnel (`cloudflared tunnel --url http://localhost:3000` or ngrok) and set `WABA_WEBHOOK_PUBLIC_URL=https://<tunnel>`.
2. In the console open **Settings > WhatsApp** (`/admin/settings/whatsapp`): enter Meta App ID, App Secret, Embedded Signup Config ID; for
   Interakt the solution id and partner key. The page shows the **Webhook URL** and **Verify token**.
3. Meta app dashboard > WhatsApp > Configuration: paste both, subscribe to `messages` and `message_template_status_update`.
   Facebook Login: allow the web origin of this platform. Add the staging/prod domain to the app's allowed domains (Shubham's note).
4. Back on the numbers page use **Continue with Facebook** (Embedded Signup). Then **Fix inbound** should turn the badge green.
5. Send a message to the number from your phone: the worker log shows the ingest job; until the inbox exists it is logged and dropped.

## Things only a real run can settle (guesses in the code)

* whether Interakt accepts `verify_token` inside `webhook_configuration` (the code falls back without it on a 4xx);
* whether Interakt signs forwarded webhooks and with which secret (the code accepts a signature or the URL key);
* whether `GET {interakt}/{phone}?fields=...` returns every field in the health call;
* template edit, `business_compliance_info` and header media upload on Interakt.
