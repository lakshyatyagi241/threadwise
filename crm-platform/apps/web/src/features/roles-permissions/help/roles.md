---
id: roles
title: Roles and permissions
summary: Decide what each role can see and do, by ticking permissions in the matrix and choosing allow or deny.
area: settings
order: 60
documents: [tile:roles]
keywords: [roles, permissions, access, admin, manager, agent, viewer, deny, rbac]
---

## What it is for

Roles decide what members can do in the workspace. The list shows the five preset roles (Owner, Admin, Manager, Agent and Viewer) and any custom roles you have made, with how many members hold each one and how many permissions it has.

## How to use it

1. Open **Settings**, go to **Team and permissions** and select **Roles and permissions**.
2. To change a role, select its name or **Edit role** from its menu. Its details and the permission matrix open.
3. Tick a permission to grant it. For a granted permission, choose **Allow** or **Deny**. Deny always wins, even when another role of the member allows the same permission.
4. Where a permission supports it, choose the record scope: **All records**, **My team's records** (records owned by you or by anyone who shares a team with you) or **Own records**. [Teams, managers and who sees what](help:teams-managers-access) explains how they fit together.
5. To start from an existing role, pick it under **Start from role**. Its permissions are copied into the matrix, and you can then change them.
6. Select **Save changes**, or **Create role** for a new role.

To delete a custom role, open its editor and select **Delete role**. A role that members still hold cannot be deleted; move those members to another role first.

> If you leave the editor with unsaved changes, the page asks you to confirm.

## Options and settings

- **Role name**: required for a custom role, up to 120 characters. Preset role names cannot be changed.
- **Permission matrix**: grouped by area, with search, a select-all for each group and a count of what is selected.

## Plan and access

Opening this screen needs the permission to manage roles. The Owner role holds every permission and cannot be changed. Only an Owner can change the Admin role's permissions. The preset roles cannot be renamed or deleted.

## If something looks wrong

- **Someone else changed the role.** The page says so. Select **Reload** to see their version, then apply your change again.
- **Save says you cannot grant a permission.** You can only grant permissions you hold yourself.
- **The role has no delete option.** Preset roles cannot be deleted, and a role with members cannot be deleted either.
