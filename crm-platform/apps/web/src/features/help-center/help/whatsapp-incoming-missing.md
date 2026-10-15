---
id: whatsapp-incoming-missing
title: Incoming messages or delivery updates are missing
summary: Check that WhatsApp is delivering customer messages and delivery updates to your workspace, and repair the connection when it is not.
area: troubleshooting
order: 40
documents: [tile:whatsapp]
keywords:
  [
    incoming,
    inbound,
    webhook,
    callback url,
    verify token,
    fix inbound,
    subscribe,
    signature,
    meta app,
  ]
---

## What it is for

WhatsApp sends everything that happens on your number to one address on this platform: customers' messages, the ticks on your messages, template review results and changes in the number's quality. If that connection breaks, customers seem to go silent and your messages stay on **Sent**. This guide shows how to check it and put it right.

Each update is checked before it is accepted. The platform verifies the signature that Meta attaches, and an update without a valid signature is refused and never reaches your inbox. If Meta sends the same update twice, it is handled once.

## Check the connection

1. Open **Settings**, then **WhatsApp** under Channels. Each connected number shows one of three marks: **Inbound wired**, **Inbound not wired** or **Inbound: check**. The last one means it has not been checked yet.
2. Select **Health** on the number's card.
3. In the card **Inbound webhook (live)**, select **Check inbound webhook (live)**. The platform asks Meta where this number's messages go right now and shows one of four answers.

The four answers:

- Meta delivers this number's messages to this platform: the connection is fine. Send a message from another phone and check that it appears in the inbox.
- No app is subscribed to this WhatsApp account, so nothing is delivered here: use **Fix inbound**.
- Meta delivers this number's messages to a different address: use **Fix inbound** to point them back here.
- An app is subscribed and uses its default callback: if you connected through your own Meta app, set that app's callback as described below.

## Repair it

- **Fix inbound** is on the number's card and on the Health page. It subscribes the number to this platform again and checks it once more. It asks you to confirm.
- If **Inbound not wired** stays after **Fix inbound**, disconnect the number and connect it again. Disconnecting wipes the stored token, so have a fresh access token ready.
- The Health page also shows the **Stored token**: whether it is valid, when it expires and which WhatsApp permissions it holds. Use **Replace access token** if it is missing or no longer accepted.

### If you use your own Meta app

While inbound is not confirmed, the Health page shows **Using your own Meta app?** with a **Callback URL** and a **Verify token**. Paste both into your app's WhatsApp configuration in Meta, verify and save, and subscribe the app to the **messages** field. Then run **Check inbound webhook (live)** again.

## Plan and access

Opening the number's Health page needs the right to view WhatsApp numbers. **Fix inbound**, **Check inbound webhook (live)**, the callback URL and verify token, **Replace access token** and **Disconnect** need the right to manage WhatsApp numbers. Without it, ask a workspace admin. See [WhatsApp numbers](help:whatsapp-numbers-overview).

## If something looks wrong

- **A warning says neither the number nor the platform has an app secret.** The platform cannot prove that a signed update comes from Meta. Ask your platform administrator to add the app secret in the platform settings.
- **Meta cannot verify the callback.** The verify token must match exactly. Copy it again from the Health page, where it is shown while inbound is not confirmed.
- **Updates that arrived while the connection was broken are missing.** This build has no screen that lists or replays past updates. New ones arrive once the connection works, so ask the customer to write again if needed.
- **Connecting says the number is already connected to another workspace.** A number can be connected to one workspace at a time, so disconnect it in the other workspace first.

> Sending events from this platform to your own systems is not available yet. This guide is only about WhatsApp updates arriving here.
