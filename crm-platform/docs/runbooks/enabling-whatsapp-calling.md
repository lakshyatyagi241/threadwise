# Runbook: enabling WhatsApp calling for a number

For the platform operator and the workspace admin. Calling code and screens: [../threadwise-port/wiring/calling-voice.md](../threadwise-port/wiring/calling-voice.md); API:
[../api/calling-voice.md](../api/calling-voice.md); build notes and the manual test checklist:
[../threadwise-port/plan/calling-number-readiness-build.md](../threadwise-port/plan/calling-number-readiness-build.md).

Nothing in this runbook was run against a real Meta account or a real phone from this repository: every Meta call in the tests is a fake that
returns what Meta's documentation says. The first real number is a trial. Do it with a test number or a spare line first, and read Meta's own
calling documentation for anything that has changed since this was written (Meta moves calling limits and country rules).

## 0. What has to be true, in one list

| #   | Where it is decided   | What                                                                                                                          | Shown on the card as            |
| --- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| 1   | This platform         | The workspace's plan has the feature `waba_calling`                                                                           | Plan includes WhatsApp calling  |
| 2   | This platform         | The number is connected (token and phone number id stored)                                                                    | Number connected                |
| 3   | Meta                  | The number runs on the Cloud API only, not also in the WhatsApp Business app (coexistence) and not on the old On-Premises API | Number is on the Cloud API only |
| 4   | Meta                  | The number is registered and verified and Meta reports it as `CONNECTED`                                                      | Number registered with WhatsApp |
| 5   | Meta                  | The daily messaging limit is at least 2,000 customers (a test number is exempt); the quality rating is not red                | Messaging limit and quality     |
| 6   | The stored token      | It holds both `whatsapp_business_management` and `whatsapp_business_messaging`, and does not expire soon                      | Access token permissions        |
| 7   | Meta                  | The app is subscribed to the WhatsApp Business Account                                                                        | App subscribed to this account  |
| 8   | Meta app and platform | The app's webhook delivers the `calls` field to this platform's callback                                                      | Calls webhook delivered         |
| 9   | Meta                  | Calling is `ENABLED` for the number, with the call icon visible                                                               | Calling switched on at WhatsApp |
| 10  | The platform operator | A TURN relay is in `CALLING_ICE_SERVERS`, so people behind strict firewalls hear audio                                        | Call relay (TURN) configured    |
| 11  | This workspace        | At least one active person holds `call.calls.use`                                                                             | Teammates allowed to call       |
| 12  | This workspace        | If call recording is on, its notice and consent rule are written                                                              | Recording and consent rules     |

Rows 1 to 9 and 11 to 12 are checked for every number by Settings, Calling (and the card on the number's health page); row 10 is the platform's.

## 1. Meta app (once per platform)

Do this on the Meta app the platform uses (`META_APP_ID`, saved on the console **WhatsApp** page).

1. The app has the **WhatsApp** product, is in live mode, and the business that owns it is verified (a verified business is what lets the
   messaging limit rise above the starting tiers).
2. **Webhook.** App Dashboard, WhatsApp, Configuration, Webhook: the callback URL and verify token are the ones the console WhatsApp page shows
   (`WABA_WEBHOOK_PUBLIC_URL` or `APP_URL`, plus the path). Under **Webhook fields**, `messages` and **`calls`** are subscribed (and the coexistence
   and Groups fields if you use those features).
   - If the app already has a callback but not `calls`, you do not need to touch Meta: the platform's worker adds `calls`, and only `calls`, to the
     app's fields in the background check that follows a connect and on the schedule (one worker at a time, under a lock). A person's **Check again**
     only reads it and never rewrites the app, so a workspace cannot change a Meta app shared by every workspace. The platform never sets a callback
     on an app that has none: that first subscription is yours, from the console **WhatsApp** page (the webhook status and its subscribe action, super admin only).
   - A number on a customer's own Meta app, or reached through a provider (Interakt, Pinnacle), is a warning on the card: this platform cannot read
     or change that app's webhook. Open that app's settings (or ask the provider) and tick `calls`.
3. **Permissions.** The system user (or Embedded Signup token) has `whatsapp_business_management` and `whatsapp_business_messaging`. Tokens
   from Embedded Signup are exchanged by the platform; a manually saved token must be a **permanent system user token** with both.

## 2. The number (once per number)

1. Onboard it as usual (Embedded Signup or manual connect, Channels, WhatsApp). The connection must be on the **Cloud API only**: a number that is
   also used in the WhatsApp Business app (coexistence) is refused by Meta for calling. To move such a number, register it on the Cloud API only
   (this ends its use in the app) or use another number for calling.
2. Verify the number's ownership code if the health page asks for it, and wait for Meta to show it as connected.
3. **Messaging limit.** Meta needs a daily limit of at least 2,000 customers before it lets calling be switched on. A new number starts lower
   and rises with sending volume and quality, and with business verification. A **test number** from the Meta app dashboard does not need the limit.
4. Region: Meta restricts business-initiated calls to and from some countries and the list changes. Check Meta's current calling documentation
   before you onboard a number or test against a phone in a restricted country; such a refusal shows Meta's own sentence, because no stable Meta code for it is mapped yet.

## 3. TURN and ICE (once per platform)

The browser's call needs a relay when either side is behind a strict NAT or firewall. Without TURN the call can connect and be silent. The list is
the environment variable `CALLING_ICE_SERVERS` (API and worker), a JSON list of `{ "urls", "username", "credential" }`; empty means the four
public STUN servers only.

```
CALLING_ICE_SERVERS=[{"urls":["stun:stun.l.google.com:19302","turn:turn.example.org:3478?transport=udp","turns:turn.example.org:5349?transport=tcp"],"username":"calling","credential":"<a long random secret>"}]
```

A minimal coturn that fits (on a host with a public address):

```
listening-port=3478
tls-listening-port=5349
min-port=49152
max-port=65535
realm=turn.example.org
lt-cred-mech
user=calling:<a long random secret>
cert=/etc/letsencrypt/live/turn.example.org/fullchain.pem
pkey=/etc/letsencrypt/live/turn.example.org/privkey.pem
```

Open UDP and TCP 3478, TCP 5349 and UDP 49152 to 65535. Notes:

- The credential is served to the browser of every person who holds `call.calls.use` (that is how a browser gets it), so it is a shared
  secret of the people you trust to call. Use a TURN account used only for this, and rotate it by changing the variable and restarting.
- The card's **Call relay (TURN)** row is a warning, not a block: no TURN is legitimate for a first test on an open network. It says
  "not complete" when a TURN server has no username or credential, and "not a valid list" when the JSON does not parse (the platform then
  uses public STUN only and says nothing else, so look at the card).
- Meta's own media server is on the public internet, so only the browser side needs the relay.

## 4. Turn it on, in the app

1. Settings, **Calling**. Each WhatsApp number has a **Ready for calls?** checklist. Select **Check again** to read Meta now.
2. Fix anything marked **Fix this** (the line under it says what to do), check again until the badge says **Ready to turn on**.
3. Select **Enable calling**. WhatsApp is asked first; the card changes only after it accepts. The switch is Meta's own setting
   (`POST /{phone_number_id}/settings`, `calling.status = ENABLED`).
4. **Automatic.** The switch above the numbers, **Turn calling on automatically after a number is connected**, is off by default. When it is on,
   the platform switches calling on for a number that is connected or reconnected and meets every requirement, and writes it to the audit
   log. A workspace without the plan feature is never switched on, whatever the setting says.
5. **Place a test call** (shown once calling is on and the number is not blocked). Type your own WhatsApp number, select **Call me**. WhatsApp
   only allows a business to call a person who allowed it: if you have not, a permission request goes to your phone and no call is placed. Tap
   **Allow**, then **Call me** again. Allow microphone access in the browser.

## 5. How to verify end to end

1. **Inbound.** From a phone, tap the call icon in the chat with the business number. Everyone with the right to use calling sees the incoming
   call popup in the inbox; the first to accept takes it. If nothing rings, the card's **Calls webhook delivered** and **App subscribed to this
   account** rows are where to look, then the platform's webhook log.
2. **Outbound.** The test call above, or the Call button in a chat. The call appears in Call logs when it ends.
3. **The webhook door.** `GET /v2/public/webhooks/wa-calling` echoes Meta's challenge for the right verify token (the same door as the main
   WhatsApp callback).

## 6. When something is wrong

The card shows the state of each requirement; Meta's refusals have a stable reason that the screens turn into words. What each one means:

| Reason shown                                         | Meta said                                                    | Do                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------------- |
| "WhatsApp will not switch calling on yet..."         | a prerequisite is missing (limit, subscription, permissions) | read the card: the row that says Fix this is the missing prerequisite |
| "...shares its line with the WhatsApp Business app"  | error 141000: not a Cloud API number                         | register it on the Cloud API only or use another number               |
| "The access token lacks a permission..."             | error 10 or 200 to 299, or sub-code 1349174                  | new system user token with both permissions, reconnect                |
| "WhatsApp no longer accepts the stored access token" | error 190                                                    | reconnect the number or save a new permanent token                    |
| "Calling is not switched on at WhatsApp..."          | error 138000                                                 | **Enable calling**                                                    |
| "This customer has not allowed calls yet..."         | error 138006                                                 | nothing: a permission request is sent; the customer taps Allow        |
| "WhatsApp limits how often you can ask..."           | error 138009                                                 | wait; do not ask the same customer again at once                      |
| "This customer's WhatsApp cannot receive calls"      | error 138001                                                 | ask them to update WhatsApp or turn calls on                          |
| "WhatsApp did not answer in time"                    | no answer or a 5xx                                           | try again                                                             |

A refusal that none of these names shows Meta's own sentence as it came; if you see one often, add its code to `calling-meta-errors.ts` with a
test (the codes above are the ones this code knows; others fall through to Meta's words).

Other things to know:

- A **check never switches calling on**. Only **Enable calling**, the automatic switch after a connect, or Meta itself changes the setting. A check
  does bring this workspace's switch in line with what Meta says, in either direction, and writes that to the audit log: a number somebody turned off
  at Meta stops showing the Call button, and a number turned on there starts showing it.
- Checks run: when a number is connected or reconnected (about 20 seconds later), when the card is opened and its result is older than 15
  minutes, on **Check again**, and by a worker every minute for the numbers that are due (30 minutes after a blocked number, 3 hours after one
  needing attention, 6 hours after a ready one). A workspace whose plan lacks calling is looked at once a day and Meta is not asked at all.
- Business hours and the call icon visibility are Meta settings of the number. Calling hours are not managed here; the card only warns when the
  call icon is hidden from customers.
