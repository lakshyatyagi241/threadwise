---
id: team-access
title: How team access works
summary: What "All records", "Team records" and "Own records" mean for chats and for contacts, deals and other records, and why a colleague's item may not show.
area: settings
order: 65
documents: [tile:teams]
keywords: [team, access, scope, own records, team records, all records, visibility, who can see, permissions, contacts, conversations]
---

## What it is for

Every role says, for each permission, how far a person may reach: **All records**, **Team records** or **Own records**. The same three words apply to chats and to the CRM (contacts, companies, deals, tasks, invoices, appointments, forms and call logs), so this page explains them once. A team is a group of people you make under **Settings**, **Team and permissions**, **Teams**.

## What each choice means

- **All records**: everything in the workspace, whoever it belongs to.
- **Own records**: what is yours.
  - In the CRM, a record is yours when you are its owner or assignee, or when you created it. A record you created stays visible to you even after you hand it to a colleague.
  - In chats, a conversation is yours when it is assigned to you.
- **Team records**: what is yours, plus what belongs to the people who share at least one team with you.
  - In the CRM, that means records owned, assigned or created by you or by anyone who is in a team with you. Being in two teams reaches the people of both.
  - In chats, that means conversations assigned to you or to one of your teams, and also conversations nobody has taken yet, so a team can pick them up from the shared queue.

A record that has no owner and no creator is seen only by roles with **All records**.

## How to use it

1. To change how far a role reaches, open **Settings**, go to **Team and permissions**, select **Roles and permissions** and choose the scope next to the permission (see [Roles and permissions](help:roles)).
2. To put someone in a team, open **Teams** and tick them as a member (see [Teams](help:teams)).
3. To give a record to a colleague, change its owner. They then see it under **Own records**, and so do the teammates of that colleague under **Team records**.

## Things to know

- **A person in no team** with **Team records** sees their own records and nothing more, because there are no teammates to add.
- **Opening a record follows the same rule as the list.** If a record is not in your list, opening its link directly says it was not found.
- **The contact panel in a chat** follows your contact access. If the contact belongs to someone outside your reach, the chat opens and shows the contact's name, but not the contact's details.
- **Record assignment** only offers a record to people who can open that kind of record. In **Test with a record**, anyone left out is listed with the reason.
- **Deleting a team** removes it from routing rules, record assignment rules and shared segments, and people who were only connected through it stop seeing each other's records under **Team records**. The delete confirmation lists these before you confirm.

## Plan and access

Choosing scopes needs the permission to manage roles. Seeing which team someone is in needs nothing special. Custom roles and teams are available on every plan in this release.

## If something looks wrong

- **I cannot see a colleague's contact.** Check your role's scope for contacts: with **Own records** you see only what you own or created. With **Team records** you also need to share a team with the owner.
- **A deal I created has disappeared from my list.** Deals created before this release do not remember who created them, so only their owner sees them under **Own records**. New deals remember their creator.
- **A chat is missing for an agent.** With **Own records** an agent sees only the conversations assigned to them. Use **Team records** to include their team's chats and the unassigned queue.
