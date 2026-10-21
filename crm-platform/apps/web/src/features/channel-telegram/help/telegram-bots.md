---
id: telegram-bots
title: Telegram bots
summary: Connect a Telegram bot with its BotFather token, check its webhook, pause it, add a payment token or disconnect it.
area: settings
order: 40
documents: [tile:telegram, nav:telegram]
keywords: [telegram, bot, botfather, token, webhook, payments, pause, disconnect, chat, broadcast]
---

## What it is for

Telegram bots connects a Telegram bot to this workspace, so the chats it receives appear in your team inbox and flows can answer them. Each bot is connected with the token BotFather gives you when you create it.

## How to use it

1. Open **Settings**, then **Telegram** under **Channels**.
2. In Telegram, open the verified **@BotFather** account, send `/newbot`, and follow the prompts. Copy the HTTP API token it gives you.
3. Back here, select **Connect Bot**, paste the token into **Bot token** and select **Connect Bot** again.
4. If Telegram accepts the webhook, the bot shows as live. If it does not, the bot is still saved and the screen says why. Use **Fix inbound** after you fix the cause.
5. To use Telegram payments in a flow, open a bot's **Payments** section, paste the payment provider token from BotFather and select **Save**.

> Keep the bot token private. If it is exposed, send `/revoke` to BotFather and connect the new token.

## Options and settings

- **Fix inbound** registers the webhook again. Use it after the tunnel or address changed.
- **Pause** stops a bot from sending and receiving. **Resume** starts it again.
- **Disconnect** removes the bot after you confirm. Its inbox conversations stay.
- **Remove token** clears a saved payment token.

## Quiet hours

If your workspace has quiet hours in the [Compliance center](help:compliance-center), a broadcast does not message someone while it is night for them. Their message waits, the rest of the list is sent, and the row shows how many are held and until when. The broadcast stays **Sending** while anyone waits and finishes by itself when the hours end, so you do not need to press anything. Consent is checked again at that moment, so a person who unsubscribed meanwhile is not messaged. The hours are read on the person's own clock: their contact's time zone, else the country of their number, else your fallback time zone. Pausing a broadcast also stops the held messages.

## Plan and access

You need the permission to view Telegram bots to see the screen, and the manage permission to connect, pause, fix, add a payment token or disconnect. The Telegram connection under a personal account is not available yet, so its card is greyed out. Telegram broadcasts need their own permission and are opened from the Telegram screen.

## If something looks wrong

- **"That does not look like a BotFather token."** Copy the whole token, including the number and the colon.
- **"The bot is saved, but Telegram did not accept the webhook."** Use **Fix inbound**. The reason appears under the bot.
- **The bot shows Needs attention.** Read the message under its name, fix it, then use **Fix inbound**.
- **"Could not connect the bot. Try again."** Check the token and your connection, then retry.
- **Payments stay off.** Save a payment provider token from BotFather's Payments menu.
