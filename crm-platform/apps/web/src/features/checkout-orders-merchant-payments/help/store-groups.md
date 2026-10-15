---
id: store-groups
title: WhatsApp groups
summary: See the WhatsApp groups your number belongs to and give each one an ordering code, so orders placed from that code are posted into that exact group.
area: store
order: 60
documents: [nav:store]
gates:
  permission: store.groups.read
routes: [/store/groups]
keywords:
  [
    whatsapp groups,
    group code,
    ordering code,
    ordering link,
    wa.me,
    group order,
    mention,
    bot number,
    group directory,
  ]
---

## What it is for

Groups lists the WhatsApp groups your connected number belongs to. When an order is confirmed, it is posted into the customer's group and the customer is mentioned. A short **ordering code** on a group tells the order exactly which group to use, even when a customer is in several of your groups.

## How to use it

1. Open **Groups** in the Store menu.
2. Read the three cards at the top: **Groups synced**, **With ordering code** and **Bot number**, the WhatsApp number the codes are used with.
3. Find a group with the search box, which looks at the group name.
4. Type a short code in the **Ordering code** box of the group, for example `ACME`, and select **Save**. A toast confirms it.
5. Select **Copy ordering link** under a coded group to copy a `wa.me` link to your bot number that pre-types the order message for that group. Share it with the customers of that group.
6. To remove a code, select **Clear**, or empty the box and select **Save**.

## Options and settings

- **Ordering code rules:** up to 48 characters, using only letters, numbers, dots, dashes and underscores. No spaces. An empty box means no code.
- **Unique codes:** two groups cannot share a code. Saving a code another group already uses shows a message under the box.
- **Table columns:** the group name with its WhatsApp id, the number of members, the bot device, when the group was last synced and the code.
- **Bot number:** shows the digits of your connected number with a plus sign and a **Copy number** button. Without a connected number it says so and links to **Channels**.

## Plan and access

You need permission to view groups to open this screen. Saving and clearing codes need the permission to manage groups; without it the codes are shown as plain text and the editing controls are hidden. This screen does not depend on a plan feature.

## If something looks wrong

- **"No groups yet".** The group list is copied from your connected WhatsApp session, and groups appear once that session has synced them. No time is promised for it yet. Make sure a number is connected in **Channels**.
- **"Another group already uses this code."** Pick a different code.
- **The code is refused.** Keep it to 48 characters of letters, numbers, dots, dashes and underscores.
- **"This record changed while you had it open" after saving.** Someone changed the group at the same time. The list reloads, then save again.
- **No ordering link under a group.** The link needs both a saved code and a connected bot number.
