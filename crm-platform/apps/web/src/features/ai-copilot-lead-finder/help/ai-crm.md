---
id: ai-crm
title: AI CRM Copilot
summary: Chat with an AI assistant that can look up and create contacts and deals, move pipeline stages, and run sales reports for you.
area: sales
order: 30
documents: [nav:ai-crm]
gates:
  planFeature: ai_crm_copilot
  permission: aicrm.copilot.use
keywords: [ai, copilot, assistant, chat, crm, contacts, deals, pipeline, invoices, tasks, proposals, estimates]
---

## What it is for

The AI CRM Copilot is a chat assistant that runs your CRM for you, in plain language. Ask it to find a contact,
create a deal, move a deal to a different stage, write up an invoice, chase outstanding payments, create a task,
or put together a proposal or estimate — it does the lookup or the change and tells you what it did.

Anything that **changes** data (creating a contact, moving a deal, recording a payment, and so on) is never done
silently: the Copilot describes exactly what it is about to do and waits for you to reply **YES** before it acts,
or **NO** to cancel. Every action it takes, read or write, is recorded in the **Recent actions** panel so your team
has a full trail of what the AI did and when.

## How to use it

1. Open **AI CRM Copilot** from the Sales menu.
2. Type what you want in the message box and press **Send** (or Enter).
3. For a lookup ("find contacts named Priya", "what deals are open?", "how much is outstanding?") the Copilot
   answers right away.
4. For a change ("create a deal for Acme worth 5000", "mark task #12 done") the Copilot describes the change first.
   Reply **YES** to go ahead, or **NO** to cancel — nothing changes until you confirm.
5. Use **Reset conversation** to start a fresh chat; the Copilot forgets the current conversation but keeps the
   recorded actions.

## Who can use it

Chatting with the Copilot needs the **Chat with the AI CRM Copilot** permission. A workspace admin can also turn on
a WhatsApp staff-channel version of the same Copilot from this page (visible only to admins) — that channel isn't
live yet, so the toggle currently has no effect.

## Notes

- The Copilot needs an AI provider key configured for the workspace (or the platform's shared key, where your plan
  allows it) — ask your admin if you see "No AI provider is configured."
- It can create and move deals, contacts, companies, tasks, invoices, payments, proposals and estimates, and send a
  WhatsApp message or a quote's link to a contact. It cannot (yet) generate a client brief/deck or create delivery
  projects — those features don't exist in this product yet.

## Get it as an app

The AI CRM Copilot is also sold as an app in the **Marketplace**. A workspace whose plan already includes it keeps it as it is, with nothing to buy or install. A workspace without it can subscribe to the app and install it to switch it on. See [Marketplace](help:marketplace-overview).
