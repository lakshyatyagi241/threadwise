---
id: notification-preferences
title: Notification preferences
summary: Choose how each event reaches you (bell, pop-up, sound, browser notification) and turn browser notifications on for this device.
area: account
order: 25
documents: [nav:notification-prefs]
keywords: [notifications, preferences, bell, pop-up, toast, sound, push, browser notifications, mute, alerts, devices, broadcasts, team chat, reset, iphone, blocked]
---

## What it is for

Notification preferences are yours alone. They decide how each kind of event reaches you: a new chat, a message on a chat you own, a chat that is still waiting for a reply, a mention, a WhatsApp number that disconnects, a broadcast or campaign that finishes or fails, a message in Team chat, and the tasks, leads, forms and wallet alerts. Your colleagues keep their own choices. Open the page from **Account**, **Notifications**, or from **Notification settings** at the bottom of the bell panel.

## The switches

Every event has up to four switches:

- **Bell**: the event is added to the bell and counts in its number. Turn it off and the event never reaches your bell.
- **Pop-up**: while this tab is in front, a small pop-up appears with a link to open what happened. It needs the bell to be on.
- **Sound**: a short two-tone ping. It also needs the bell, and only some events can ping (new chats and messages, mentions and Team chat).
- **Push**: a notification from your browser, even when the CRM is closed. It also needs the bell. This column only appears when browser notifications are available on your CRM (see below). New chats, messages on your chats, chats still waiting for a reply, chats assigned to you, mentions, direct Team chat messages and tasks assigned to you start on; every other event starts off, and you can turn any of them on.

A dash in a column means that kind of event does not offer that switch.

## Chat still waiting for a reply

Under **Chats**, **Chat still waiting for a reply** tells you when a chat that nobody owns has had a customer message without an answer for a few minutes (5 by default; your administrator can change it). Everyone who is allowed to read and reply to the chat gets it, once: if the chat then stays unanswered it does not repeat, and it stops mattering as soon as someone is assigned, replies, opens the chat, mutes it or resolves it. If the customer writes again after someone answered and is left waiting again, you get a new one. It starts on for the bell, the pop-up and push, and off for sound. A browser notification for it shows the contact name and "Waiting for a reply", never the message.

## Change a switch

1. Find the event under its heading, for example **Chats** or **Broadcasts and campaigns**.
2. Select a switch. It changes straight away.
3. If saving fails, the switch goes back and a message at the top says so. Try again.

Under each event the page shows the default it follows, for example "Default: bell on, pop-up on, sound off, push off". A switch you have not touched follows that default, so if the default changes later you get the new behaviour. An event you changed is marked **Changed**.

## Go back to the defaults

Choose **Reset to default** on one event to make it follow the default again, or **Reset everything to default** at the top to do it for every event you changed. Both are saved immediately.

## When the workspace has an event off

If your workspace administrator turned an event off in **Workspace settings**, the row says **Turned off by your workspace** with the note "Your workspace has this off; your choice still applies to you." That is only the starting point: the bell shows off, but you can turn it on for yourself, and then the pop-up, sound and push switches work as usual. Choose **Reset to default** to follow the workspace again.

## Browser notifications

Above the table, the **Browser notifications** card sends an operating-system notification for the events you switched on in the **Push** column, on the devices where you allow it, even when the CRM tab is closed. It does not appear at all if your CRM has not been set up for it; ask your administrator.

Each notification shows who it is from and what kind of event it is, for example the contact name and "New message". It never shows the text of a message, because it can appear on a locked screen. Several messages from one chat replace each other instead of piling up, and selecting a notification opens that chat. You are not sent a browser notification while the CRM is open and in front of you: the bell and pop-ups cover that.

The card is in one of these states:

- **Off**: browser notifications are possible but not enabled on this device. Select **Enable on this device**; your browser asks for permission only then. If you decline, the card shows **Blocked**.
- **On for this device**: this browser is registered. Use **Send a test notification** to check that it works (it goes to all your devices, and you can send one every few seconds), or **Turn off on this device**.
- **Blocked**: you blocked notifications for this site in your browser. Only the browser can undo that: open the site settings (the icon next to the address), set **Notifications** to **Allow**, then come back to this page.
- **Not available**: this browser cannot show notifications while the CRM is closed. Use an up-to-date Chrome, Edge, Firefox or Safari on a secure (https) page.
- **iPhone and iPad**: Apple only delivers browser notifications to an app added to the Home Screen. Open the CRM in Safari, select **Share**, then **Add to Home Screen**, open it from the new icon and enable notifications from this page. It needs iOS or iPadOS 16.4 or later.

**Your devices** lists every browser where you turned notifications on, with when it was added and when it was last notified. Choose **Remove** to take a device off the list; it stops receiving notifications at once. You can have up to 10 devices; adding an eleventh removes the one used least recently. A device your browser has dropped is removed automatically.

## This browser

Under the events, **This browser** has the sound switch and the desktop alerts control. Those two are saved per browser, not per account, and are described in [Notifications and alerts](help:notifications-and-alerts). On a device where browser notifications are on, a background tab does not also show a desktop alert for the same event.

## If something looks wrong

- A switch will not move: it is grey because the bell for that event is off. Turn the bell on first.
- The page says it could not load your preferences: select **Try again**. Until it loads, alerts follow each event's default.
- A pop-up you turned off still appeared: reload the page so every tab picks up your latest choices.
- The test notification says it could not be reached: the push service of your browser did not answer. Try again in a moment. A device that is gone is removed from the list by itself.
- You expected a browser notification and got none: check that the card says **On for this device**, that **Push** is on for that event (and its bell), that you are not looking at the CRM in a tab at that moment, and that your system is not in a do-not-disturb mode.
