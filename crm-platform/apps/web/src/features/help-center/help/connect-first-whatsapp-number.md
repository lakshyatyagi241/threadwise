---
id: connect-first-whatsapp-number
title: Connect your first WhatsApp number
summary: Connect a WhatsApp Business number to your workspace, check that it is healthy and that incoming messages arrive, then answer a first test message.
area: getting-started
order: 10
documents: [tile:whatsapp]
keywords:
  [whatsapp, connect, first number, facebook, meta, token, health, inbound, test message, setup]
---

## What it is for

Nothing can be sent or received on WhatsApp until a number is connected. This guide walks you through the first connection from start to finish: connect the number, check it, and answer a message to prove it works. For the full list of what you can do with a number afterwards, see [WhatsApp numbers](help:whatsapp-numbers-overview).

## Before you start

- You need a WhatsApp Business account with Meta and a phone number you can use with the WhatsApp Cloud API.
- You need the right to connect WhatsApp numbers. Owners and Admins have it by default.
- If you plan to paste a token instead of signing in with Facebook, have the **Phone Number ID**, the **WABA ID** and a permanent access token ready. Find them in Meta Business Suite under WhatsApp Manager, then API Setup. The token needs the WhatsApp business messaging and business management permissions.

## Connect the number

1. Open **Settings**, then **WhatsApp** under Channels. You can also go to `/channels/whatsapp`. With no number connected yet, the page says **Connect your first WABA number**.
2. Select **Continue with Facebook**, sign in with Meta in the window that opens and pick the number. If you use the WhatsApp Business app on your phone and the option is offered, **Connect my existing Business App number** keeps the app working next to this workspace. Meta shows a QR code to scan from that app.
3. To connect with a token instead, select **or paste credentials manually** (or **Add WABA account** when Facebook sign-in is not set up). Fill in **Phone Number ID**, **WABA ID** and **Access Token**. The **Business Manager ID** is optional. Select **Verify token** to check it, then **Probe + connect**.
4. When it works, a message confirms the number is connected. A first number is made the primary number automatically.

> Use a permanent System User token. A 24-hour token stops working the next day and the number will show a problem.

## Check that it works

1. Look at the number's card. It should show **Connected**, and **Inbound wired**.
2. If it shows **Inbound not wired**, select **Fix inbound** and confirm. This points incoming messages at your workspace again.
3. Select **Health**. The page reads the number from Meta and shows **Healthy**, **Attention** or **Blocked**, with any issues and a suggested fix for each.

## Send a first test message

1. From a different phone, send a WhatsApp message to the number you connected.
2. Open **Inbox**. The conversation appears in the list. Open it, type a reply and press Enter. You can reply freely for 24 hours after the customer's last message. After that only an approved template can be sent. See [Team inbox](help:team-inbox-overview).
3. To start a conversation yourself, you need an approved template. Create one under [Message templates](help:message-templates-overview), then send it with a [campaign](help:campaigns-create) to a contact that holds your own number.

## Plan and access

Seeing the page needs the right to view WhatsApp numbers. Connecting, changing the primary number, fixing inbound and removing each need their own right. Facebook sign-in only appears when your platform has finished the Meta app setup.

## If something looks wrong

- **The page says Embedded Signup is not configured.** Ask your platform administrator to finish the Meta app setup, or connect with a pasted token.
- **The token check finds problems.** Fix what it lists, such as a missing permission, and check again before connecting.
- **The number says Not on Cloud API.** Meta still has it on the retired On-Premises API. Register it on the Cloud API in WhatsApp Manager, then connect it again. Cards of numbers that are not coexistence numbers also have a **Register** button that registers the number on the Cloud API from here.
- **The number is already in another workspace.** A number can be connected to one workspace at a time.
- **Your test message does not appear in the Inbox.** Check the card for **Inbound not wired** and use **Fix inbound**, then send it again.
