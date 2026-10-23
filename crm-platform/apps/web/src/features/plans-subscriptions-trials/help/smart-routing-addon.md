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

Open **Plans** from the account menu and look for **Smart routing** among the add-ons, or ask the account owner to. Some higher plans include it, and some plans do not offer it at all; then it is not listed and the auto-assignment page shows only the controls every plan has. Every locked option in the product links there. It does not need the Teams and permissions add-on: a rule can assign to people. Only a destination that is a team needs teams on your plan.

## If your plan starts to include it

If you upgrade to a plan that includes Smart routing while you hold the add-on, the add-on stays active until the end of the term you paid for and then does not renew. You are not charged again for it and nothing is refunded early. Its card shows **Included in your plan** and the date it ends, and the account's billing admins get a notice.

## Turn an included add-on off or on

When your plan includes Smart routing it is on from the start, and your workspace can turn it off and on again. Open the add-ons list (**Plans**, then **Add-ons**) and find the card that says **Included in your plan**; it shows **Active** or **Turned off**.

- **Turn off** first shows what changes. Smart routing stops assigning new conversations: chats that are waiting stay in **Waiting** until someone claims them, routing rules stop applying, and teams set to Round robin or Least loaded stop assigning. Because customers' chats are affected, you type the add-on's name to confirm.
- **What is kept:** your rules, switches, team methods, owner mode and teams stay saved, and so do the permissions your roles hold for it (they do not apply while it is off).
- **Turn on** brings it back as you left it, with nothing to confirm. Chats that arrived while it was off are not routed afterwards; they wait for a claim.
- A locked option or screen says **Smart routing is turned off** with a **Turn it on** button for people who may switch it, and **Ask your account owner to turn it on** for everyone else.
- **Who:** the owner and admins can switch it. Other people see the state only.

## If it ends

Nothing is deleted. Your rules, switches, team methods and owner mode stay saved but stop being applied: new conversations wait for a claim, chats already waiting or assigned stay where they are, and timers that were counting stop. Everything works again, as you left it, when Smart routing returns.

## For operators

1. In the operator console open **Add-ons** and find **Smart routing**. It starts as a draft: inactive and without a price. Set the price and period, tick **Active**, save.
2. Decide per plan, in one place: open **Plans**, the plan, the **Add-ons** tab, and choose **Included** (no charge, the plan carries both Smart routing features), **Paid** (workspaces on the plan can buy it, at the add-on price or at a price you type for this plan) or **Hidden** (workspaces on the plan never see it). The same choice is on the add-on's own page under **Plans**, and the add-ons list shows it for every plan.
3. The two Smart routing switches on a plan's **Features** tab follow that choice and cannot be changed there.
4. A workspace override beats both the plan and the add-on. The workspace's **Plan** tab in **Workspaces** lists every add-on with the reason it is on or off, including overrides; clear an override in **Edit & change plan**.

## If something looks wrong

If an option is locked after the add-on was bought, check that it is active and has not ended, and that no override on the workspace switches the feature off. If a team cannot be set to Round robin, the workspace does not have Smart routing.
