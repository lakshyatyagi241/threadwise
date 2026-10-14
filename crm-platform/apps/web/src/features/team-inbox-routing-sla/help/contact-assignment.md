---
id: contact-assignment
title: Contact assignment
summary: Give new contacts and deals that have no owner to the right person automatically, skipping people on leave.
area: settings
order: 62
documents: [tile:contact-assignment]
keywords:
  [
    contact assignment,
    auto assign,
    owner,
    new contact,
    new deal,
    round robin,
    least busy,
    lead routing,
    on leave,
    delegate,
    rules,
  ]
---

## What it is for

Contact assignment gives a new contact or a new deal its owner without anyone doing it by hand. You write rules, tried from the top; the first rule that matches and finds someone available gives the owner. It is switched off until you turn it on.

An owner somebody already set is never replaced, even if they deliberately cleared it. Rules only fill an empty owner on a record that is new.

## How to use it

1. Open **Settings**, go to **Automation** and select **Contact assignment**.
2. Switch on **Assign new contacts and deals automatically**. Tick **Also assign imported contacts** only if you want imports included; it is off so a big import does not reshuffle ownership.
3. Select **New contact rule** or **New deal rule**. Give it a name, choose **Who takes it** (one person, round robin, or least busy) and tick the people and teams.
4. Fill in the conditions that must match, or leave them empty to match everything.
5. Use the arrows to put the rules in order and the switch to turn one off. **Test the rules** at the bottom shows who a described contact or deal would get, without changing anything.

## Who takes it

- **One person.** If they are on leave, their delegate takes their place; with no available delegate the rule finds nobody and the next rule is tried.
- **Round robin.** Takes turns. The rotation continues after the last person, so people joining or being away never make it repeat or jump.
- **Least busy.** The person who owns the fewest contacts (for contacts) or open deals (for deals) right now; ties take turns.
- People on leave are always skipped. People who are offline are skipped unless you untick **Skip people who are offline**.

## The conditions

- **Contacts:** source, country, the number a phone starts with (country code), lifecycle stage, how it arrived (a person, import, first message, form, lead source or API) and custom properties that equal a value.
- **Deals:** pipeline, source and a value range.

All conditions you fill in must match. Capital letters do not matter.

## Plan and access

Seeing the rules needs the permission to view contact assignment; changing them and the switch need the permission to manage it. Managers and above have both by default. Your plan needs the routing rules feature, the same one as Auto-assignment.

## If something looks wrong

- **Nothing is assigned.** Check the switch is on, the rule is on, and the contact had no owner when it arrived. Use the test box with the same details.
- **A rule matches but nobody gets it.** Everyone it names is on leave or offline. Add a team, name a delegate, or untick **Skip people who are offline**.
- **Imported contacts are not assigned.** Turn on **Also assign imported contacts**. An import that does not raise automations is never assigned.
