# Wallet charging rules

What draws on a workspace's wallet, how it is priced, when it is free, and what happens when it fails. Owner's model of 2026-10-25.
Code: `apps/api/src/modules/wallet-message-billing/` (`wallet-rules.ts`, `usage-rules.ts`, `message-billing.service.ts`, `usage-billing.service.ts`).
Prices are set by the operator (Platform > Wallet > Pricing). Defaults below are what a fresh install charges.

## What is charged

| Area                                                      | Price                                                            | Free part                                                                          | Failed or undelivered                                                            |
| --------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| WhatsApp message                                          | Meta's cost for the country and category, plus the plan's margin | Plan's monthly messages (`monthly_messages`); none in pay-per-message mode         | Not charged. A charge is refunded; a free message gives its allowance place back |
| Website chatbot message                                   | 0.10 each (`webbot_message`)                                     | Plan's `webbot_messages` per month (10,000 / 20,000 / 50,000 on the seeded ladder) | Not applicable                                                                   |
| AI (every feature on the platform's key)                  | Vendor cost + 20%                                                | None                                                                               | Refunded only if the producer reports it failed                                  |
| Translation (paid services)                               | Vendor cost + 20%                                                | None                                                                               | As AI                                                                            |
| SMS                                                       | 0.50 per segment                                                 | None                                                                               | Charged anyway                                                                   |
| Email (inbox, campaigns, reminders, lead replies, quotes) | 0.15 per email                                                   | None                                                                               | Charged anyway                                                                   |
| WhatsApp call, voice call                                 | 1.00 per started minute                                          | Unanswered call is free                                                            | Not applicable                                                                   |
| Contact lookup                                            | 0.20                                                             | None                                                                               | Not applicable                                                                   |
| Telegram, Facebook, Instagram, LINE, Viber, WeChat        | 0 (tracked, free until priced)                                   | n/a                                                                                | Not applicable                                                                   |

A WhatsApp message is charged from `sent`. Meta does not bill a failed message, so a `failed` report gives the charge back.

## WhatsApp margin by plan

Plans are ranked by price when the migration runs: free plan, the cheapest paid plan, anything between, the dearest plan (a custom-quote plan counts as dearest).

| Rung          | Margin over Meta |
| ------------- | ---------------- |
| Free          | 40%              |
| Cheapest paid | 30%              |
| Middle        | 20%              |
| Dearest       | 10%              |

A plan with no margin of its own uses the platform default (20%). Margin pricing is the default mode; an operator can still choose fixed prices, and a stored choice is kept. Where Meta's cost for a country is unknown, the typed price applies.

## Rules that hold everywhere

- One path: the feature reports `usage.reported` (or `message.delivery_reported` for WhatsApp); the worker prices and charges it once per id. The worker must run.
- An empty wallet blocks the work before it happens (422 `WALLET_EMPTY`), unless the plan allowance covers it. The chatbot answers with its fallback line instead of erroring.
- A charge is never below 0.01. Platform-owned workspaces are never billed.
- Never refund on a callback the workspace signs itself: it would let a tenant send free.
- No producer may name a charge by a client-controlled id.

## Where each number lives

| Number                                              | Where                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| SMS, email, call, lookup, chatbot prices; AI markup | Platform > Wallet > Usage prices (`wallet.usage_rates`)            |
| WhatsApp margin per plan                            | Platform > Wallet > Margins                                        |
| Free WhatsApp messages                              | Plan editor, Messaging, `monthly_messages`                         |
| Free chatbot messages                               | Plan editor, Messaging, `webbot_messages` (0 or blank = none free) |

## Not charged yet (decide)

The storefront cart-recovery nudge and the catalog sends and order acknowledgements (WhatsApp over the customer's own token, mostly inside the 24 h window); the WhatsApp call-permission request; WeChat mass sends (one call, many recipients); the sign-up OTP (no workspace yet, a platform cost). Store notifications and offers through the commerce sender and quote emails are charged as of this change.
