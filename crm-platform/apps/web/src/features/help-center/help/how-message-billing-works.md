---
id: how-message-billing-works
title: How message billing works
summary: How WhatsApp messages are paid for: the plan allowance, the wallet, when a charge or refund happens, and what stops a bulk send from starting.
area: account
order: 60
documents: [tile:wallet-message-billing]
keywords: [billing, wallet, per message, allowance, charge, refund, balance, currency, usage, metered]
---

## What it is for

This guide explains the rules behind the numbers on your wallet: what is free, what is charged, when the money moves and why a send can be refused. For the screens themselves, see [Wallet and statement](help:wallet-statement), [Wallet top-up](help:wallet-top-up) and [Message billing](help:message-billing-mode).

## Two ways messages are paid for

The **How billing works** card on the wallet screen says which one applies to your workspace.

- **Plan.** Your plan includes a number of messages every month. Messages inside that allowance are free. Each message beyond it is charged to your wallet. A plan with no maximum has no allowance to run out, and a plan that has ended no longer has an allowance. See [Plan and usage](help:plan-and-usage).
- **Pay per message.** Every delivered message is charged to the wallet, whatever your plan includes. This applies when you chose **Bill me through the platform** on [Message billing](help:message-billing-mode), or when your platform charges every workspace per message.

## What is charged, and when

- A message is charged when WhatsApp reports it **Delivered** or **Read**, not when you press send. Each message is charged once, however many updates arrive for it.
- If WhatsApp reports a failure after a charge was taken, the same amount is refunded once. A message that failed is not charged.
- The price depends on the recipient's country and the message category: Marketing, Utility, Authentication or Service. Some prices are zero, and a zero price is simply not charged.
- Only WhatsApp messages are charged. Messages your customers send to you, and messages on Telegram, Facebook or Instagram, are not.
- Everything that moves your balance appears on the statement: a **Message charge** line names the country, the category and where the message came from, such as Campaign, Broadcast, Flow, Scheduled or Chat. Refunds, top-ups and adjustments appear too.

## What is checked before a bulk send

Because the charge comes after delivery, an empty wallet could otherwise let a whole audience through for free. So a broadcast, a campaign or a scheduled message is checked when you launch it, and again when you resume or resend a campaign:

- If you are paying per message, or the plan allowance cannot cover the audience, the wallet must cover the estimated cost of the send. By default the balance must cover all of it.
- If the wallet is empty you see "Your message wallet is empty. Top up to start sending." If it is too low you see "Your wallet balance doesn't cover this send. Top up to start sending."
- A refused launch creates nothing, so there is nothing to clean up. Top up and launch again.

Single replies in the Team inbox are not checked against the wallet before they are sent. They are checked against your plan's monthly message limit instead. Once that limit is reached, a reply is refused with "Your plan's monthly message limit has been reached."

## Balance, top-ups and warnings

- The wallet screen shows the balance, about how many messages it covers, and what you spent and earned in the last 30 days. The balance also shows in the bar at the top of every page.
- When the balance is at or under your low-balance threshold, the wallet screen shows a warning. Workspace owners also get the notification **Low WhatsApp balance**, at most once every 6 hours. A top-up resets that.
- To add money, use **Add money** on the wallet screen. See [Wallet top-up](help:wallet-top-up).

## Currency

The wallet is kept in one currency, shown beside every amount, for example USD or INR. It follows the **Currency** set in **Workspace settings** by the workspace owner, as long as the platform can bill in that currency. Otherwise the wallet stays in the platform's own currency.

## Plan and access

Seeing the wallet needs the permission to view the wallet balance, and the statement needs its own permission. Buying credit and changing the plan are limited to roles that can buy, which by default is the Owner.

## If something looks wrong

- **The balance did not change after sending.** The charge is taken when WhatsApp reports the message delivered, so it can lag. Free messages never change it: those inside your plan allowance and those with a zero price. If delivery updates are missing altogether, see [Incoming messages or delivery updates are missing](help:whatsapp-incoming-missing).
- **I was charged for a message that failed.** The refund is a separate **Refund** line on the statement. If it is missing after a few minutes, contact support with the message time and number.
- **A launch is still refused after I topped up.** The top-up counts once its order is **Paid** in [Order history](help:order-history). A bank transfer needs approval first.
- **The wallet is in the wrong currency.** Check the currency in Workspace settings. If it is right and the wallet still shows another currency, the platform cannot bill in it yet. Ask support.
