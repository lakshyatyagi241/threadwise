---
id: flows-human-handoff
title: Human handoff step
summary: Hand a conversation from a flow to a person, a team or the assignment rules, with a reason, a note and three exits.
area: automation
order: 12
documents: []
keywords:
  [
    human handoff,
    handoff,
    assign agent,
    live agent,
    talk to a person,
    escalate,
    queue,
    team,
    out of hours,
    bot stops,
  ]
---

## What it is for

The **Human handoff** step ends the bot's part of a conversation. It gives the conversation to a person, or puts it in the waiting queue, tells the person why, and stops the flow from answering over them. It replaces the older **Assign agent** step; flows that use the older step keep working as before.

## Add the step

1. Open a flow in the **Simple** builder or the **Advanced** canvas.
2. Add the step **Human handoff** (under the handoff group in Simple).
3. Choose **Send the conversation to**:
   - **A team**: it goes to someone in the team, or waits in the team's queue.
   - **One person**: it goes to that person if they can take it; otherwise it waits in the queue.
   - **The assignment rules**: your [auto-assignment rules](help:auto-assignment) choose. If none finds a person, it waits in the queue. Needs a plan with assignment rules: on other plans the step says so and the conversation waits in the queue.
4. Choose a **Reason** and, if you like, a **Priority**. Leave the priority on **Keep the current priority** to change nothing.
5. Write a **Note for the agent**. It is internal, shown on the handoff card, and can use variables such as the contact's name.
6. Write a **Message to the contact** to send when the conversation is handed over, and a **Message when nobody is available** to send instead when the team is closed or nobody can take it. Leave a message empty to send nothing.

The variables your flow collected are passed to the agent on the handoff card, so the contact does not have to repeat them.

## The three exits

In the Advanced canvas the step has three exits:

- **assigned**: a person has the conversation now.
- **waiting in queue**: nobody had it free; it waits for someone to claim it.
- **no agent / out of hours**: nobody could take it, or the team is closed. The conversation still waits in the queue.

In the Simple builder the next step runs once a person has the conversation. If it has to wait, or nobody is available, the bot stops there and a person answers. Use the Advanced canvas to follow the other exits.

## After the handoff

From the moment the conversation is handed over, new messages from the contact no longer reach the flow, the AI assistant or the auto-reply: the person answers. If the conversation is given back with **Return to bot**, the paused flow answers the next message. See [Waiting queue and claiming](help:waiting-queue).

## Update an older Assign agent step

An older step shows a short note and **Use handoff features**. Select it to switch the step: its team or person and its note stay, and the new fields start empty. Nothing changes until you select it.

## If something looks wrong

- The flow cannot be published and says to choose a team or a person: pick one in the step.
- A conversation did not leave the queue: look at the **How it was assigned** list on its handoff card.
