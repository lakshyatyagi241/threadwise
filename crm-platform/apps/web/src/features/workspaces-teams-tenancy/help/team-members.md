---
id: team-members
title: Team member actions
summary: Change a person's phone and chat limit, record leave and a delegate, resend an invite, reset a password or remove someone, from the More menu on Team members.
area: settings
order: 70
documents: [tile:workspace-team]
keywords:
  [
    team members,
    invite,
    resend invite,
    teammate,
    staff,
    agents,
    seats,
    reset password,
    remove,
    leave,
    holiday,
    time off,
    on leave,
    delegate,
    reassign,
    concurrent chats,
    chat limit,
    phone,
    last login,
    available,
    offline,
    availability,
    more menu,
  ]
---

## What it is for

The **More** menu on each row of Team members holds everything you do to one person besides changing roles and deactivating them: set how many chats an agent takes at once, record time off and a delegate, hand over the work of someone who is away, send an invite again, reset a password, and remove access when someone leaves. Adding people, roles, teams and managers are covered in [Team members (Settings)](help:settings-team).

## How to use it

1. Open **Settings**, go to **Team and permissions**, select **Team members**, then select **More** on the person's row. Only the actions you may use are listed.
2. **Change phone and chat limit**: set a phone number with its country code and **Concurrent chats** (empty means no limit), then save.
3. **Leave and delegate**: record time off and name a delegate. Everyone can do this for themselves; managers can do it for anyone.
4. **Resend invite**: sends a pending invite again.
5. **Reset password**: sends the person a link to choose a new password. Without email, a one-time link is shown.
6. **Remove from workspace**: asks what happens to the person's work first, like Deactivate, then ends their access straight away. Their account and their team places are kept.

The old address `/team-members` now opens this screen, and the link in the "went on leave" notice opens that person's leave dialog.

> Seats in use against your plan limit are shown under the **Add member** button.

## Concurrent chats and availability

- **Concurrent chats** is the most open chats automatic assignment gives one agent at once. When an agent already holds that many open chats, round robin and least busy skip them until one is resolved or moved. Empty means no limit. Picking someone by hand is still allowed.
- **Last login** is read only. It is the last time the person signed in, shown in your workspace time zone (set in your account settings). **Never** means they have not signed in yet.
- **Available / Offline.** Open the account menu (your avatar at the top right) and use the **Availability** switch. While you are **Offline**, nothing is assigned to you automatically; chats you already have stay yours. Switch back to **Available** to receive new chats again.

## Leave, delegate and reassigning work

Someone who is **on leave** is skipped by automatic assignment. Dates are days in your workspace calendar, so "until 20 Oct" means the whole of the 20th, and the person is back on the 21st. A leave can start today or later, have no end date yet, and be ended early with **End leave now**. Only the person and their managers see the reason.

- **Automatic assignment skips people on leave.** New chats, form and lead owners, and the rules in **Contact assignment** never pick them. Picking someone by hand is still allowed; the pickers just show **On leave until**.
- **Delegate.** Name a colleague who covers while you are away. When a rule or the inbox would have chosen you, the delegate takes your place if they are available; otherwise the team pool decides, and if nobody can take a new chat the managers are told. A delegate does not get access to your contacts: only new work is redirected.
- **Reassign contacts and deals.** In the same dialog, managers can give a person's contacts and open deals to a person, to their delegate, or round robin to a team that can receive records. You see how many will move before you confirm. Tick **Bring them back** to return them on the day the person is back: only contacts and deals nobody has changed since come back. You can also **Undo** for 14 days.
- When someone goes on leave, managers get a notice with the number of contacts and open chats they hold and a link to reassign them.

## Plan and access

Setting your own leave needs no special rights; setting someone else's, naming their delegate and reassigning their work need the leave management permission with the "all" scope (Managers and above) and, for moving contacts and deals, the permission to edit them. Changing a phone number or chat limit, resending an invite, resetting a password and removing members need the permission to invite members. The Available / Offline switch is only ever yours. You cannot act on yourself or on someone of a higher role, and only an Owner can act on an Owner.

## If something looks wrong

- **Invite says all seats are in use.** Your plan limits the number of seats. Upgrade the plan from [Plans](/account/plans) to add more people.
- **An agent gets no new chats.** Check that they are **Available** in their account menu, not on leave, and below their **Concurrent chats** number.
- **A row has no More menu.** You do not have the permission for any of those actions, or the member ranks above you.
- **Reset or invite says email was not sent.** Use the one-time link that is shown; it works once and the invite link expires after 7 days.
