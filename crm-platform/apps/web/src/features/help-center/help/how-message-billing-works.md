---
id: how-message-billing-works
title: How billing works
summary: How your wallet pays for WhatsApp messages, SMS, email, calls and AI: the plan allowance, what each costs, when charges and refunds happen, what pauses work.
area: account
order: 60
documents: [tile:wallet-message-billing]
keywords: [billing, wallet, per message, allowance, charge, refund, balance, currency, usage, metered, sms, email, call, ai, translation, lookup, expenses, website chatbot, webbot, margin]
---

## What it is for

This guide explains the rules behind the numbers on your wallet: what is free, what is charged, when the money moves and why a send or a request can be refused. For the screens themselves, see [Expenses, wallet and statement](help:wallet-statement), [Expenses](help:message-expenses) and [Wallet top-up](help:wallet-top-up).

## Two ways WhatsApp messages are paid for

The **How billing works** card on the wallet screen says which one applies to your workspace.

- **Plan.** Your plan includes a number of messages every month. Messages inside that allowance are free. Each message beyond it is charged to your wallet. A plan with no maximum has no allowance to run out, and a plan that has ended no longer has an allowance. See [Plans](help:account-plans).
- **Pay per message.** Every WhatsApp message is charged to the wallet, whatever your plan includes. Messages are billed through the platform: your wallet and subscription pay for them.

Two things have a plan allowance: WhatsApp messages and website chatbot messages (each with its own number). Everything else below is charged to the wallet from the first unit.

## What is charged, and when

- A WhatsApp message is charged when WhatsApp accepts it for sending, not when you press send and not later when it is delivered. Each message is charged once, however many updates arrive for it.
- If WhatsApp reports a failure after a charge was taken, the same amount is refunded once. A message that failed is not charged. SMS, email and the other chat channels are not refunded: their fee is taken when the message is accepted.
- The price depends on the recipient's country and the message category: Marketing, Utility, Authentication or Service. When the platform prices WhatsApp as Meta's own price plus a margin, the margin depends on your plan: the smaller the plan, the larger the margin, and the top plan pays the least. Your plan page and the platform's pricing say which margin applies to you.
- A WhatsApp message that fails is not charged, and it does not use up a place in your plan allowance either.
- Messages your customers send to you are never charged.
- Everything that moves your balance appears on the statement: a **Usage charge** line names what it was for, such as the country and category of a WhatsApp message, an SMS, an email or an AI feature. Refunds, top-ups and adjustments appear too.

## What else uses the wallet

Each of these is a charge on top of anything you already pay your own provider. Each appears on the expense log under its **Type**.

- **SMS.** Every segment of a text, charged when the carrier accepts it. A segment is 160 characters, or 70 for text in a non-Latin script. The charge is not refunded if the carrier later reports the text undelivered.
- **Email.** Each email you send, from the inbox, a campaign, a reminder, an instant reply to a new lead, or a quote or estimate you email to a customer. A bounced email keeps its charge.
- **Website chatbot messages.** Your plan includes a number of visitor messages the website chatbot handles free each month. Each one beyond that is charged to the wallet. An AI chatbot also pays for the AI it uses, under **AI** below. If the allowance is used up and the wallet cannot pay, the chatbot answers with its fallback message until you top up.
- **WhatsApp calls.** Every minute a call has started, once the call ends. A call of 61 seconds is two minutes. A call nobody answered is free.
- **Phone calls from your telephony provider.** The same per-minute charge, for calls your provider reports as completed. A call you log by hand is only a record and is never charged.
- **AI.** Replies, summaries, lead scoring, contact search, template and campaign writing, images, the flow generator, knowledge base indexing and search, the website chatbot and the AI steps of a flow, whenever they run on the platform's own AI account. The charge is what the AI vendor charged plus a markup set by the platform, by default 20%. A workspace that saved its own AI key pays its vendor directly and the wallet is not touched.
- **Translation** by a paid translation service. Free services are never charged.
- **Contact lookups** with the platform's data provider, once per contact.
- **Telegram, Facebook, Instagram, LINE, Viber and WeChat.** These messages are listed on the expense log. They are charged only when the platform has set a price for them.

Never charged: anything inbound, calls you typed in by hand, messages in the test chat, WhatsApp sent from a personal number linked by QR code, and the platform's own emails to you such as password resets.

The platform sets each price. A price of zero, or a charge the platform has switched off, is still listed on the expense log as **Not billed**.

## What is checked before work starts

Because most charges come after the work, an empty wallet could otherwise let a whole audience or a long run through for free. So:

- A broadcast, a campaign or a scheduled message is checked when you launch it, and again when you resume or resend a campaign. If you are paying per message, or the plan allowance cannot cover the audience, the wallet must cover the estimated cost of the send. By default the balance must cover all of it.
- If the wallet is empty you see "Your message wallet is empty. Top up to start sending." If it is too low you see "Your wallet balance doesn't cover this send. Top up to start sending."
- An SMS, an email, a call or an AI request is checked just before it happens. If the wallet cannot pay you see "Your wallet balance is too low for this SMS. Top up to continue." with the name of what you were doing, or "Your wallet balance is empty. Top up to use AI features." for AI. A long SMS or email run pauses instead and carries on after you top up.
- A refused launch or request creates nothing, so there is nothing to clean up. Top up and try again.

A single WhatsApp reply from the Team inbox, and a WhatsApp message sent for your online store (order updates, abandoned-cart reminders, offers), is checked just before it leaves too: if your plan allowance does not cover it and the wallet cannot pay for it, it is not sent.

## Balance, top-ups and warnings

- The wallet screen shows the balance, about how many messages it covers, and what you spent and earned in the last 30 days. The balance also shows in the bar at the top of every page.
- When the balance is at or under your low-balance threshold, the wallet screen shows a warning. Workspace owners also get the notification **Low WhatsApp balance**, at most once every 6 hours. A top-up resets that.
- To add money, use **Add money** on the wallet screen. See [Wallet top-up](help:wallet-top-up).

## Currency

The wallet is kept in one currency, shown beside every amount, for example USD or INR. It follows the **Currency** set in **Workspace settings** by the workspace owner, as long as the platform can bill in that currency. Otherwise the wallet stays in the platform's own currency.

## Plan and access

Seeing the wallet needs the permission to view the wallet balance, and the statement needs its own permission. Buying credit and changing the plan are limited to roles that can buy, which by default is the Owner.

## If something looks wrong

- **The balance did not change after sending.** The charge is taken when the message is accepted, and for SMS, email, calls and AI a moment after the work, so it can lag. Free items never change it: WhatsApp and website chatbot messages inside your plan allowance, anything with a zero price, and anything that is never charged. Open [Expenses](help:message-expenses) and look for the item: **Not billed** shows the reason. If delivery updates are missing altogether, see [Incoming messages or delivery updates are missing](help:whatsapp-incoming-missing).
- **I was charged for a WhatsApp message that failed.** The refund is a separate **Refund** line on the statement. If it is missing after a few minutes, contact support with the message time and number. SMS, email and chat-channel fees are not refunded.
- **An SMS, email or AI request is refused although I have money.** The wallet must cover the price of that one item. Check the balance, then top up and try again.
- **A launch is still refused after I topped up.** The top-up counts once its order is **Paid** in [Order history](help:order-history). A bank transfer needs approval first.
- **The wallet is in the wrong currency.** Check the currency in Workspace settings. If it is right and the wallet still shows another currency, the platform cannot bill in it yet. Ask support.
