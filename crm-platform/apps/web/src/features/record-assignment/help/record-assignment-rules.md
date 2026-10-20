---
id: record-assignment-rules
title: Record assignment rules
summary: Give new contacts, companies and deals that have no owner to the right sales owner automatically, by priority rules.
area: settings
order: 62
documents: [tile:record-assignment]
gates:
  planFeature: record_assignment
keywords:
  [
    record assignment,
    auto assign,
    owner,
    new contact,
    new company,
    new deal,
    round robin,
    workload,
    lead routing,
    fallback,
    priority,
    on leave,
    delegate,
    run log,
    territory,
  ]
---

## What it is for

Record assignment rules give a new contact, company or deal its owner without anyone doing it by hand. You write rules for each of the three modules. They are tried in priority order, and the first rule that matches and finds someone available gives the record its owner. It is switched off until you turn it on.

Only records without an owner are assigned. An owner a person set is never replaced, and neither is an owner someone cleared on purpose. Reassigning on update is off by default and only ever applies to records this engine assigned itself.

## How to use it

1. Open **Settings**, go to **Automation** and select **Record assignment rules**.
2. Switch on **Turn on record assignment**. Tick **Also assign imported records** only if you want imports included. It is off so a big import does not reshuffle who owns what.
3. Choose the module tab, then select **Create rule**.
4. Give the rule a name and add its conditions: pick a field, then how to compare it, then a value. Join conditions with **All (AND)** or **Any (OR)** and use **Add group** for more complex rules. Leave the conditions empty to make a fallback rule.
5. Under **Assign to**, choose the method and the people or teams, then select **Save and activate**, or **Save as paused** to prepare it without using it yet.
6. Use **Test with a record** to pick a real record and see which rule would take it and who would get it. Nothing is changed. Under each rule, **Left out** names the people the rule could not use and why: they cannot open that kind of record, they are no longer active, they are on leave today, or they are offline.

## Priority and fallback

- The number on each row is its priority. Priority 1 runs first.
- Drag a row by its handle, or use the arrow buttons, to change the order. A record that matches several rules goes to the one with the highest priority.
- Only active rules are prioritised. A paused rule keeps its place but never runs.
- A rule with no conditions matches every record. It is the fallback and runs after all the other rules, wherever it sits in the list.
- A rule marked with a warning has a condition that points at something deleted, such as a removed property or tag. That condition matches nothing until you fix it.

## Methods

- **Round robin.** Takes turns between the people, in a steady order, so people joining or being away never make it repeat or jump.
- **Least open workload.** Gives the record to the person who owns the fewest records of that module right now. For deals only open deals count. Ties take turns.
- **Specific user.** Always the same person.

## Who is available

- People on leave are always skipped. A specific-user rule uses that person's delegate while they are away.
- People who are offline are skipped when **Skip people who are offline** is on, which is the default.
- If a rule matches but nobody is available, the next rule is tried and the run log records that nobody was available.

## Teams are a pool of people

A team on a rule is only a pool of people to choose from. A record does not belong to a team: its owner is one of the team's members. This is different from territories, which divide records between teams.

## The run log

Each module has a **Run log** that shows what the engine did with every record, newest first: assigned, reassigned or left alone, the reason, the rule, who got it and how the record arrived. Open **Show how it was decided** to see every rule that was tried. Entries are kept for 90 days and hold ids only, never the contents of a record.

## Plan and access

Seeing the rules needs the permission to view record assignment. Changing them and the switch need the permission to manage it. Managers and above have both by default. Your plan needs the Record assignment rules feature. This is separate from Conversation auto-assignment, which assigns conversations in the inbox.

## If something looks wrong

- **Nothing is assigned.** Check the switch is on, the rule is active, and the record had no owner when it arrived. Use **Test with a record** with the same record.
- **A rule matches but nobody gets it.** Everyone it names is on leave, offline, no longer active, or cannot open that kind of record (the role needs the permission to see contacts, companies or deals). **Test with a record** shows who was left out and why. Add a team or another person, give the role the permission, name a delegate, or turn off **Skip people who are offline**.
- **Imported records are not assigned.** Turn on **Also assign imported records**.
- **The rule list changed after I saved.** Someone else edited the rule. The latest version is loaded, so check it and apply your change again.
