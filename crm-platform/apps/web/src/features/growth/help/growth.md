---
id: growth
title: Growth
summary: Hot leads, audiences, campaign replies and other things your team can act on, worked out from your chats and campaigns.
area: automation
order: 9
documents: [tile:growth]
keywords:
  [
    growth,
    hot lead,
    audience,
    engaged,
    lapsed,
    campaign replies,
    best time to send,
    conversion,
    propensity,
    opt out,
    automatic stage,
    broadcast assistant,
    pilot,
  ]
---

## What it is for

Growth turns what AI lead scoring already knows into a short list of things worth doing. It reads how contacts react to your campaigns and what they say in chats, and puts the result in one place: **Settings → Automation → Growth**.

Growth is a **pilot**. It is only available to workspaces that were added to it. If your workspace is not one of them, the screen says so and nothing is read or changed.

Growth never messages a contact by itself. It suggests; your team decides.

## The Inbox

The Inbox lists things a person should look at:

- **Hot lead**: the chat clearly says the contact is ready to buy.
- **Unanswered**: a buying or price question that nobody answered for a few hours.
- **Registration problem**: the contact says they paid or registered but got no confirmation.
- **Route to a person**: the contact wants to buy and nobody has the chat; Growth suggests who should take it.
- **Asked to stop**: the contact asked not to be messaged. Accepting records an opt-out in the consent ledger, so campaigns skip them.
- **Gone quiet** and **Service due**: customers who stopped opening or writing, and contacts whose service date is due under a rule you set.
- **Order status**: a customer asked about an order or repair and their status is ready to share.

**Accept** does the work of its kind (assigns the chat, records the opt-out) as you. **Dismiss** only closes the item. Both need the permission to review stage changes.

## Audiences

Audiences are groups worked out from what contacts really did: **Engaged**, **Silent**, **Lapsed**, **Hot in chat**, **Likely to convert** and one per service rule. **Sync to a group** fills a contact group of the same name so you can send a campaign to it. Once a group exists it is refreshed every day.

## Campaigns

The campaign table counts the contacts who wrote back within 24 and 72 hours of each send, straight from the inbox. **Record replies now** also fills in the response time on each recipient and updates the campaign’s own counters.

## Insights

- **Best time to send**: the hours when your contacts read and write, in your own time zone (else the workspace's, or UTC if it has none).
- **Conversion model**: learns from the contacts who became customers which behaviour goes with converting and scores everyone from 0 to 100. The score shows on the contact page. When there are too few converted contacts it says so and uses fixed weights.
- **Quality**: how many suggestions are accepted or dismissed, how well the lead score separates the contacts who converted, and what the AI cost in the last 30 days.
- **Company details**: for contacts with a business email address, looks up company details. This sends that email address to the lookup service, so it asks before you turn it on. Personal addresses such as Gmail are never sent, and nothing happens until the server has a lookup service connected.

## Automatic stage changes

When the AI is very sure (90% by default) it can move a contact to the next stage on its own, up to a daily limit. Every change is listed, and **Put back** restores the previous stage as long as nobody moved the contact since. The chat itself says it too: a line in the conversation reads "AI read the chat and moved this contact from X to Y", with an **Undo** right there (for people who may review stage changes). Undoing adds a second line, "Stage change undone", and the Undo goes away. Won and Lost stages are never set automatically.

## Broadcast assistant

Type what you want to achieve, such as “remind registered contacts about Saturday”. The assistant suggests one of your audiences and one of your approved templates, weighing the replies each template really got, and the best hour to send. It creates and sends nothing.

## Controls

Every part has its own switch, and every part is **off** until you turn it on. Reading chats needs AI lead scoring’s chat reading to be on, which partly masks personal data before anything is read. You can also set:

- the numbers the parts use (how sure a hot lead must be, how long a question may wait, how many days make a customer lapsed);
- **service rules**, one per line: `label | date property | days after | days until`;
- **button and keyword taps** that mean a known intent, one per line: `phrase = intent`;
- **words to always hide** from the AI, such as a brand or an address.

## Who can do what

Reading needs the permission to read the lead scoring log. Running something (syncing an audience, recording replies, asking the assistant) needs the permission to score contacts. Switching parts on or off needs the lead scoring settings permission. Accepting, dismissing and putting back need the permission to review stage changes.
