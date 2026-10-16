---
id: company-brief
title: Account brief
summary: Get a short AI-written summary of a company from the CRM data you can see: who they are, deals, tasks, conversations, risks and next steps.
area: audience
order: 61
documents: []
gates:
  planFeature: sales_pipeline
keywords: [brief, summary, ai, account, client brief, generate, copilot]
---

## What it is for

The **Account brief** is a short summary of one company that an AI model writes for you, so you can get up to speed before a call. It covers who the company is, its recent activity, deals, tasks, how much conversation there is, what its properties say, the risks and the next steps.

## How to use it

1. Open a company from **Companies**.
2. Select **Generate brief** at the top. The brief appears in a card at the top of the page.
3. Select **Copy** to put the brief on your clipboard as plain text, or **Regenerate** to write it again.

You can also ask the AI CRM Copilot to generate the brief of a company by name.

## What it is written from

- Only what you can already see. Your record scopes decide which contacts, deals, tasks and conversations are counted, and a kind of record you may not read is left out. The card says which kinds the brief was based on.
- Counts, dates, amounts and short titles of deals and tasks, and the company's industry, size and properties.
- The model never receives contact names, email addresses, phone numbers or the text of any message, nor the company's own email, phone, address or notes. Numbers and email addresses inside titles and property values are removed before anything is sent. A title you typed can still hold a name, so keep names out of deal and task titles if that matters to you.
- A brief belongs to you. A colleague gets their own when they ask, written from what they can see. There is no public link to share.

## Options and settings

- The same facts within a day return the brief you already have, without calling the model again. **Regenerate** always writes a new one, and asking again within 30 seconds is refused.
- A note on the card says when the CRM has changed since the brief was written.
- The brief uses the workspace's own AI key when it has one, and the platform's otherwise. Tokens used are counted in AI usage, and the platform's allowance applies when its key pays.
- AI can be wrong. Check what matters before you rely on it.

## Plan and access

It needs permission to read companies and the sales pipeline feature on your plan, and the company must be inside your record scope.

## If something looks wrong

- **AI is not set up for this workspace.** No AI key is available. An admin can add one in **Settings**, then **AI keys**.
- **A brief was written a moment ago.** Wait half a minute before asking again.
- **The AI service could not write the brief.** The provider failed or answered with something that is not a brief. Your previous brief is kept. Try again in a moment.
- **The AI allowance is used up.** Try again later or ask an admin.
