---
id: line-channels
title: LINE channels and broadcasts
summary: Connect a LINE Official Account, check its webhook, pause it or turn on token rotation, and send broadcasts to the people who chat with it.
area: settings
order: 80
documents: [tile:line]
keywords:
  [
    line,
    official account,
    messaging api,
    channel access token,
    channel secret,
    webhook,
    token rotation,
    assertion key,
    pause,
    remove,
    friend,
    broadcast,
    push message,
    recipients,
    template,
    quick reply,
    retry,
  ]
---

## What it is for

LINE connects a LINE Official Account to this workspace, so the people who add it as a friend and write to it appear in your team inbox. Each account is connected with two values from the LINE Developers Console: its **Channel access token** and its **Channel secret**. The same screen leads to LINE broadcasts, which send one message to many of those people.

## How to use it

1. Open **Settings**, then **LINE** under **Channels**.
2. In the LINE Developers Console, open your Messaging API channel. On **Basic settings**, copy the **Channel secret**. On **Messaging API**, issue and copy a long-lived **Channel access token**.
3. Back here, paste both into **Connect a channel** and select **Connect LINE**.
4. If LINE accepts the webhook, the channel shows as **Active**. If it does not, the channel is still saved and the screen says why. Use **Re-hook** after you fix the cause.
5. In the console, allow webhooks and turn off LINE's own auto-reply, so customers get one answer.

> Keep both values private. If either is exposed, reissue it in the console and connect again. Pasting the same account again updates its row and keeps its webhook address.

## Options and settings

- **Re-hook** registers the webhook again. Use it after the public address changed.
- **Pause** stops the channel from receiving and from starting broadcasts. **Enable** starts it again.
- **Token rotation (v2.1)** is optional. Paste the Assertion Signing Key and its key ID from the console, plus the numeric Channel ID the first time. A new short-lived token is issued at once and renewed on its own. Leave the fields blank and select the button to go back to the pasted token.
- **Remove** deletes the channel after you confirm. Its inbox conversations stay, its broadcasts are deleted.

## Broadcasts

LINE cannot message anyone who has not added your account as a friend, so a broadcast goes to the people who already have a conversation with the channel. Each person gets their own push message, sent by a background job, so you can close the page.

1. On this screen select **Broadcasts**. You can also pick LINE when you start a new broadcast from Campaigns.
2. Select **New broadcast**, give it a name and choose the **Channel**. The recipient list shows the people that channel has talked with.
3. Write the **Message**, or pick a LINE **Template**. Use `{name}` to put the person's LINE name in the text. A template's link and phone buttons become a buttons card and its reply buttons become quick replies.
4. Optionally add an **Attachment**: a public address, or upload an image, video or audio file. It goes first as its own bubble.
5. Tick the recipients, or select **Select all**, then select **Create broadcast**, and in the list select **Start**.
6. **Pause** stops after the current batch and **Start** sends only the people not yet sent. **Retry** puts the failed people back; people who blocked your account stay blocked. **Delete** removes the broadcast whatever its status.

Each message sent is also added to that person's conversation in the inbox. Every send is a push message and counts against your LINE monthly allowance. A person who withdrew their consent is skipped and counted as blocked.

## Quiet hours

If your workspace has quiet hours in the [Compliance center](help:compliance-center), a broadcast does not message someone while it is night for them. Their message waits, the rest of the list is sent, and the row shows how many are held and until when. The broadcast stays **Sending** while anyone waits and finishes by itself when the hours end, so you do not need to press anything. Consent is checked again at that moment, so a person who unsubscribed meanwhile is not messaged. The hours are read on the person's own clock: their contact's time zone, else the country of their number, else your fallback time zone. Pausing a broadcast also stops the held messages.

## Plan and access

You need the permission to view LINE channels to see the screen, and the manage permission to connect, re-hook, pause, set up rotation or remove a channel. LINE needs a plan that includes extra channels. Broadcasts have their own permissions: one to view the list and one to create, start, pause, retry or delete.

## If something looks wrong

- **"LINE rejected that channel access token."** Copy the whole token again from the Messaging API tab.
- **The channel shows Needs attention.** Read the message under its name, fix it, then use **Re-hook**.
- **Nothing arrives.** Check that **Use webhook** is on in the console and that the channel secret here matches. A message that fails its signature check is refused.
- **"Could not mint a v2.1 token."** Check the key, its key ID and the numeric Channel ID. The pasted token keeps working meanwhile.
- **A person never appears.** They must add your account as a friend and write first. Followers who never write have no conversation yet.
- **"Connect a LINE channel first."** on the broadcast list: connect one on this screen.
- **"No reachable users yet."** in the recipient list: nobody has added and written to that channel yet.
- **Many broadcast messages failed with a quota message.** Your monthly push allowance is used up. Wait for the reset or upgrade your LINE plan, then use **Retry**.
