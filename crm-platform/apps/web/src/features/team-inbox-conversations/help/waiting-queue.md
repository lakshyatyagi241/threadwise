---
id: waiting-queue
title: Waiting queue and claiming
summary: See the conversations a bot, a flow or a teammate handed over, claim one, send one to the queue, or give it back to the bot.
area: inbox
order: 12
documents: [nav:inbox]
keywords:
  [
    waiting,
    queue,
    claim,
    handoff,
    hand off,
    human,
    bot,
    return to bot,
    send to queue,
    reason,
    unassigned,
    take over,
  ]
---

## What it is for

A bot can answer first and a person second. When the bot cannot help, or the contact asks for a person, the conversation is handed over: the bot stops answering and the conversation goes to a person if one can take it right now, or waits in the queue until someone claims it. This guide shows what you see in the inbox and what you can do with it. It works on every plan.

## The Waiting tab

1. Open the **Inbox**.
2. Select the **Waiting** tab. The number next to it counts the conversations nobody holds yet.
3. Each row shows how long the conversation has waited, for example **Waiting 12m**. Point at the badge to see which team's queue it is in.

You see the queue of the teams you belong to. If your role may read unassigned conversations, you also see the queue that belongs to no team.

## Claim a conversation

1. Open a conversation in the **Waiting** tab.
2. Read the strip above the messages. It says why a person was asked for (for example **The contact asked for a person**) and, once assigned, who has it.
3. Select **Claim**. The conversation is yours and the bot stays silent.

If a teammate claimed it a moment earlier, you are told so and nothing changes. You need the right to assign conversations to yourself.

If your workspace turned on **Claiming makes you the contact owner** in the handoff settings, claiming also makes you the contact's owner when the contact has none.

## Read the handoff card

Select **Details** in the strip to open the card:

- **Asked by**: a flow, an AI agent, the contact, a bot that could not help, or a teammate.
- **Reason**, **Priority** and the **Summary** the flow wrote.
- **What the contact told the bot**: the answers the flow collected, so you do not ask again.
- **How it was assigned**: each step the system took, who was chosen and who was skipped and why (for example on leave or over the chat limit).

## Send a conversation to the queue

1. Open a conversation.
2. Select **Send to queue** in the header, or in the strip.
3. Choose where it goes: the assignment rules (otherwise the waiting queue), a team, or one person.
4. Choose a reason, add a note for whoever takes it, and select **Send**.

The bot stops answering this contact. You need the right to assign conversations.

## Give a conversation back to the bot

Select **Return to bot** in the strip. The conversation is released, the bot is back, and the screen always tells you what happens next:

- **The bot continues the flow.** The handoff came from a flow whose [Human handoff step](help:flows-human-handoff) has a **returned** exit connected. The flow carries on from that exit right away. If the step also has a **message to the contact when the bot is back**, it is sent first, once.
- **The bot will answer the customer's next message.** Nothing is sent now. The flow that was paused answers when the contact writes again.
- **The bot is back on. It answers the next message only if a default flow is set.** The handoff did not come from a flow (a teammate sent it to the queue, for example) and no flow is waiting for this contact. A default route flow, if you have one, starts on the next message; if you have none, nobody answers.
- **The bot already has this conversation.** Someone pressed it a moment ago. Nothing is sent twice.

Right after you press it, a grey line appears in the thread: **Bot is back, returned by (the name of the person).** It says whether the flow continues or the bot waits for the next message. A moment later a second line says what happened to the flow (**The flow continued from the "returned" exit**) and to the message for the contact, for example **The message to the customer was skipped: the 24 hour window is closed**. These lines are for your team only; the contact never sees them.

The flow is not resumed, and the line says why, when a teammate took the conversation again in the meantime, or when the flow was switched off, unpublished or deleted. The message for the contact follows the usual rules: it is not sent when the 24 hour window is closed or the contact has not given consent. You need the right to reply.

## Good to know

- A conversation that no handoff ever touched behaves as it always did: this strip does not appear on it.
- Resolving a conversation ends its handoff. A contact who writes again after it was resolved starts fresh.
- Conversations assigned to someone else stay theirs. You cannot claim a conversation that somebody holds.
- The queue is only for people who may see it: if you only see your own conversations, the Waiting tab stays empty for you.

See [Conversation auto-assignment](help:auto-assignment) for the workspace settings and [Human handoff](help:flows-human-handoff) for the flow step.
