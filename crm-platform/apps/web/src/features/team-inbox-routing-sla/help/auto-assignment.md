---
id: auto-assignment
title: Auto-assignment
summary: Give each new conversation to the right agent automatically, with rules that go in turn, pick the least busy agent or name one person.
area: settings
order: 60
documents: [tile:auto-assignment]
keywords:
  [
    auto assign,
    auto-assignment,
    routing,
    round robin,
    assign,
    agents,
    rules,
    inbox,
    distribute,
    fallback,
    owner,
    returning contact,
    business hours,
    time zone,
    opening hours,
  ]
---

## What it is for

Auto-assignment decides who gets a new conversation, so nobody has to claim it by hand. You write rules; when a customer starts a new conversation, or writes again after a finished one was reopened and nobody holds it, the rules are tried from the top and the first one that matches and finds an available agent takes it.

People on leave are never chosen. If a rule names someone who is on leave, their delegate (set in Team members) takes their place when available; otherwise the rule's team decides, and if nobody can take the conversation the managers are told.

Rules never take a conversation away from someone. A conversation that already has an agent, a team or an AI assistant is left alone, and so is every later message of a conversation that is already open.

## How to use it

1. Open **Settings**, go to **Automation** and select **Auto-assignment**.
2. Select **Create rule**. Give it a **Rule name** and, if you like, a **Description** for your team.
3. Under **When a new conversation arrives**, set the conditions. Every part you fill in must match; a part you leave empty is ignored.
4. Under **What the rule does**, tick what it should do: **Assign to agents or teams** (then choose **How to choose** and tick the agents or teams), **Mark the conversation as spam**, a priority, tags to add, an automatic reply, or an escalation (after the minutes you choose with no reply from us, it is reassigned to this rule's agents and/or its priority is raised). A rule must do at least one of these.
5. Select **Save** to keep the rule switched off, or **Save and activate** to start using it at once.
6. On the list, use the arrows to change the order, the switch to turn a rule on or off, and **Edit**, **Duplicate** or **Delete**.

## The conditions

- **The contact matches**: the same condition builder as segments, over tags, owner, lifecycle stage and other contact details. You can mix AND and OR groups.
- **Channel**: only conversations that arrive on the channels you tick.
- **Message words**: words or phrases in the customer's first message, separated by commas. Choose whether any word or every word must appear. Capital letters do not matter.
- **Customer language**: language codes such as en or ar. It matches only when the language of the customer is known.
- **Business hours**: only inside or only outside the business hours of your workspace. The hours are set under **Business hours** on this page (see below).

A rule needs at least one condition, unless it is the fallback.

## Business hours

Select **Business hours** at the top of the page to set when your team is open. Each day of the week has a switch, an opening time and a closing time. A day that is switched off is closed all day. The closing time must be after the opening time, so a day cannot run past midnight. A shift that does needs two days.

The **Time zone** is the one your workspace uses for every day and time. Only the workspace owner can change it; for anyone else the field is shown but cannot be changed. The same hours and time zone are used for the **Outside business hours** condition here and for the response targets of an SLA policy that respects business hours.

Until you save a schedule, the workspace counts as open all the time, so a rule that says "outside business hours" never fires. Until then the dialog shows Monday to Friday, 09:00 to 18:00, as a starting point.

## Choosing the agent

- **Round robin** gives the conversations to the chosen agents in turn. The rule remembers whose turn is next, so a restart or a new conversation never makes it start over.
- **Least busy** gives the conversation to the agent with the fewest open conversations at that moment; agents with the same number take turns.
- **A specific agent** always picks the same person.

A team in the list stands for its members. Agents who are suspended or removed, who cannot open the inbox, or who are marked offline or busy are skipped. If nobody in the list is available and the rule lists a team, the conversation goes to that team without a person; if there is no team, the rule does not apply and the next rule is tried.

## Also start a flow

Under **Also start a flow** you can pick one of your flows. When the rule fires for a new conversation, the flow starts for that conversation on the same channel, whoever takes it. A rule that names a flow fires even when nobody is available to take the conversation, so a flow can answer the customer in the meantime.

The flow has to be switched on; it does not have to be published. It runs once for each customer message that starts a conversation, and a repeat of the same message never starts it twice. If the flow is switched off or deleted later, the rule says so on the list and nothing starts. A run started this way shows as **Routing** on the flow runs screen; it does not add the customer to the flow's subscribers. On the WhatsApp Cloud API a flow that begins with a free-form message cannot reach a customer whose 24-hour window is closed: the run ends as failed with that reason, so open the flow with a template.

## Order, stop and fallback

Rules are tried from the top of the list. **Stop when this rule matches** (on by default) ends the search at the first rule that assigns the conversation; switched off, a later matching rule can take it over. The **Fallback rule** is used only when no other rule assigned the conversation, and there is only one: choosing a new fallback replaces the old one. A conversation nobody matched stays unassigned.

## Keep returning contacts with their agent

Switch this on to send a returning contact back to the same person first: the contact's owner, or else whoever handled their latest earlier conversation, as long as they are still an active member who can open the inbox. Their availability is not checked. Otherwise the rules above decide. It is off until you turn it on.

## Plan and access

Seeing the rules needs permission to view the inbox settings; creating, changing, ordering and deleting them needs permission to manage routing. Owners and Admins hold both by default. Your plan must include Routing rules and have room under its rule limit; the limit counts rules that are switched off too.

## If something looks wrong

- **A rule that uses business hours fires at the wrong time.** Check the time zone under **Business hours**. Only the owner can change it, and a schedule that was never saved counts as open all the time.
- **A rule never fires.** Check it is switched on, that the rules above it do not match first with **Stop when this rule matches** on, and that at least one chosen agent is active, can open the inbox and is not offline or busy.
- **"Agents unavailable" on a rule.** A chosen person or team was removed or suspended. Edit the rule and take them off.
- **A conversation was not assigned.** Only a new conversation, or one reopened with nobody holding it, is routed. One that already has an agent is never changed.
