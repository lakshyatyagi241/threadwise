---
id: team-access
title: How team access works
summary: What "My records", "My team's records", "My team and sub-teams" and "All records" mean for chats and the CRM, what the owning team is, and why a colleague's item may not show.
area: settings
order: 65
documents: [tile:teams]
keywords: [team, access, scope, own records, team records, sub-teams, hierarchy, owning team, unassigned conversations, all records, visibility, who can see, permissions, contacts, conversations]
---

## What it is for

Every role says, for each permission, how far a person may reach: **My records**, **My team's records**, **My team and sub-teams** or **All records**. The same words apply to chats and to the CRM (contacts, companies, deals, tasks, invoices, appointments, forms and call logs), so this page explains them once. A team is a group of people you make under **Settings**, **Team and permissions**, **Teams**.

## What each choice means

- **All records**: everything in the workspace, whoever it belongs to.
- **My records**: what is yours.
  - In the CRM, a record is yours when you are its owner or assignee, or when you created it. A record you created stays visible to you even after you hand it to a colleague.
  - In chats, a conversation is yours when it is assigned to you.
- **My team's records**: what is yours, plus what belongs to the people who share at least one team with you.
  - In the CRM, that means records owned, assigned or created by you or by anyone who is in a team with you. Being in two teams reaches the people of both.
  - In chats, that means conversations assigned to you or to one of your teams. Conversations that nobody has taken yet are a separate permission (see below).
- **My team and sub-teams**: the same as My team's records, plus the people of every team below your teams. Use it for managers, so a head of Sales also reaches Sales West and Sales East. It needs the team hierarchy feature on your plan; a role that already uses it keeps working if the feature is switched off, but you cannot choose it for another role until it is back on.

### Conversations that nobody has taken yet

A separate permission, **See conversations that nobody has taken yet**, decides whether a role whose conversation access is set to a team scope also sees the open queue of conversations assigned to nobody. Without it, those agents see only conversations assigned to them or to their team. With it they also see the queue and can pick conversations up. Roles that read conversations at team level before this release were given it, so nothing changed for them. It has no effect for **All records**, which sees everything anyway.

## The owning team of a record

Contacts, companies, deals and tasks also show which team they belong to for reports. That is the **owning team**: the primary team of the owner at the moment the owner was set, updated when the record is reassigned. It is used for the **Team** filter in the contacts, deals and tasks lists and for reports by team, **not** for access: who may open a record still depends on the owner and the scope above.

- A person on two teams counts once, for their primary team.
- A person with no primary team has no team, so their records are listed under no team in reports and are left out when you filter by a team.

A record that has no owner and no creator is seen only by roles with **All records**.

## How to use it

1. To change how far a role reaches, open **Settings**, go to **Team and permissions**, select **Roles and permissions** and choose the scope next to the permission (a line above the matrix explains each choice) (a line above the matrix explains each choice) (see [Roles and permissions](help:roles)).
2. To put someone in a team, open **Teams** and tick them as a member (see [Teams](help:teams)).
3. To give a record to a colleague, change its owner. They then see it under **My records**, and so do the teammates of that colleague under **My team's records**.

## Things to know

- **A person in no team** with **My team's records** or **My team and sub-teams** sees their own records and nothing more, because there are no teammates to add. The role editor warns you when members with the role are in no team, and links to **Teams** so you can add them.
- **Opening a record follows the same rule as the list.** If a record is not in your list, opening its link directly says it was not found.
- **The contact panel in a chat** follows your contact access. If the contact belongs to someone outside your reach, the chat opens and shows the contact's name, but not the contact's details.
- **Record assignment** only offers a record to people who can open that kind of record. In **Test with a record**, anyone left out is listed with the reason.
- **Deleting a team** removes it from routing rules, record assignment rules and shared segments, and people who were only connected through it stop seeing each other's records under **My team's records**. The delete confirmation lists these before you confirm.

## Plan and access

Choosing scopes needs the permission to manage roles. Seeing which team someone is in needs nothing special. Custom roles and teams are available on every plan in this release. **My team and sub-teams** needs the team hierarchy feature. **My team and sub-teams** needs the team hierarchy feature.

## If something looks wrong

- **I cannot see a colleague's contact.** Check your role's scope for contacts: with **My records** you see only what you own or created. With **My team's records** you also need to share a team with the owner.
- **A deal I created has disappeared from my list.** Deals created before this release do not remember who created them, so only their owner sees them under **My records**. New deals remember their creator.
- **A chat is missing for an agent.** With **My records** an agent sees only the conversations assigned to them. Use **My team's records** to include their team's chats, and give the role **See conversations that nobody has taken yet** to include the unassigned queue.
- **A team filter hides a record.** The Team filter matches the record's owning team. A record whose owner has no primary team belongs to no team and does not appear under any team.
