---
id: lead-scoring
title: AI lead scoring
summary: Give every contact a score from 0 to 100 with AI, see why, and keep track of what it costs.
area: automation
order: 8
documents: [tile:lead-scoring, nav:lead-scoring]
keywords:
  [
    lead score,
    scoring,
    ai,
    hot,
    warm,
    cold,
    openrouter,
    tokens,
    cost,
    backfill,
    manual score,
    privacy,
  ]
---

## What it is for

AI lead scoring gives each contact a number from 0 to 100 that says how promising the contact looks. The number is written to the contact's **Lead score**, so it shows in the contact list, on the board and on the contact's page. Scores are grouped by colour and name: **Cold** below 34, **Warm** from 34 to 66 and **Hot** from 67. The number is always printed too, and a small sparkle marks a score the AI wrote.

Scoring is **off** until you switch it on, because it sends facts about your contacts to an AI provider.

## Get the app

AI lead scoring is an app. A workspace that already used scoring keeps it exactly as it was, with nothing to buy or install. Any other workspace adds it from the **Marketplace**: open **AI lead scoring** under **Mini apps**, **Subscribe** if the app has a price, then select **Install** and confirm its permissions. Paying for the app is not enough on its own; it has to be installed.

Until then the **AI lead scoring** tile is not in Settings, the page `/lead-scoring` says it isn't part of your workspace and links to the app, and the lead score is not shown anywhere. Pausing or uninstalling the app switches scoring off again; the scores already written stay stored on the contacts, and they show again when scoring is back on.

## When scoring is off, no score is shown

The lead score is shown only while scoring is **on** for your workspace: the app is there and you switched it on under **Settings** > **AI lead scoring**. While it is off, nothing about the score is drawn, a score a person typed included: no score chip beside a contact's name, no **Lead score** card on the contact page, the quick view or the Inbox, no **Lead score** tile in the communication figures, no **Lead score** column in the Contacts list (it is also left out of **Columns** and the **+** at the end of the headings), no **Hot leads** chip or view, no lead score condition in the filters and segments, no lead score box in the contact form, and no lead score changes in the field history. Nothing is deleted: the scores stay on the contacts, and everything above comes back, with the numbers, when you switch scoring on again.

## What is sent

Only a short, anonymous description of the contact goes to the AI: its stage and status, where it came from, its tag names, how many deals are open, won and lost, how recently it was active, how long it has been in its current stage, and the company name. It also includes how the contact has engaged lately, as plain numbers: how many messages it sent in the last 7 days, how long ago it last wrote to you, how fast it usually replies, and how many of your broadcasts and campaigns it received and opened, and links it clicked, in the last 30 days. The contact's **name, email address and phone number are never sent**, and neither is the text of any message, unless your workspace is in the pilot of reading conversations (see below) and you switched that on.

A contact's last activity now also moves when the contact writes to you or one of your team replies in the Inbox, so a contact that is chatting with you no longer looks silent.

## Turn it on

1. Open **Settings**, then **AI lead scoring** under Automation.
2. Switch on **AI lead scoring** and select **Save**. You are asked to confirm once, because this is where contact facts start going to an AI provider.
3. Decide on **Score automatically when contacts change**. When it is on, a contact is scored when it is created and again when its details change. When it is off, contacts are scored only with the button on the contact's page or with **Score unscored contacts now**.

The banner at the top of the screen tells you where you stand. Scoring needs the platform switch to be on and an OpenRouter key: your own key from **AI keys**, or the platform's shared key when your workspace has none. Without a key the banner says so and links to **AI keys**.

Seeing the screen needs the permission to see lead scoring runs. Changing the switches needs the permission to manage lead scoring settings.

## Score one contact

Open a contact, or open a conversation in the **Inbox**: the contact panel on the right shows the same **Lead score** card, so you can see how promising the person you are chatting with looks, and re-score them, without leaving the thread. The **Lead score** card shows the number, who set it, the date and model, and the reasons the AI gave. Select **Score with AI** (or **Re-score** when the contact already has an AI score). It takes a few seconds, and when it finishes the card shows what that run cost. This button needs the permission to score contacts.

If something stops it, the card says exactly what: scoring is off for the workspace (with a link to the settings), no key is available, the provider did not give a usable answer, the plan's AI allowance is used up, or the contact has a score a person typed.

## Read conversations (pilot)

A few workspaces can also let the AI **read a contact's chat**. It is a pilot: you only see it in **Settings, AI lead scoring** when your workspace has been included, and it is off until you switch it on. Switching it on asks you to confirm, because the recent messages of a contact are then sent to the AI provider.

- **When.** About 12 minutes after a contact stops writing, the AI reads the last two weeks of that chat. **Read chat** on the contact's page reads it right away.
- **What is hidden first.** Phone numbers keep only their first and last two digits, emails keep the first letter and the domain, card and ID numbers keep only their ends, and the contact's name keeps only its first and last letter. Bots, deleted messages, group chats and other businesses' automatic replies are left out.
- **What you get.** On the contact's page, a **Conversation reading** card shows what the contact is after (for example _Ready to buy_ or _Asking about price_), a few signals, and a short summary. The score is updated from the same reading, unless a person typed it.
- **Button taps.** A contact that only tapped menu buttons or keywords the system knows (such as _view warranty slip_) is understood without calling the AI at all.
- **Suggested stages.** When the chat clearly shows a contact has moved on, the card suggests the next lifecycle stage with how sure the AI is. Under **Read conversations** you choose how a stage change is made. **Automatic** (the default) moves the contact straight away and adds a line to the chat ("AI read the chat and moved this contact from X to Y") with an **Undo**; undoing adds a second line and puts the contact back, as long as nobody moved it since. **Manual** leaves each suggestion for you to choose **Accept** or **Dismiss**, and nothing moves by itself. Won and Lost stages are never suggested, and an automatic change only ever moves a contact forward. All waiting suggestions are listed under **Stage suggestions** on the settings screen, where you can accept every confident one at once. Accepting needs the permission to review stage suggestions and the right to edit the contact, and it changes the stage like any other edit.

## A score you typed is yours

You can type a score yourself in the contact's edit form (while scoring is on; with scoring off the form has no lead score box). A typed score is **Manual**: the AI never overwrites it, and the Score with AI button is disabled with an explanation. To hand the contact back to the AI, edit the contact and clear the lead score. Saving the form without touching the score leaves an AI score as it is.

## Score the contacts you already have

**Score unscored contacts now** queues contacts that have no score, up to 500 at a time, and scores them in the background. The screen tells you how many were queued; select it again to queue the next batch. It needs the permission to score contacts.

## Cost and the log

A score costs a fraction of a cent. The **Last 30 days** card shows the contacts scored, the tokens used, the total cost in US dollars, the average per score and which key pays for it. A cost smaller than a hundredth of a cent is shown as less than $0.0001, never as zero.

The **Scoring log** lists every attempt, newest first, with the result, the score change, what triggered it, the tokens and the cost. Results are:

- **Scored**: a score was written.
- **Not saved**: the AI answered, but a person typed a score in the meantime, so it was kept.
- **Failed**: the provider did not give a usable answer. A failed answer can still have cost something.
- **Skipped**: nothing was sent, for example because no key was available.

Use the filter to show one kind of result and **Load more** to go further back. Each contact's own history is under **Show scoring history** on its Lead score card.

## If something looks wrong

- **Nothing is scored.** Check the banner on the AI lead scoring screen: the platform switch, your own switch and the key must all be in place.
- **A contact will not score.** Open it: a **Manual** label means a person typed the score.
- **A cost shows with a tilde.** The figure is an estimate from the tokens and the list price, not the amount OpenRouter reported.
