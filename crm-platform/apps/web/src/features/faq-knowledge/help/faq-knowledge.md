---
id: faq-knowledge
title: FAQs
summary: Every flow has its own FAQs. Teach it the answers to common questions; it matches what customers write by meaning and replies or goes to a step.
area: automation
order: 6
documents: [nav:flows]
keywords:
  [
    faq,
    questions,
    answers,
    variations,
    phrasings,
    threshold,
    sensitivity,
    unanswered,
    auto reply,
    knowledge,
    flow,
    step,
    second check,
    verify,
    simple builder,
    tab,
  ]
---

## What it is for

FAQs belong to a flow. Each flow has its own FAQs, its own tests, unanswered messages and insights, and its FAQs only answer inside that flow. There is no workspace-wide FAQ list.

An FAQ is a question, the answer to give, and a list of **phrasings**: other ways a customer might ask the same thing. When a customer writes to a flow, the bot compares the message with every phrasing **by meaning**, so "where is my parcel" can reach the FAQ "Track my order". If the best match is good enough, the customer gets the answer, or is sent to the step the FAQ points at. Answering is **on** for each flow by default.

## Where to find it

1. Open **Flows** and open a flow in the **Simple** builder. Save it once if it is new: the **FAQs** tab needs a saved flow.
2. Select the **FAQs** tab, beside **Build**. A website chat bot also has **Customize** and **Install**.
3. Inside the tab, the strip shows **FAQs**, **Test**, **Unanswered** and **Insights**. Each one has its own address (`?tab=faqs&view=...`), so you can reload, share a link or use the browser's back button. Switching between Build and FAQs does not lose changes to the flow.

The Advanced builder has no FAQs tab. A flow built there still has FAQs: open it in the Simple builder to edit them. The FAQ step in the Advanced builder links there.

## Add an FAQ

1. In the FAQs tab, select **Add FAQ**.
2. Write the **Question**. It counts as the first phrasing and cannot be removed.
3. Choose the answer: a **Text answer** (the preview shows how it looks in WhatsApp) or **Go to a step**. By default it goes to **a step of this flow**: pick the step, or leave **The flow's start**. Choose **A step of another flow** to hand the conversation to another published, active flow, then pick its step. Steps are listed as the step type and the name you gave it (or a short id). Steps you added to this flow since you last saved it appear after you save.
4. Add phrasings on the right, one by one, or select **Paste many** to add one per line. Duplicates are left out and the preview tells you how many will be added.
5. Select **Suggest with AI** on a saved FAQ to get ideas. Nothing is saved until you tick the ones you want and add them. This needs an OpenRouter key under AI keys, or the shared platform key.
6. Select **Create FAQ**.

## Is it live yet

A new phrasing starts matching within seconds. Phrasings that are not ready yet are indexed in the background, and any that fail are retried automatically, so there is nothing to do for them.

## Try before customers do

Use **Try it** inside an FAQ, or the **Test** tab. You see what would happen, the score against the bar it has to reach, which kind of match decided (exact, meaning, or spelling fallback), the top five candidates, the model used and the time. Only this flow's FAQs are tested. Nothing is sent and nothing is counted. From a candidate you can add the tested message as a phrasing of that FAQ.

## Unanswered messages

The **Unanswered** tab lists customer messages this flow's FAQs did not answer, and why. For each one you can **Add to an FAQ** as a new phrasing, **Create FAQ from this**, or **Dismiss**. This is the fastest way to improve coverage. If your workspace does not keep customer messages, the text shows as not kept and cannot be learned from.

**Fallback message.** Below the list, the **Fallback message** card sets what the flow replies when no FAQ matches (below the bar, too close to call, or no FAQs yet). It is sent exactly as you type it, spelling and punctuation included, and the unanswered message still appears in the list so you can teach the FAQ afterwards. Leave it empty to send no reply. A message an FAQ already answered, or a flow handled, never gets the fallback.

## Insights

**Insights** shows, for this flow, the answer rate, messages per day, how well messages scored compared with your sensitivity, your top FAQs, FAQs that never matched, and the full match log.

## How a flow's FAQs answer

While a flow is live, its FAQs answer a customer message that no keyword trigger or running flow took. The flow's FAQs answer in that flow only. Flows with no active FAQs never answer from FAQs, and nothing is answered while the platform has the FAQ engine switched off.

## The FAQ step

The flow builder has a step called **Answer from FAQ** (AI group). It matches the message you give it, by default the customer's last message, against **the FAQs of the flow it is in**, in the same way. If an FAQ answers, the flow leaves by **Answered**: a text answer is sent, unless you switch off sending on the step so a later step can word the reply itself, and an FAQ that goes to a step continues there. Otherwise the flow leaves by **No match**. The step can be limited to one category of this flow's FAQs and can use its own minimum score. It works even when the platform has FAQ answering switched off for the flow's customers, and the platform switch is the only thing that stops it. Its form links to the flow's FAQs tab; a flow that has not been saved has no FAQs yet.

## Second check for close calls

A match that only just reaches the bar is the likeliest to be wrong. The **second check for close calls** can let a small chat model read the customer's message and the FAQ and say whether the answer fits. It only runs for scores from the bar up to the bar plus the band you choose (1 to 30 points), and the card shows the numbers, for example "from 50% up to 60%", and the model that checks. It can only say no. A no means nothing is sent and the message appears under **Unanswered**, marked **Answer withheld**. If the check cannot finish, or is skipped because the platform switched it off, no key is available or the hourly limit was reached, the match stands as it would without a check.

The check costs a few hundred tokens and adds about a second to a borderline reply. Test, Unanswered and the match log show each check as a chip (**Second check: yes**, **no**, **failed** or **skipped**) with the model and its reason. If the platform has switched the second check off, the switch is disabled and says so.

## Limits

The platform's limits on FAQs and phrasings apply to each flow.

## If something looks wrong

- There is no FAQs tab: the flow is not saved yet, you are in the Advanced builder, or your role lacks **faq.entries.read**.
- Nothing is answered: check the banner at the top of the FAQs tab. It says if answering is off for this flow or switched off by the platform.
- An FAQ shows **Flow missing**: the flow it goes to was deleted. Pick another flow.
- An FAQ shows **Step missing**: the flow is there but the step it goes to was deleted, so customers get no answer from it. Open the FAQ and pick another step, or select **Start at the flow's start**.
- A close match was not answered although its score reached the bar: the second check said no. Open the message under **Unanswered** to read the reason, and add its wording to the right FAQ if the check was wrong.
- A wrong FAQ answers: raise the sensitivity, or add the customer's wording to the right FAQ from **Unanswered**.
- An old `/faq` link opens the flows list: FAQs now live inside each flow.
