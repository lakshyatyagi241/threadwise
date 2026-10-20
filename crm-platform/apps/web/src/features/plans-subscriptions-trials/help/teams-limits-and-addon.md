---
id: teams-limits-and-addon
title: Teams limits and the Teams and permissions add-on
summary: How many teams a plan allows, which plans have parent teams and custom roles, and the add-on that adds them.
area: getting-started
order: 85
features: [team_hierarchy, custom_roles]
keywords: [teams, limit, solo, hierarchy, manager, custom roles, add-on, plan, scope]
---

## What it is for

Three things about teams depend on the plan:

- **How many teams** the workspace may have (the **Teams** limit).
- **Team hierarchy and managers**: parent teams, and team leads or managers who see their team and the teams below it.
- **Custom roles and scopes**: creating and editing roles, and choosing for each permission whether it covers your own records, your team's records or all records.

Plans that existed before these options keep everything: no team limit, hierarchy on and custom roles on. Nothing changes until an operator edits a plan or sells the add-on.

## What you see

- **Solo plan (limit 0).** Creating a team is refused with the message "Your plan doesn't include teams". Nothing else about the workspace changes.
- **Plan with a limit (for example 3).** You can create teams until you reach it. After that the message says how many your plan allows. Delete a team, or upgrade, to add more. Teams you already have are never removed when a plan changes.
- **Roles without custom roles.** The Roles screen still lists every role and people keep the access they have. The **Add role** button turns into an upgrade link and role pages are read only.
- **Hierarchy.** Parent teams and managers arrive with the Teams update. The plan switch is already in place and ready for it: with it off, those fields will not be offered. Today it changes nothing you can see.

## The Teams and permissions add-on

The add-on gives a workspace on any plan team hierarchy, custom roles and extra teams. It is added to the workspace like other add-ons and stops when it ends. When it ends nothing is deleted: teams and roles stay, and the workspace is simply held to its plan's limit again.

## For operators

1. In the operator console open **Plans**, pick the plan and go to **Limits**. **Teams** blank means unlimited, **0** means solo, a number is the cap.
2. Go to **Features** to switch **Team hierarchy and managers** and **Custom roles and scopes** on or off for the plan. They sit under Platform, because both the Chat side and the Sales CRM side use them.
3. To sell the add-on, open **Add-ons** and find **Teams and permissions**. It is created as a draft: inactive and without a price. Set the price, tick the extra teams you want to include, and switch it on. Then add it to a workspace like any other add-on.
4. A single workspace can differ from its plan with an override on the workspace page, for example Teams 0 for solo or -1 for unlimited.

## If something looks wrong

If someone cannot create a team, read the message: "doesn't include teams" means the limit is 0, "reached your plan's limit" means it is full. If a role cannot be created or edited, check the **Custom roles and scopes** feature on the plan and the add-on on the workspace.
