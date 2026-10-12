---
id: calling-overview
title: WhatsApp calling
summary: Turn WhatsApp calling on for a number, then place and answer calls from the inbox.
area: settings
order: 20
documents: [tile:calling]
keywords: [calls, voice, phone, call button, incoming call, record call, microphone, permission]
---

## What it is for

Calling lets your team place and answer WhatsApp voice calls from the browser. You switch it on per WhatsApp number in Settings, and from then on chats with that number show a green **Call** button in the [Team inbox](help:team-inbox-overview).

## How to use it

1. Open **Settings**, then **Calling** under Channels. Each of your WhatsApp numbers has a card with its connection status.
2. Select **Enable calling** on the number you want. WhatsApp is asked first, which can take a few seconds, and the card changes only after WhatsApp accepts. If it refuses, the full reason is shown on the card.
3. Open a chat on that number in the inbox and select **Call**. The button is hidden if the contact has no phone number.
4. If there is no confirmed calling permission for the contact, a window offers two choices. **Call anyway** works if they already tapped Allow in WhatsApp. **Ask permission** sends them a request and places no call, even if they already allow calls (then you just press Call). Try again after they answer.
5. While a call is live, a panel shows the call length with **Mute**, **End** and **Record**. An incoming call shows a popup with **Accept** and **Decline**.

## Options and settings

- **Turn off calling** removes the Call button from that number's chats.
- **Record** starts recording and cannot be stopped mid-call. The panel says the call is being recorded.
- If microphone access is blocked, the caller cannot hear you. Allow the microphone for this site and try again.

> Keep the call to the inbox screens. Leaving them hangs up a live call. Only one call can be active in a browser tab.

## Plan and access

The Calling tile needs the **WhatsApp calling** plan feature and the right to use calling. Without that right you cannot call at all. Turning calling on or off needs the calling management right. Without it you can see each number's state, but the buttons are hidden.

## If something looks wrong

- **The Call button is missing.** Check that calling is enabled for the number, that the contact has a phone number, and that you have the right to use calling.
- **Calling is refused for a number.** Calling works only on numbers connected through the WhatsApp Cloud API, and a number that is also used in the WhatsApp Business app cannot take calls. If the number is disconnected, reconnect it under Channels first.
- **No numbers are listed.** Connect a WhatsApp Cloud API number under Channels, then come back.
- **A call ended straight away.** The message tells you why, for example the customer declined, was busy or did not answer.
