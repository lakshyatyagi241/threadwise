---
id: viber-channel
title: Viber
summary: Connect a Viber Public Account with its auth token, manage it, message your subscribers in broadcasts and read its insights.
area: settings
order: 90
documents: [tile:viber, nav:viber]
keywords:
  [
    viber,
    public account,
    bot,
    auth token,
    webhook,
    re-hook,
    pause,
    disconnect,
    insights,
    subscribe,
    broadcast,
    bulk message,
    recipients,
    picture,
    video,
    retry,
    delivered,
    seen,
  ]
---

## What it is for

The Viber channel connects a Viber Public Account (a bot) to this workspace. Chats that people start with the account appear in your team inbox, and the replies you type there go out through the account. You connect it by pasting the authentication token Viber gives the account.

## How to use it

1. Open **Settings**, then **Viber** under **Channels**.
2. In Viber, open your Public Account's admin panel, then your bot, then **Edit info**. Copy the authentication token.
3. Back here, paste it into **Auth token** and select **Connect Viber**.
4. If Viber accepts the webhook, the channel shows as **Active**. If it does not, the channel is still saved and the reason appears under its name. Fix the cause, then select **Re-hook**.
5. Select **Insights** to see seven days of message volume, active users and delivery rates, and **Broadcasts** to message your subscribers.

> Keep the token private. It is stored encrypted and is never shown again. If it is exposed, create a new one in the Viber admin panel and connect the account again with it.

## Options and settings

- **Re-hook** registers the webhook with Viber again. Use it after the address of this workspace changed.
- **Pause** stops the channel receiving and sending and blocks its broadcasts. **Enable** starts it again.
- **Remove** disconnects the account after you confirm. Viber stops sending to us, and the conversations stay in your inbox.
- The same account pasted again updates its existing entry and keeps its webhook address.

## Good to know about the channel

- Viber needs a public HTTPS address with a valid certificate. A local or IP-only address is refused.
- You can only message a person after they open a chat with your account. Until then Viber refuses the send.
- There is no 24 or 48 hour window: once someone has subscribed you can reply at any time.

## Broadcasts

Viber broadcasts send one message to many people who have already opened a chat with your account. Viber only lets an account message people who subscribed, so the audience is the conversations the account already has in your inbox.

### Create and send one

1. Open **Viber**, then **Broadcasts**, then **New broadcast**.
2. Give the broadcast a **Broadcast name** and pick the **Channel** to send from.
3. Optionally pick a **Template**. It fills an empty message and brings its buttons. A message you typed is never overwritten.
4. Write the **Message**, up to 7,000 characters. You can add an **Attachment**: a jpg, png, gif or mp4 file up to 26 MB. Upload one (up to 20 MB) or paste its public address.
5. Tick the **Recipients**, or **Select all**, then select **Create broadcast**. The list of recipients is fixed at that moment.
6. On the broadcasts list, select **Start**. A background worker sends it, so you can close the page. Select **Pause** to stop and **Start** to continue with the people not yet sent.

### What the list shows

- The tiles add up everything you have sent: **Sent**, **Audience**, **Failed** and **Sending**.
- Each row shows a progress bar and how many were sent and failed. Once Viber reports delivery, the row also shows how many were **delivered** and **seen**.
- A broadcast that finished or failed with failed people has **Retry**. It puts them back in line, and you then select **Start**.
- **Delete** removes a broadcast and its recipient list in any status.

### Good to know

- Each call to Viber carries up to 300 people. Viber names the people it refused, and they are marked failed with its reason. If Viber rejects a whole call, that batch and the broadcast fail.
- A picture or video is sent without buttons. Text with a template's buttons shows them as a keyboard under the message.
- Each sent message also appears in that person's conversation in the inbox.

## Quiet hours

If your workspace has quiet hours in the [Compliance center](help:compliance-center), a broadcast does not message someone while it is night for them. Their message waits, the rest of the list is sent, and the row shows how many are held and until when. The broadcast stays **Sending** while anyone waits and finishes by itself when the hours end, so you do not need to press anything. Consent is checked again at that moment, so a person who unsubscribed meanwhile is not messaged. The hours are read on the person's own clock: their contact's time zone, else the country of their number, else your fallback time zone. Pausing a broadcast also stops the held messages.

## Insights

**Insights** shows, for one channel, seven days of messages received and sent, how many people were active, and how many sent messages were delivered, seen or failed. Pick the channel at the top when you have more than one. It reads from your own inbox, because Viber offers no analytics.

## Plan and access

You need the permission to view Viber channels to see the screen, and the manage permission to connect, re-hook, pause or remove an account. The channel is part of the plan feature for extra channels. Broadcasts need their own permission to view them and another to create, start, pause, retry or delete one.

## If something looks wrong

- **"That does not look like a Viber auth token."** Copy the whole token, with its dashes.
- **"A broadcast needs a message, a file, or both."** Add text or an attachment.
- **"None of those users belong to this channel."** Pick recipients from the list.
- **"Viber rejected that auth token."** The token is wrong or was reset. Copy it again from the admin panel.
- **An error shows under the channel's name.** Read the message, fix it, then select **Re-hook**.
- **Messages do not arrive.** Check that the channel is **Active**, then select **Re-hook**.
- **"The Viber user must open a chat with you."** The person has not subscribed yet, so Viber refuses the message.
