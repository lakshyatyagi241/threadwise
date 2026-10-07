---
id: personal-whatsapp-connect
title: Connect a personal WhatsApp number
summary: Link a WhatsApp number by QR code or pairing code, see its status, and disconnect or delete it. Unofficial: WhatsApp can restrict the number.
area: inbox
order: 40
documents: [nav:devices]
keywords: [personal number, qr code, pairing code, linked devices, unofficial, ban risk, disconnect, whatsapp web]
---

## What it is for

Personal WhatsApp links a number you already use to this workspace the way WhatsApp Web does. The number then works in the shared inbox, in campaigns, scheduled messages and flows. This page is only available to workspaces that the platform operator has allowed.

> This is not an approved way to automate WhatsApp. WhatsApp can restrict or permanently ban the number at any time, including for normal use, and we cannot prevent it or get a banned number back. For serious or long-term use, the official WhatsApp Business route is the lower-risk one: see [Connect WhatsApp Business](help:whatsapp-numbers-overview).

Every private chat on a linked number, not only business chats, appears in this workspace's shared inbox for members who can read the inbox. Messages you type on the phone are copied there too.

## How to connect a number

1. Open **Personal WhatsApp** in the menu, under Inbox & Chat.
2. Select **Connect a number**.
3. Read **Before you connect** and tick all three boxes. Each person who connects a number accepts the notice for themselves. If the notice changes, you are asked again.
4. Select **I accept and continue**.
5. Enter a **Name** for your team and the **WhatsApp number** with its country. It must be the number of the phone you will link. Leave **Use for sending after linking** ticked if campaigns, scheduled messages and flows may use it.
6. Choose how to link it.
   - **Scan a QR code**: open WhatsApp on that phone, go to Linked devices, then Link a device, and point the camera at the code. The code refreshes by itself, and the page shows how long is left.
   - **Use a pairing code**: open WhatsApp on that phone, go to Linked devices, then Link a device, then Link with phone number instead, and type the 8-character code. The number needs its country code. The code is valid for about 3 minutes, and you can copy it.
7. Wait for **Connected**. The page shows the steps Code shown, Scanned and Ready.

> Only enter a pairing code on the phone of the number you are connecting. Never share it with anyone else. A code entered on someone else's phone links that person's whole WhatsApp account to this workspace.

## What each status means

- **Not linked yet**: the number was added but never linked. Select **Connect**.
- **Waiting for scan** and **Waiting for code**: a QR code or pairing code is on screen and has not been used.
- **Connecting**: WhatsApp is syncing. Nothing is asked of you.
- **Connected**: the number is linked.
- **Disconnected**: the link was closed. Select **Reconnect**.
- **Link ended by WhatsApp**: WhatsApp ended the link. This happens when the device is removed in WhatsApp, under Linked devices, and also when WhatsApp restricts a number. We cannot tell which. Your chats are kept and you can link it again.
- **Could not connect**: the attempt failed, and the page says why, for example that the code was not scanned in time, or that the phone that scanned is not the number you entered. Select **Try again**.

## Limits and good practice

- The page shows how many numbers you use, for example **1 of 2 numbers**. At the limit, **Connect a number** is disabled until you delete one or the limit changes.
- Starting a link too many times in a short while is refused for a time, and the page says how long to wait.
- Warm the number up slowly and keep volumes low. See [WhatsApp warmer](help:whatsapp-warmer-overview).
- A ban is not covered by support.

## Rename, disconnect or delete

- **Rename** changes the name your team sees.
- **Disconnect** unlinks the number and removes its saved session. If the connection service cannot be reached, the page tells you to also remove the device in WhatsApp, under Linked devices.
- **Delete** does the same and removes the number from the workspace, which frees one place. Conversations stay readable in the inbox but can no longer be answered from that number.

## Who can do what

You need permission to see the numbers (**wa.devices.read**), and separate permissions to add and rename, to link, to disconnect and to delete. By default only workspace admins have them. If a button is missing, ask an admin.

## If something looks wrong

- **The Personal WhatsApp entry is missing.** Your workspace is not allowed to use personal numbers, or your role cannot see them. Ask a workspace admin, or the platform operator if the workspace is not allowed.
- **The page says the feature is no longer enabled.** The operator turned it off for your workspace. Your numbers and chats are kept.
- **The connection service is not available.** Try again in a few minutes.
- **The QR code expired.** Select **Try again** to get a new one.
