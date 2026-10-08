---
id: ai-usage-overview
title: AI usage
summary: See how many AI tokens your workspace used, which providers and models used them, and how much of your monthly allowance is left.
area: automation
order: 15
documents: [nav:ai-usage]
keywords: [ai, tokens, usage, allowance, cap, cost, models, provider, limit]
---

## What it is for

The AI usage screen shows what your AI features have used. It counts tokens, which are the units AI providers measure text in, and it breaks them down by day, provider and model. It also shows how much of your plan's monthly token allowance you have spent, so you know before the allowance runs out.

## How to use it

1. Open **AI usage** from the Automation area of the menu, or go to `/ai-usage`.
2. Pick a time window with the buttons at the top right: **7 days**, **30 days**, **90 days** or **1 year**. The page opens on 30 days.
3. Read **Monthly allowance** first. It says how many tokens you used this month out of the limit, with a bar that fills as you use it and changes colour once the allowance is used up. If your plan has no monthly limit, it only shows the tokens used.
4. Read the tiles under it: **Tokens** with the number of calls, **Plan keys** with the tokens used on your own keys beside it, **Estimated cost** and **Providers** with the number of models.
5. Use the charts and the table to see where tokens went: **Daily tokens** (hover a bar for the exact day), **Tokens by provider**, **Whose key**, and a **Models** table with prompt tokens, reply tokens and calls for your busiest models.

## What the numbers mean

- **Plan keys** are tokens used with the shared keys that come with the platform. **Your own keys** are tokens used with keys you added in [AI provider keys](help:ai-provider-keys).
- Only tokens used on the shared keys count against the monthly allowance. Your own keys do not.
- **Estimated cost** uses blended rates and is not a bill.
- The allowance and the cost cover this month and the window you chose respectively, so they can differ.

## Plan and access

You need the permission to view AI usage. Without it the entry is hidden from the menu. The screen does not need any particular plan feature, but the size of the monthly allowance comes from your plan.

## If something looks wrong

- **The page says nothing was used in this window.** No AI calls were made in that period. Try a longer window.
- **The allowance warning says you used it all.** Upgrade your plan, or add your own provider keys so AI features keep working.
- **The page fails to load.** Select the retry button, then reload. If it still fails, ask a workspace admin to check your role.
