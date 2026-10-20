---
id: teams-managers-access
title: Teams, managers and who sees what
summary: How teams, managers, the primary and owning team and the own, team, team and sub-teams and all record scopes fit together for chat, the CRM, or both.
area: getting-started
order: 85
documents: []
keywords:
  [
    teams,
    managers,
    lead,
    primary team,
    hierarchy,
    parent team,
    sub-team,
    visibility,
    scope,
    own records,
    team records,
    all records,
    who sees what,
    permissions,
    deactivate,
  ]
---

## What it is for

One list of teams serves conversations, records and reports. It works the same way for a workspace that only uses chat, one that only uses the CRM, and one that uses both. This guide explains how a team, its manager and a person's primary team fit with what each person can see.

## Teams, managers and the tree

- A **team** is a group of people. A person can be on several teams.
- The **manager** of a team is the person who leads it. They are always a lead member of the team. A team has one manager; other members can also be marked **Lead**.
- A **parent team** puts a team under another team. It organises the list and shows who belongs under whom. It does not change who sees what yet: a manager does not automatically see the records of the sub-teams.
- Both the manager and the parent are optional. A team with neither works exactly like a flat group.

## Primary team

A person's **primary team** is their main team, kept so reports can count them once. A person who is on one team has it as primary; a person on several chooses one, or none. Routing, assignment and visibility always use all of a person's teams, so choosing a primary team never removes anybody from anything.

## What each team can receive

Each team has two switches under **Can receive**:

- **Conversations**: the team can be picked for routing rules, the inbox assign list and the Assign step of a flow.
- **Records**: the team can be picked as a pool in contact assignment rules and when a person's contacts and open deals are reassigned to a team.

Both are on for every team until you change them, so nothing changes by itself. Use them to keep a Support team out of record assignment lists, or a Sales West team out of the inbox lists.

## Who sees what: own, team and all

In **Roles and permissions**, a permission that supports it has a record scope:

- **My records**: the records assigned to you. In a few areas, such as tasks and appointments, things you created count as yours too.
- **My team's records**: records owned by you or by anyone who shares at least one team with you. For conversations it also includes chats assigned to one of your teams.
- **My team and sub-teams**: My team's records plus the records of the people on every team below yours. It needs the team hierarchy feature on your plan.
- **All records**: everything.

Chats that nobody has picked up yet are shown to roles with team access only when the role also has the permission **See conversations that nobody has taken yet**. Roles that could see them before this release keep it.

Being on a team is what makes the team scopes useful, so a role with one of them should belong to someone who is on at least one team. The role editor warns you when members with such a role are in no team.

### The owning team of a record

Contacts, companies, deals and tasks carry an **owning team**: the owner's primary team at the time the owner was set. It feeds reports by team and the **Team** filter in the contacts, deals and tasks lists. It does not give or remove access. A person on two teams counts once, for their primary team, and a person with no primary team belongs to no team in reports.

## When someone is deactivated

When you deactivate a person, the dialog shows how many contacts, open deals and open conversations they hold and asks what to do: give them to the person's team manager, give them to a chosen person, or leave them with the person. Contacts and open deals use the same reassignment as **Leave and delegate**, so you can undo it for 14 days.

The person's team places are kept. While they are inactive they do not show on their teams and they do not give their teammates access to anything. When you reactivate them, they are back on their teams.

## Where to change things

- Teams, managers, parents, members, primary teams and the switches: **Settings, Team and permissions, Teams** ([Teams](help:teams)).
- Who is on which team, and each person's manager: [Team members](help:settings-team).
- What each role may do and the record scope of each permission: [Roles and permissions](help:roles).
