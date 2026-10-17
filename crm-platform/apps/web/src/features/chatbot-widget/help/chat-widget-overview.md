---
id: chat-widget-overview
title: Chat widget
summary: Put a floating chat bubble on your website, answered by a smart agent, by WhatsApp or both. Visitor chats land in your team inbox.
area: settings
order: 30
documents: [tile:chat-widget]
gates:
  planFeature: chatbot_widgets
keywords:
  [web chat, website chat, live chat, widget, embed, snippet, bubble, launcher, whatsapp button]
---

## What it is for

A chat widget is a round bubble that floats on your website. Visitors open it to chat with a smart agent, to jump into WhatsApp, or to pick between the two. Conversations that need a person land in your [Team inbox](help:team-inbox-overview).

## How to use it

1. Open **Settings**, then **Chat widget** under Automation and AI, and select **New widget**.
2. **Setup.** Name the widget (visitors never see the name) and choose where the bubble floats. Pick a conversation engine: **Smart agent**, **WhatsApp deep-link** or **Smart + WhatsApp**. A smart agent needs a saved agent to link. A WhatsApp engine needs a full number with its country code, and you can add a pre-typed message.
3. **Look.** Set the launcher fill, the window header tint and ink, the window title and an optional launcher icon address.
4. **Voice.** Write the opening line, set the bubble colours and the window background, choose whether the chat pops open by itself a moment after the page loads, and choose which intake fields (display name, email, phone) visitors fill in before chatting.
5. **Launch.** Set the send button's label and colours, select **Launch widget**, then copy the snippet and paste it just before the closing `</body>` tag of each page that should show the bubble.

A live preview stays on the right while you build. **Save draft** saves without launching.

## Options and settings

- Choosing **WhatsApp deep-link** switches to a single page of five cards: button style, messenger image, welcome message, button position for desktop and mobile, and the WhatsApp number. **Save Changes** publishes it and shows the install code.
- Each row can open a preview, copy the snippet, edit, rotate the embed token, duplicate or delete. **Rotate** and **Delete** stop the old snippet at once; past conversations stay in the inbox.

## Plan and access

The screen needs the **Chatbot widgets** plan feature. Without it you see an upgrade sheet over the page and changes are refused. You need the right to view widgets to open it. Creating and duplicating, editing and rotating, and deleting each need their own right.

## If something looks wrong

- **You cannot move to the next step or save.** A message names the missing item, such as a name, a linked smart agent, a full WhatsApp number or a valid colour.
- **The bubble does not appear on your site.** Check that the snippet is on the page and is the current one. After a token rotation or a delete, the old snippet stops working.
- **The totals on the cards look out of date after you rotate or delete a widget.** Reload the page to refresh them.

## Get it as an app

The chat widget is also sold as an app in the **Marketplace**. A workspace whose plan already includes it keeps it as it is, with nothing to buy or install. A workspace without it can subscribe to the app and install it to switch it on. See [Marketplace](help:marketplace-overview).
