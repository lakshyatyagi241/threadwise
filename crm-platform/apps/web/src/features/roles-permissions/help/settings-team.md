---
id: settings-team
title: Team members (Settings)
summary: Add people to the workspace, see their teams and managers, change their roles and deactivate or reactivate their access.
area: settings
order: 50
documents: [tile:workspace-team]
keywords:
  [
    team,
    members,
    add member,
    invite,
    deactivate,
    reactivate,
    roles,
    staff,
    teams,
    manager,
    filter by team,
    hand over,
  ]
---

## What it is for

This is the Team members screen in Settings. Here you add people to the workspace by sending them an invite link, see which teams each person is on and who manages them, change which roles they hold, and turn their access off or on. The list can be filtered by role or by team and searched by name or email.

## How to use it

1. Open **Settings**, go to **Team and permissions** and select **Team members**.
2. To add someone, select **Add member**. Enter their full name and email and choose a role. The default is Agent. Then select **Send invite**. They get an email with a one-time link to set their own password. The number of seats in use is shown under the button.
3. To change roles, select **Change role** on the member's row, tick the roles they should hold (at least one) and select **Save roles**.
4. To deactivate someone, select **Deactivate**. If they own contacts, open deals or open conversations, the dialog asks what should happen to them (see below). Confirm to switch their access off. Select **Reactivate** to restore it.
5. Use the role chips above the list to show only one role, the team list to show only one team, or type in the search box.
6. Select **More** on a row for the other actions: [change phone and chat limit, leave and delegate, resend an invite, reset a password and remove from the workspace](help:team-members).

> If the email cannot be sent, the screen shows the invite link once. Copy it and hand it over; it is not shown again.

## Teams and managers

- **Teams** lists the teams a person is on, with a small **primary** mark on their main team. A person on no team shows **No team**.
- **Manager** shows who manages them: the manager of their primary team, or the managers of all their teams if they have no primary team. It is empty for a team's own manager.
- Teams and managers are set in [Teams](help:teams), not here. People who are inactive show no teams, but their places are kept.

## When you deactivate someone

The dialog counts what the person holds and offers three choices:

- **Give them to the team manager**: the nearest active manager of the person's teams, the primary team first.
- **Give them to a person**: you choose an active member.
- **Leave them with the person**: nothing is moved.

Contacts and open deals move as one batch that you can undo for 14 days; open conversations are reassigned one by one. Moving needs the right to edit contacts and to assign conversations. Their team places are kept, so reactivating the person puts them back on their teams.

## Options and settings

- **Role filter**: All, then one chip per role with its member count.
- **Team filter**: All teams, then each team with how many of the people shown are on it.
- **Search**: matches name or email.
- **Status**: Active or Inactive. Inactive members stay in the list.

## Plan and access

Opening this screen needs the permission to manage users. Adding a member needs the permission to invite members, and changing roles needs the permission to assign member roles. Owners and Admins hold these by default. You cannot change your own role or deactivate your own account, and you cannot change someone whose role is above yours. Only an Owner can change an Owner.

## If something looks wrong

- **The role list is missing or unavailable.** Your role cannot list roles, so you can read the members but cannot add members or change roles.
- **Add member says the seat limit is reached.** Your plan limits the number of team seats. Deactivated members do not count; an Owner can upgrade the plan.
- **The invite email did not arrive.** The screen shows the link when the mail could not be sent. Otherwise check the spam folder, or resend the invite from **More**.
- **Deactivate says it could not move the work.** The person who would take over may be outside what you are allowed to assign to, or may not be able to open the inbox. Choose another person, or leave the work with them and move it later.
- **The Teams column is empty for everybody.** No teams exist yet, or none has members. Create teams in [Teams](help:teams).
