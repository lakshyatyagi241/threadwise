---
id: personal-whatsapp-import-history
title: Import your existing chats from a personal WhatsApp number
summary: Bring a personal number's recent chats and contacts into the shared inbox when you link it. Optional, quiet, and possible only at the first link.
area: inbox
order: 42
documents: [nav:devices]
features: [personal_history_full]
keywords:
  [
    import chats,
    history,
    existing chats,
    contacts,
    first link,
    personal number,
    unofficial,
    imported,
    read,
    media,
    cancel,
  ]
---

## What it is for

A newly linked personal number starts with an empty shared inbox: only messages that arrive from now on appear. If you want your team to see the conversations the number already had, you can ask WhatsApp for them while you link the number. This is optional and off by default. It works only for personal numbers connected as in [Connect a personal WhatsApp number](help:personal-whatsapp-connect).

> WhatsApp sends a number's chat history only once, right after the number is first linked. That is why the choice is on the screen **before** the QR code: it cannot be made afterwards. If you skipped it, link the number again and choose it then (this replaces the saved link).

## How to import

1. Start to connect a number, or select **Reconnect** or **Link again** on a number's page.
2. On the linking step, under **Bring in your existing chats?**, choose:
   - **No, start empty**: nothing is imported. This is the default.
   - **Yes, recent chats and contacts**: the recent chats WhatsApp sends when a number is first linked, with the people in them.
   - **Yes, as much as WhatsApp sends**: also WhatsApp's older history. It takes longer and uses more of your contact limit. This choice is part of some plans only: if yours does not include it, the option is greyed out with a link to the plans, and the recent chats stay available.
3. Read the list of what to expect, then show the QR code or get a pairing code and link the number as usual.
4. Open the number's page. The **Imported chats** card shows the state, the counts and the progress. You can leave the page: the import continues.

## What you get

- Private chats appear in the shared inbox as conversations, dated when the messages were really sent, and the order follows the last real message. Each imported conversation and message carries a small **Imported** tag, so your team can tell them from live chats. When the import ends the inbox refreshes by itself.
- Imported conversations are marked as read. Nothing is announced: no alerts, no notifications, no automations, flows or keyword replies, and no automatic answers.
- Nothing is sent to anyone.
- Each person you chatted with becomes a contact, named from your phone's saved name when WhatsApp gives one. They count towards your plan's contact limit. Imported contacts have no marketing consent recorded: you still need consent to send them marketing messages.
- Group chats are saved as group conversations. They never create contacts.
- Photos, videos, voice messages and files are **not** imported. You see a placeholder such as **[Photo]** and any caption.
- Only recent messages are kept: the card shows how many days. There are also limits on the number of chats and messages per chat and per number, set by your platform operator. If a limit is reached, the card says so, and what was imported stays.
- Your own status updates, newsletters, broadcast lists and the number's chat with itself are skipped.

## States of the card

- **Waiting for WhatsApp**: you chose to import and the number is being linked, or WhatsApp has not started to send yet. After about 30 minutes without history the import ends with a message that WhatsApp sent none.
- **Importing**: chats are arriving. It can take a few minutes.
- **Finished**: done. When WhatsApp stops sending for a few minutes the import also finishes by itself, and the card says that WhatsApp stopped sending history.
- **Stopped at your contact limit**: your plan's limit on contacts was reached. What was imported stays. Free some contacts or upgrade, then link the number again and import.
- **Did not finish**: something went wrong, and the card says what. What was imported stays.
- **Cancelled**: you stopped it.

## Stop an import

Select **Stop the import** on the card and confirm. No more chats are taken. What was already imported stays in the inbox and is not removed. Disconnecting the number also ends a waiting import.

## Cloud API numbers

The chat history that WhatsApp Business app numbers push after connecting (the Cloud API "coexistence" setup) is imported the same quiet way, and its customers also become contacts, without consent recorded and within your contact limit. See [Connect WhatsApp Business](help:whatsapp-numbers-overview).

## Linking again later

A second link imports only if you choose it again before you scan. The same chats are never imported twice: messages WhatsApp sends again are recognised and skipped.

## Who can do what

You need permission to see the numbers (**wa.devices.read**) to see the card, and the permission to link numbers (**wa.devices.pair**) to choose the import and to stop it. By default only workspace admins have them.

## If something looks wrong

- **The card says WhatsApp sent no history.** WhatsApp sends history only at a first link and only if the phone allows it. Link the number again and choose to import.
- **Some chats are missing.** Chats older than the window, empty chats, status updates and chats over a limit are skipped.
- **Photos show as placeholders.** Media is not imported by design.
