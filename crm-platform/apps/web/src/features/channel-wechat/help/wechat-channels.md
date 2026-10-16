---
id: wechat-channels
title: WeChat
summary: Connect a WeChat Official Account, paste its address and Token into WeChat, answer followers from the inbox and mass-send messages.
area: settings
order: 100
documents: [tile:wechat]
keywords:
  [
    wechat,
    weixin,
    official account,
    appid,
    appsecret,
    token,
    encodingaeskey,
    webhook,
    followers,
    broadcast,
    mass send,
  ]
---

## What it is for

WeChat connects a WeChat Official Account to this workspace, so the messages followers send it appear in your team inbox and your team can answer them there. You can also mass-send a text message to your followers.

You need a certified WeChat Service Account. Subscription accounts and accounts that are not verified cannot use the messaging APIs.

## How to use it

1. In the WeChat Official Accounts Platform, open **Settings and development**, then **Basic configuration**. Copy the **AppID** and generate the **AppSecret**.
2. In the same place, under server configuration, choose a **Token** (any text you like) and a message mode. For safe mode, generate the **EncodingAESKey** too.
3. In this app open **Settings**, then **WeChat** under **Channels**, and select **Connect WeChat**.
4. Paste the AppID, the AppSecret and the Token. Add the EncodingAESKey if you use safe mode, pick the same **Message mode** as in WeChat, and select **Connect WeChat** again.
5. WeChat is asked for an access token with those credentials. If it refuses them, nothing is saved and the screen says why.
6. The screen now shows the **URL** and the **Token** for your channel. Back in WeChat, paste the URL as the server address and enter the same Token, then submit. WeChat checks the address and this app answers it. Then enable the server configuration in WeChat.
7. Add this server's public IP address to the IP allowlist in the WeChat console, or WeChat will refuse every call.
8. Follow your Official Account from the WeChat app and send it a message. It appears in the inbox.

> Save the channel here first, then submit in WeChat. WeChat checks the address the moment you submit, and it only passes once this app knows the Token.

## Options and settings

- **Message mode** must match the mode set in WeChat. **Compatible** is recommended, **Plaintext** sends nothing encrypted, and **Safe / Encrypted** encrypts every message and needs the EncodingAESKey (43 characters).
- **Show** reveals the Token of a channel, and **Copy** copies the URL or the Token.
- **Re-check** asks WeChat for a new access token with the saved credentials and tells you whether it answered.
- **Pause** keeps the channel but ignores the messages it receives and stops sending from it. **Enable** starts it again.
- **Remove** disconnects the channel after you confirm. Its broadcasts are removed too and its inbox conversations stay.
- Connecting the same AppID again updates the existing channel and keeps its URL, so the address you pasted into WeChat stays valid.

## Answering followers

A reply typed in the inbox goes out as a customer-service message from the account that carried the conversation. WeChat allows this for 48 hours after the follower's last message. After that WeChat only accepts a template message, so the reply box is switched off until the follower writes again.

Followers who message you, follow you or tap a custom menu item appear in the inbox with their WeChat nickname and photo when WeChat shares them. Leaving the account does not change the conversation.

## Broadcasts

1. Select **Broadcasts** on the WeChat screen, then **New broadcast**.
2. Give the broadcast a name and choose the channel.
3. Choose the **Audience**: **All followers**, **By tag** (enter the WeChat tag ID, a number), or **Pick from inbox** (tick at least two people who have already messaged the account).
4. Optionally pick a **Template** to fill the message, then write the message. It is plain text, up to 2000 characters.
5. Select **Create broadcast**. It is saved as a **Draft**.
6. Select **Send** on the broadcast list and confirm. The row shows **Sending**, then **Sent** or **Failed**. If it failed, the reason is shown and **Send** tries again.
7. Select the bin icon to delete a broadcast in any state.

WeChat sends the message to the whole audience in one call, so there is no progress bar. When people were picked from the inbox, a copy of the message is added to each of their conversations.

> WeChat allows a Service Account about 4 mass sends a month. This app does not count or block them: WeChat decides, and a refused send shows as Failed with WeChat's reason.

## Quiet hours

A WeChat broadcast is one mass send to followers that WeChat chooses, so it cannot be held person by person. If your workspace has quiet hours in the [Compliance center](help:compliance-center) and it is inside them on your workspace clock (the fallback time zone you chose there, else your workspace time zone), the broadcast stays **Sending** with a note that it is held until the hours end, and it is sent by itself then. Retry does not appear while it waits.

## Plan and access

WeChat needs the plan feature for extra channels. Seeing the channels, managing them, seeing broadcasts and creating or sending them are four separate permissions. Only people who can manage channels see a channel's Token.

## If something looks wrong

- **"WeChat rejected those credentials."** Check the AppID and AppSecret, and that the server's IP is in the WeChat IP allowlist.
- **WeChat says the address failed its check.** Make sure the channel is connected here first, the URL and Token are copied exactly, and the message mode matches. The address must be public HTTPS.
- **No messages arrive.** Check that the server configuration is enabled in WeChat and that the channel is not paused.
- **A channel shows an error under its name.** Use **Re-check**. If WeChat still refuses, reset the AppSecret in WeChat and connect again with the new one.
- **The reply box is switched off.** The follower has not written for 48 hours, and WeChat accepts only a template message after that. It opens again when they write.
- **"A WeChat OpenID broadcast needs at least 2 recipients."** Tick at least two people, or choose another audience.
