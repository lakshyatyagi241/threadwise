---
id: calling-overview
title: WhatsApp calling
summary: Check that a number is ready for calls, turn calling on, then place and answer calls from the inbox.
area: settings
order: 20
documents: [tile:calling]
keywords:
  [
    calls,
    voice,
    phone,
    call button,
    incoming call,
    record call,
    microphone,
    permission,
    readiness,
    checklist,
    test call,
    turn,
    messaging limit,
    webhook,
  ]
---

## What it is for

Calling lets your team place and answer WhatsApp voice calls from the browser. You switch it on per WhatsApp number in Settings, and from then on chats with that number show a green **Call** button in the [Team inbox](help:team-inbox-overview).

## How to use it

1. Open **Settings**, then **Calling** under Channels. Each of your WhatsApp numbers has a card with its connection status and a **Ready for calls?** checklist (see below).
2. Fix anything marked **Fix this**, then select **Enable calling** on the number you want. WhatsApp is asked first, which can take a few seconds, and the card changes only after WhatsApp accepts. If it refuses, the reason is shown on the card in plain words.
3. Open a chat on that number in the inbox and select **Call**. The button is hidden if the contact has no phone number.
4. If there is no confirmed calling permission for the contact, a window offers two choices. **Call anyway** works if they already tapped Allow in WhatsApp. **Ask permission** sends them a request and places no call, even if they already allow calls (then you just press Call). Try again after they answer.
5. While a call is live, a panel shows the call length with **Mute**, **End** and **Record**. An incoming call shows a popup with **Accept** and **Decline**.
6. To record a call, first turn recording on (see [Recording calls](help:call-recording)). Then select **Record**, read the notice shown in the panel to the person and press the button that matches their answer. Nothing is recorded until they agree.

## Is this number ready for calls?

Under each number, **Ready for calls?** lists what WhatsApp and this workspace need before a call can work. Each row says what was found and, when it is not fine, what to do. The badge sums it up: **Not ready** (something marked Fix this), **Ready to turn on**, **Works, needs a look** (calling is on but a row is a warning) or **Ready**.

- **Plan includes WhatsApp calling** and **Number connected**: the plan feature is on and the number has its token and phone number id.
- **Number is on the Cloud API only**: a number that is also used in the WhatsApp Business app (coexistence) cannot take calls.
- **Number registered with WhatsApp** and **Messaging limit and quality**: WhatsApp must report the number as live and verified, with a daily messaging limit of at least 2,000 customers (a test number is exempt).
- **Access token permissions**: the stored token needs both whatsapp_business_management and whatsapp_business_messaging, and should not be about to expire.
- **App subscribed to this account** and **Calls webhook delivered**: WhatsApp must send this number's events, including calls, to the platform. If the calls field is missing from the platform's Meta app, the platform's background check adds it (when the app already has a callback), a few minutes after a number is connected or on its next round; **Check again** only reads it.
- **Calling switched on at WhatsApp**: WhatsApp's own setting for the number. A check also makes this workspace's switch follow it, so the Call button never shows on a number WhatsApp will refuse.
- **Call relay (TURN) configured**: without a TURN relay, people behind strict firewalls may connect and hear nothing. Your platform operator sets it.
- **Teammates allowed to call** and **Recording and consent rules**: somebody must hold the right to use calling, and recording needs its notice if it is on.

The card shows the last result at once. Select **Check again** to look now (needs the calling management right); it also looks again by itself when the result is more than a quarter of an hour old, when you open it, and in the background every few hours for numbers that have calling on.

## Turn calling on automatically

**Turn calling on automatically after a number is connected** (above the numbers) is off until someone with the calling management right turns it on. When it is on, a number that is connected or reconnected and meets every requirement gets calling switched on without anyone pressing a button, and the change is written to the audit log. A number that does not meet a requirement is left off and the card says why. Nothing is ever switched on while the plan lacks WhatsApp calling.

## Place a test call

When calling is on and the number is not blocked, **Place a test call** appears on its card. Type your own WhatsApp number with the country code and select **Call me**. It uses the same path as the inbox Call button, so WhatsApp's permission rule applies: if you have not allowed calls from this number, a permission request is sent to your phone and no call is placed. Tap Allow in WhatsApp, then select **Call me** again.

## Options and settings

- **Turn off calling** removes the Call button from that number's chats.
- **Record** asks the person for their agreement first. Once they agree, recording starts and cannot be stopped mid-call. The panel says the call is being recorded. If they decline, the call goes on without a recording. Recording is off for every workspace until an owner or admin turns it on.
- If microphone access is blocked, the caller cannot hear you. Allow the microphone for this site and try again.

> Keep the call to the inbox screens. Leaving them hangs up a live call. Only one call can be active in a browser tab.

## Plan and access

The Calling tile needs the **WhatsApp calling** plan feature and the right to use calling. Without that right you cannot call at all. Turning calling on or off needs the calling management right. Without it you can see each number's state, but the buttons are hidden.

## If something looks wrong

- **The Call button is missing.** Check that calling is enabled for the number, that the contact has a phone number, and that you have the right to use calling.
- **Calling is refused for a number.** The card says why in plain words, for example a messaging limit under 2,000, a token without the right permissions, or a number that is also used in the WhatsApp Business app. Fix what it names, select **Check again**, then try again. If the number is disconnected, reconnect it under Channels first.
- **The checklist says "WhatsApp did not answer this check".** WhatsApp could not be reached or refused to answer. Select **Check again** in a moment; if it keeps happening, reconnect the number.
- **Calls ring but nobody hears anything.** The Call relay (TURN) row is probably a warning. Ask your platform operator to set up a TURN server.
- **No numbers are listed.** Connect a WhatsApp Cloud API number under Channels, then come back.
- **A call ended straight away.** The message tells you why, for example the customer declined, was busy or did not answer.
