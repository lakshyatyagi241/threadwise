---
id: faq-knowledge
title: FAQs
summary: Teach your bot the answers to common questions. It matches what customers write by meaning and replies with a text or starts a flow.
area: automation
order: 6
documents: [nav:faq]
keywords: [faq, questions, answers, variations, phrasings, threshold, sensitivity, unanswered, auto reply, knowledge, flow, step, second check, verify]
---

## What it is for

An FAQ is a question, the answer to give, and a list of **phrasings**: other ways a customer might ask the same thing. When a customer writes to you, the bot compares the message with every phrasing **by meaning**, so "where is my parcel" can reach the FAQ "Track my order". If the best match is good enough, the customer gets the answer, or the FAQ's flow starts. Answering is **off** until you switch it on in FAQ settings.

## Add an FAQ

1. Open **FAQs** under Automation and select **Add FAQ**.
2. Write the **Question**. It counts as the first phrasing and cannot be removed.
3. Choose the answer: a **Text answer** (the preview shows how it looks in WhatsApp) or **Start a flow**. Only published, active flows can run. Under the flow, **Start at** says where the flow begins: **The flow's start** (the default), or any other step of that flow, listed as the step type and the name you gave it (or a short id when it has no name). Pick a step to skip the part of the flow the customer has already been through. Choosing another flow resets the step.
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

## Answer inside a flow

The flow builder has a step called **Answer from FAQ** (AI group). It matches the message you give it, by default the customer's last message, against your FAQs in the same way. If an FAQ answers, the flow leaves by **Answered**: a text answer is sent, unless you switch off sending on the step so a later step can word the reply itself, and an FAQ that starts a flow hands the conversation to that flow. Otherwise the flow leaves by **No match**. The step can be limited to one category and can use its own minimum score. It works even when FAQ answering is switched off in FAQ settings, and the platform switch is the only thing that stops it.

## Second check for close calls

A match that only just reaches the bar is the likeliest to be wrong. In FAQ settings, **Second check for close calls** lets a small chat model read the customer's message and the FAQ and say whether the answer fits. It only runs for scores from the bar up to the bar plus the band you choose (1 to 30 points), and the card shows the numbers, for example "from 50% up to 60%", and the model that checks. It can only say no. A no means nothing is sent and the message appears under **Unanswered**, marked **Answer withheld**. If the check cannot finish, or is skipped because the platform switched it off, no key is available or the hourly limit was reached, the match stands as it would without a check.

The check costs a few hundred tokens and adds about a second to a borderline reply. Test, Unanswered and the match log show each check as a chip (**Second check: yes**, **no**, **failed** or **skipped**) with the model and its reason. If the platform has switched the second check off, the switch is disabled and says so. Turning it on or off needs **faq.settings.manage**.

## Settings

- **Answer customers with FAQs** is the workspace switch.
- **Sensitivity** is how closely a message must match. Strict, Balanced and Forgiving are relative to the value recommended for the AI model. Scores belong to that model, so review the number if the platform changes it.
- **Ambiguity guard** keeps the bot quiet when two FAQs score almost the same.
- **Keep customer messages in the log** keeps message text for 90 days. Switch it off and only scores and outcomes are kept.

Changing settings needs the permission **faq.settings.manage**. You can set a different sensitivity on one FAQ under **Advanced** in its editor.

## If something looks wrong

- Nothing is answered: check the banner at the top of the FAQ screens. It says if answering is off or switched off by the platform.
- A flow FAQ shows **Flow missing**: the flow was deleted. Pick another flow.
- A flow FAQ shows **Step missing**: the flow is there but the step it starts at was deleted, so customers get no answer from it. Open the FAQ and pick another step, or select **Start at the flow's start**.
- A close match was not answered although its score reached the bar: the second check said no. Open the message under **Unanswered** to read the reason, and add its wording to the right FAQ if the check was wrong.
- A wrong FAQ answers: raise the sensitivity, or add the customer's wording to the right FAQ from **Unanswered**.
