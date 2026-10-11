---
id: faq-knowledge
title: FAQs
summary: Teach your bot the answers to common questions. It matches what customers write by meaning and replies with a text or starts a flow.
area: automation
order: 6
documents: [nav:faq]
keywords: [faq, questions, answers, variations, phrasings, threshold, sensitivity, unanswered, auto reply, knowledge]
---

## What it is for

An FAQ is a question, the answer to give, and a list of **phrasings**: other ways a customer might ask the same thing. When a customer writes to you, the bot compares the message with every phrasing **by meaning**, so "where is my parcel" can reach the FAQ "Track my order". If the best match is good enough, the customer gets the answer, or the FAQ's flow starts. Answering is **off** until you switch it on in FAQ settings.

## Add an FAQ

1. Open **FAQs** under Automation and select **Add FAQ**.
2. Write the **Question**. It counts as the first phrasing and cannot be removed.
3. Choose the answer: a **Text answer** (the preview shows how it looks in WhatsApp) or **Start a flow**. A flow starts from its trigger, and only published, active flows can run.
4. Add phrasings on the right, one by one, or select **Paste many** to add one per line. Duplicates are left out and the preview tells you how many will be added.
5. Select **Suggest with AI** on a saved FAQ to get ideas. Nothing is saved until you tick the ones you want and add them. This needs an OpenRouter key under AI keys, or the shared platform key.
6. Select **Create FAQ**.

## Is it live yet

Every phrasing shows **Indexing**, **Live** or **Failed**. A new phrasing starts matching within seconds. A failed one cannot match: edit and save it to try again, and check your AI keys if many fail.

## Try before customers do

Use **Try it** inside an FAQ, or the **Test** tab. You see what would happen, the score against the bar it has to reach, which kind of match decided (exact, meaning, or spelling fallback), the top five candidates, the model used and the time. Nothing is sent and nothing is counted. From a candidate you can add the tested message as a phrasing of that FAQ.

## Unanswered messages

The **Unanswered** tab lists customer messages no FAQ answered, and why. For each one you can **Add to an FAQ** as a new phrasing, **Create FAQ from this**, or **Dismiss**. This is the fastest way to improve coverage. If your workspace does not keep customer messages, the text shows as not kept and cannot be learned from.

## Insights

**Insights** shows the answer rate, messages per day, how well messages scored compared with your sensitivity, your top FAQs, FAQs that never matched, and the full match log. Raise the threshold if wrong answers slip in, lower it if too many messages go unanswered.

## Settings

- **Answer customers with FAQs** is the workspace switch.
- **Sensitivity** is how closely a message must match. Strict, Balanced and Forgiving are relative to the value recommended for the AI model. Scores belong to that model, so review the number if the platform changes it.
- **Ambiguity guard** keeps the bot quiet when two FAQs score almost the same.
- **Keep customer messages in the log** keeps message text for 90 days. Switch it off and only scores and outcomes are kept.

Changing settings needs the permission **faq.settings.manage**. You can set a different sensitivity on one FAQ under **Advanced** in its editor.

## If something looks wrong

- Nothing is answered: check the banner at the top of the FAQ screens. It says if answering is off or switched off by the platform.
- A flow FAQ shows **Flow missing**: the flow was deleted. Pick another flow.
- A wrong FAQ answers: raise the sensitivity, or add the customer's wording to the right FAQ from **Unanswered**.
