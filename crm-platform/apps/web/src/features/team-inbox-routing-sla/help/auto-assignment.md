---
id: auto-assignment
title: Conversation auto-assignment
summary: Four switches decide who gets each new chat; add rules only when you need more control. Includes Everyone else, the waiting queue and a Try it box.
area: settings
order: 60
documents: [tile:auto-assignment]
keywords:
  [
    auto assign,
    auto assignment,
    auto-assignment,
    sticky agent,
    contact owner,
    claim,
    handoff,
    queue,
    waiting,
    routing,
    round robin,
    least busy,
    assign,
    agents,
    rules,
    inbox,
    distribute,
    everyone else,
    fallback,
    returning contact,
    new contact,
    chat limit,
    business hours,
    time zone,
    opening hours,
    try it,
  ]
---

## What it is for

This page decides who gets a new chat, so nobody has to pick it up by hand. It has two layers:

1. **Four switches** at the top. For most workspaces these are all you need: turn them on and you never create a rule.
2. **Rules**, below, for the cases where particular chats must go to particular agents or teams. This layer is optional.

Anything already assigned by a flow, a person or a handoff is never changed by these settings.

## The order a new chat goes through

1. **Contact Owner and Sticky Agent** (the switches below) are checked first.
2. **Your rules**, from the top of the list, if you added any.
3. **Everyone else**, which takes whatever no rule took.
4. **The waiting queue**: if nobody is found, the chat waits in the Waiting tab until an agent claims it.

## The four switches

Each switch saves as soon as you change it. You can read the page with the inbox settings right; changing it needs the right to manage routing. A switch your plan does not include is marked **Not in your plan**. If your plan loses an option, the page shows it as off; your earlier choice is kept and comes back when the plan includes it again.

- **Auto Assignment** is the master switch. New chats are shared evenly among agents who are accepting chats: not offline, not busy and not on leave. An agent who has reached their chat limit is skipped, and when every agent is at the limit, new chats wait in the queue. Set each agent's chat limit in their profile under **Team members**. Turn it off and nothing is assigned automatically, not by a rule and not by the contact owner; chats wait in the queue until someone claims them or a flow names a person. When you turn it on and the workspace has no **Everyone else** setting yet, the page creates it with "Distribute evenly among all agents" selected, so you can see and change it. Nothing is ever created for you without this click.
- **Sticky Agent** sends a returning contact back to the agent who handled their last chat, as long as that agent is still an active member who can open the inbox. Their online status is not checked, because continuity is the point. If the contact has an owner, the owner is tried first. How many days back the last agent counts is set under **Advanced**. Needs a plan with assignment rules.
- **Assign Chat to Contact Owner** sends chats from a known contact to their contact owner first. If the owner is on leave, their delegate takes the chat; if the contact has no owner, the next step decides. If Sticky Agent is also on, the contact owner still wins and the last agent is only the second choice. Needs a plan that includes it.
- **Assign Agent as Contact Owner** makes an agent the contact owner when they claim a chat from the waiting queue and the contact has no owner yet. An existing owner is never changed. A chat given to an agent by a rule does not set the owner. It works on every plan.

### Advanced

Open **Advanced** under the switches for the extras:

- **Keep open chats with the owner**: when a contact's owner changes, their open chats that were assigned automatically follow the new owner. A chat a person took, claimed or was named for is never moved. A handoff that assigns a chat also sets the owner when the contact has none. Needs Assign Chat to Contact Owner to be on, and a plan that includes it.
- **Keep a returning contact with their last agent for a number of days**: limits how far back Sticky Agent looks. Off means no limit.
- **Ask about the contact owner on reassign**: when a chat is given to someone else by hand, offers to make them the contact owner too.
- **Tell the team when a conversation is waiting**: sends a notification with the reason to the team, or to everyone who may answer unassigned chats.

Each team keeps its own method, opening hours and default assignee on the **Teams** screen.

## Rules (optional)

Select **Add a rule**, give it a name and say who should get the chats. By default a rule applies to **every new conversation**. To limit it, switch on **Only for conversations that match...** and add conditions one at a time with **Add a condition**. Only the conditions you add are shown. Every condition you add must match.

- **New or returning contact**: a contact is returning when it has an earlier chat, or was saved more than 10 minutes before this chat. A contact the chat itself created is new.
- **Channel**: only chats that arrive on the channels you tick.
- **Message words**: words or phrases in the customer's message, separated by commas; any word or every word. Capital letters do not matter.
- **Customer language**: language codes such as en or ar. It matches only when the customer's language is known.
- **Business hours**: only inside or only outside the business hours of your workspace (see below).
- **Contact details**: tags, owner, lifecycle stage and other contact fields, built like a segment. This only matches contacts that already have the value saved. A brand-new contact arrives with nothing saved except the stage "New", so use New or returning contact for first-time customers.

Switching **Only for conversations that match...** off keeps your conditions on file but ignores them, and the rule applies to every conversation. Removing a condition with its cross deletes it.

### Choosing the agent

- **Round robin** gives the chats to the chosen agents in turn. The rule remembers whose turn is next.
- **Least busy** gives the chat to the agent with the fewest open conversations; agents with the same number take turns.
- **A specific agent** always picks the same person.

A team in the list stands for its members. Agents who are suspended, who cannot open the inbox, who are marked offline or busy, who are on leave or who have reached their chat limit are skipped. If nobody in the list is available and the rule lists a team, the chat goes to that team's queue; otherwise the rule does not apply and the next one is tried.

A rule can also mark the conversation as spam, set a priority, add tags, send an automatic reply, escalate after a delay, or start one of your flows. A rule must do at least one of these. A rule that starts a flow fires even when nobody is available, so the flow can answer the customer in the meantime.

### The list

The list shows one sentence per rule, like "Channel: WhatsApp Cloud API, Message has any of: refund → Round robin: Sales team", with a switch to turn it on or off and how often it was used. Drag a rule, or use the arrows, to change the order. **Stop when this rule matches** (on by default) ends the search at the first rule that assigns the chat; switched off, a later matching rule can take it over.

The page warns you when a rule that applies to every conversation sits above other rules: it stops the check there, so the rules below it can never run unless nobody it points at is available. Move it down, or switch off **Stop when this rule matches** in it. A rule that has no condition and does not apply to every conversation never matches, and is marked too.

## Everyone else

**Everyone else** is pinned below your rules and takes every chat that no rule took. It has no conditions. You choose:

- **Distribute evenly among all agents**: round robin (or least busy) over everyone who can open the inbox and is available.
- **Choose agents or teams**: the people or teams you pick, in the editor.
- **Leave in the waiting queue**: nobody is assigned; the chat waits until an agent claims it.

A workspace that never set Everyone else keeps leaving those chats in the waiting queue until an admin chooses.

## Try it

Under the list, **Try it** answers "who would get this chat, and why?". Pick a contact (or none, for a brand-new contact), a channel and a sample message, and select **Show what would happen**. The result names the step that decided: the contact's agent, a rule, Everyone else, or the waiting queue, and goes through every step, which conditions matched and which did not, and who was left out because they are on leave, offline or at their chat limit. For a contact detail that is not saved, it says so. Nothing is assigned, counted or sent: it is safe to use any time. It needs the right to view the inbox settings.

## Where this applies

- When a new chat arrives, and when a customer reopens a finished one nobody holds.
- When a **Human handoff** step in a flow is set to **Assignment rules**: the same list is checked at that moment, using the contact as it is saved right then (anything the flow saved to the contact before the handoff counts), the channel and the customer's latest message, then Everyone else, then the waiting queue.

It does not apply to a chat that someone, a flow or a handoff already assigned, to assigning or claiming by hand, or to a Human handoff step that names a person (the rules are ignored) or a team (the team's own method is used). Rules do not run again for later messages of a chat that is already open, except the extras a rule can do for each message (tags, an automatic reply or a flow); a rule that applies to every conversation never does these on later messages.

## Business hours

Select **Business hours** at the top of the page to set when your team is open. Each day has a switch, an opening time and a closing time. A day that is switched off is closed all day. A closing time before the opening time is a night shift that runs into the next morning. Breaks and holidays are set under **Settings > General > Working hours**, which edits this same schedule.

The **Time zone** is the one your workspace uses for every day and time. Only the workspace owner can change it. The same hours and time zone are used for the **Business hours** condition and for SLA targets that respect business hours. Until you save a schedule, the workspace counts as open all the time, so a rule that says "outside business hours" never fires.

## Plan and access

Rules, Everyone else, Try it and Auto Assignment are part of Smart routing, which comes with some plans or as an add-on ([Smart routing add-on](help:smart-routing-addon)). Each locked control says so and links to Plans and add-ons. Without it the switches your plan allows still work (Assign Agent as Contact Owner works on every plan) and chats wait in the queue to be claimed or assigned by hand. The rule limit counts rules that are switched off too.

## If something looks wrong

- **A rule never fires.** Check it is switched on, that no rule above it applies to every conversation with **Stop when this rule matches** on, and that at least one chosen agent is active, can open the inbox, is not offline or on leave and is under their chat limit. Try it shows which.
- **A rule that uses business hours fires at the wrong time.** Check the time zone under **Business hours**.
- **"Agents unavailable" on a rule.** A chosen person or team was removed or suspended. Edit the rule and take them off.
- **A contact detail rule did not match a new customer.** A new contact has nothing saved yet. Use New or returning contact, or match on the channel or the message instead.
- **A chat was not assigned.** Only a new chat, or one reopened with nobody holding it, is routed. One that already has an agent is never changed.
