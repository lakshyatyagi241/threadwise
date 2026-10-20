---
id: teams
title: Teams
summary: Group people for conversations, assignments and reports; give each team a manager, an optional parent team and a choice of where it can be used.
area: settings
order: 80
documents: [tile:teams]
keywords:
  [
    teams,
    groups,
    departments,
    manager,
    lead,
    parent team,
    sub-team,
    hierarchy,
    primary team,
    assignment,
    routing,
    colour,
  ]
---

## What it is for

Teams group people for conversations, assignments and reports. The same team can take chats, own contacts, companies and deals, and be a column in a report, so you keep one list of teams whether your workspace uses chat, the CRM or both. Each team has a name, a colour, a description, an optional manager, an optional parent team, its members, and two switches that say where the team can be used.

## How to use it

1. Open **Settings**, go to **Team and permissions** and select **Teams**.
2. The list shows teams as a tree: a sub-team sits indented under its parent. Each row shows the manager, how many members the team has and how many are online, what the team can receive, and where it is used (routing rules, assignment rules, shared segments, conversations and sub-teams).
3. To create a team, select **Create team**. Enter a name (up to 64 characters), pick a colour and optionally add a description, a **Manager**, a **Parent team** and its members, then select **Create team**.
4. To change a team, select the pencil on its row, change what you need and select **Save changes**.
5. To delete a team, open it and select **Delete team**. The confirmation lists what will change: the people who leave the team, the routing rules and record assignment rules that name it, the segments shared with it, the conversations assigned to it and the people who would stop seeing each other's records under **My team's records**. Then confirm. The team is removed from those rules (a routing rule left with nothing to do is switched off), conversations assigned to it keep their place with no team, and its sub-teams move up one level.

For what the team scopes (including **My team and sub-teams**) and the owning team mean, see [How team access works](help:team-access).

> Open **How teams work** at the top of the page for a short summary.

## Options and settings

- **Manager**: the person who leads the team. They are added to the team as a lead. If the manager is deactivated, the team shows no manager until they come back, and the choice is kept.
- **Parent team**: puts the team under another team so you can build a tree such as Sales and Sales West, up to 5 levels. A team cannot sit under itself or under one of its own sub-teams.
- **Can receive**: **Conversations** lets the team be picked in routing rules, in the inbox assign list and in the Assign step of a flow. **Records** lets it be picked as a pool in contact assignment rules and when you reassign a person's work to a team. Turn one off to keep the team out of those lists; a team that is off is also skipped by rules that already point at it.
- **Members**: tick the people on the team. Mark the ones who are **Lead**, and choose each person's **Primary** team. A person on exactly one team always has it as their primary team.
- **Primary team**: a person's main team, kept for reports. It decides the **owning team** of the records they own (used for reports by team and the Team filter in the contacts, deals and tasks lists). Routing, assignment and visibility use every team a person is on, so nobody drops out of anything because of it. A person with no primary team belongs to no team in reports.
- **Stored, not used yet**: the auto-assignment strategy, a device limit, business hours, a time zone and a default assignee are kept on the team, but nothing reads them yet. They are listed at the bottom of the team's dialog so nothing is hidden.

## Plan and access

Seeing the list needs the permission to see teams (`team.read`); Owners, Admins, Managers and Agents hold it by default, Viewers do not. Creating, editing and deleting teams, choosing managers and changing who is on a team need the permission to manage teams (`team.manage`), held by Owners, Admins and Managers. The older permission **Create, edit and delete teams** (`inbox.team.manage`) still works for one more release. This screen has no plan requirement.

## If something looks wrong

- **The create button is missing.** Your role can read teams but not manage them.
- **You cannot see Teams at all.** Your role does not include the permission to see teams. Ask an Owner or Admin.
- **Save says the name is taken.** Each team needs a unique name; choose another.
- **Save says the parent is not available.** The team would sit under itself or one of its sub-teams, or the tree would go deeper than 5 levels.
- **A team does not appear in a picker.** Check its **Can receive** switches: a team that does not receive conversations is left out of the inbox lists and routing rules, and one that does not receive records is left out of assignment rules.
- **The member list says it could not be loaded.** Close the dialog and try again. Check your connection if it keeps failing.
- **A team shows no devices.** Device limits are not available in this release, so teams are not limited to a device.

See also [Teams, managers and who sees what](help:teams-managers-access).
