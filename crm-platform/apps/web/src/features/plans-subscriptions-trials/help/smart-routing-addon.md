---
id: smart-routing-addon
title: Smart routing add-on
summary: Automatic assignment of new conversations, routing rules and sticky agents, as an add-on to any plan.
area: getting-started
order: 84
documents: []
features: [inbox_routing, inbox_assignment_sticky]
keywords:
  [
    smart routing,
    add-on,
    auto assignment,
    routing rules,
    round robin,
    least loaded,
    sticky agent,
    contact owner,
    plan,
    upgrade,
    operator,
  ]
---

## What it is for

The entry plan keeps assignment simple: new conversations wait in the **Waiting** tab and a teammate claims them, or someone assigns them by hand. **Smart routing** adds the automatic part, so the right person gets a new conversation without anyone doing it.

## What it adds

- **Auto Assignment** on the [Conversation auto-assignment](help:auto-assignment) page, your **rules** and **Everyone else**, and the **Try it** box that shows who a test conversation would go to.
- **Round robin** and **Least loaded** as the method of a team, and the team's **default assignee**.
- **Sticky Agent**, **Owner first** and **Keep in sync** with the contact owner, the limit in days for a returning contact, and the question about the contact owner when a chat is reassigned.
- The destination **The assignment rules** on a handoff and in the Human handoff step.

## What stays on every plan

Inbox, assigning by hand, the Waiting tab and Claim, the Human handoff step to a named person or team, Return to bot, **Time off** and **Available / Offline**. See [What your plan includes for handoff and assignment](help:handoff-and-assignment-plans).

## How to get it

Open **Plans** from the account menu and look for **Smart routing** among the add-ons, or ask the account owner to. Some higher plans include it. Every locked option in the product links there. It does not need the Teams and permissions add-on: a rule can assign to people. Only a destination that is a team needs teams on your plan.

## If it ends

Nothing is deleted. Your rules, switches, team methods and owner mode stay saved but stop being applied: new conversations wait for a claim, chats already waiting or assigned stay where they are, and timers that were counting stop. Everything works again, as you left it, when Smart routing returns.

## For operators

1. In the operator console open **Add-ons** and find **Smart routing**. It starts as a draft: inactive and without a price. Untick **Free**, set the price and period, tick **Active**, save.
2. Give it to a workspace like any other add-on, or let the workspace buy it from Plans.
3. To include it in a plan instead, open **Plans**, the plan, **Features**, and under Chat switch on **Smart routing: auto-assignment and rules** and **Smart routing: contact owner and sticky agent**. To make a plan an entry plan, switch both off. A new plan starts with both off; plans that already exist are not changed until you edit them.
4. A workspace override beats both the plan and the add-on.

## If something looks wrong

If an option is locked after the add-on was bought, check that it is active and has not ended, and that no override on the workspace switches the feature off. If a team cannot be set to Round robin, the workspace does not have Smart routing.
