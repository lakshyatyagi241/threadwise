---
id: handoff-settings
title: Handoff and assignment
summary: Choose how a conversation reaches a person after a bot asks for one, and how the contact owner and the chat owner work together.
area: settings
order: 62
documents: [tile:assignment-settings]
keywords:
  [
    handoff,
    hand off,
    assignment,
    auto assign,
    contact owner,
    chat owner,
    owner first,
    keep in sync,
    claim,
    continuity,
    sticky agent,
    queue,
    notify,
    waiting,
  ]
---

## What it is for

When a bot, a flow or a teammate asks for a person, the conversation is handed over. These settings decide who gets it and how the contact's owner and the chat's owner relate. They apply to the whole workspace. Every plan can open this page; the options your plan does not include are marked **Not in your plan**.

## How to use it

1. Open **Settings**, go to **Automation** and select **Handoff and assignment**.
2. Change a setting. Each switch and choice is saved as soon as you change it, and a message confirms it.

You can read the page with the inbox settings right. Changing it needs the right to manage routing.

## Automatic assignment

**Assign automatically** lets the [auto-assignment rules](help:auto-assignment) pick a person, both for new conversations and for handoffs that use "the assignment rules". Turn it off and the rules stop running everywhere: handoffs then go to the person or team a flow names, or wait in the queue. This switch needs a plan with assignment rules.

## Contact owner and chat owner

A contact can have an owner and each conversation has a person who answers it. Choose how they relate:

- **Independent**: they are separate. Nothing changes one when the other changes.
- **Owner first**: a handed-over conversation goes to the contact's owner first when they can take it. If they are away, over their chat limit or cannot see the conversation, the usual rules decide.
- **Keep in sync**: as owner first, and when a contact's owner changes, their open conversations that were assigned automatically move to the new owner. A conversation a person took, claimed or was named for is never moved.

Owner first and Keep in sync need a plan that includes them.

**Claiming makes you the contact owner**: when someone claims a conversation and the contact has no owner yet, they become the owner. It never replaces an owner that is already set. It works on every plan.

**Ask about the contact owner on reassign**: when a conversation is given to someone else by hand, offer to make them the contact owner too. Needs a plan that includes it.

**Keep a returning contact with their last agent**: a contact who writes again goes to the person who handled their last conversation, if that was within the number of days you choose. Switch it off for no limit. Needs a plan that includes it.

## Waiting queue

**Tell the team when a conversation is waiting** sends a notification to the members of the team (or, for the queue that belongs to no team, to everyone who may answer unassigned conversations), with the reason.

## Teams

Each team keeps its own settings on the [Teams](/teams) screen: how to pick a person (manual, round robin or least loaded), its opening hours and time zone, and a default assignee who takes a conversation when nobody else can. Round robin and least loaded need a plan with assignment rules; on other plans a conversation for that team waits in its queue.

## If something looks wrong

- A switch is greyed out and says **Not in your plan**: ask the account owner to upgrade the plan. Nothing is hidden or silently ignored.
- A conversation went to the queue although a team has people: check the team's opening hours, that the people are not on leave and that they are under their chat limit. The **How it was assigned** list on the handoff card says which.

See [Waiting queue and claiming](help:waiting-queue) for what agents see.
