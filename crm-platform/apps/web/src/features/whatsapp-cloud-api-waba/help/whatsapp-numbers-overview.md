---
id: whatsapp-numbers-overview
title: WhatsApp numbers
summary: Connect your WhatsApp Business numbers, choose the primary one, and check each number's health, quality and inbound messages.
area: settings
order: 10
documents: [tile:whatsapp]
keywords:
  [
    whatsapp,
    cloud api,
    waba,
    number,
    connect,
    facebook,
    token,
    primary,
    health,
    quality,
    inbound,
    register,
    verify,
    code,
    disconnect,
  ]
---

## What it is for

This is where your WhatsApp Business numbers are connected to the workspace. Once a number is connected, you can chat with customers from the [Team inbox](help:team-inbox-overview) and send templates, broadcasts and campaigns from it.

## How to use it

1. Open **Settings**, then **WhatsApp** under Channels. Each connected number is shown as a card with its status, quality and tier.
2. To add a number, select **Add WABA account**. Choose **Continue with Facebook** to sign in with Meta and pick the number, or switch to manual mode and paste the Phone Number ID, WABA ID and a permanent access token.
3. Pick the number that should be used by default and select **Set primary**. Messages without a chosen sender go out from the primary number.
4. Select **Health** on a card to see the number's checks: phone details, access and permissions, delivery and the business account. Issues are listed with a suggested fix.
5. Use the card actions when needed: **Fix inbound** re-subscribes the number so incoming messages reach this workspace, **Verify number** (shown while Meta reports the number as not verified) has Meta send a 6-digit code by SMS or call and confirms the number when you enter it, **Register** puts the number on the Cloud API, **Meta** opens it in Meta, **Disconnect** stops sending and receiving, and **Remove** deletes it from the workspace.

## Options and settings

- The health page can replace or renew the access token (checked with Meta before saving), edit the **Business profile**, and create **Message QR codes**.

> **Disconnect** wipes the stored token at once. The number stays listed until you remove it.

## Plan and access

You need the right to view WhatsApp numbers to open this page. Connecting, changing the primary number, fixing inbound, verifying, registering, disconnecting and removing each need their own right. Embedded sign-up is only offered when your platform has finished the Meta app setup. Otherwise you can still connect with a pasted token.

## If something looks wrong

- **Connect says Embedded Signup is not configured.** Ask your platform administrator to finish the Meta app setup, or use manual mode.
- **A number is not on the Cloud API.** Meta still reports it on the retired On-Premises API. Register it on the Cloud API in WhatsApp Manager, then connect again.
- **Incoming messages do not arrive.** The card shows **Inbound not wired**. Select **Fix inbound**.
- **The token is missing a permission.** Create a new System User token with the WhatsApp business management and messaging permissions.
- **The number is already in another workspace.** A number can be connected to one workspace at a time.
