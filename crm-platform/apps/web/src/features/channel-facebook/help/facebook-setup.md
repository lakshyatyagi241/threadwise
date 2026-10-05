---
id: facebook-setup
title: Messenger setup
summary: Set the Get Started button, greeting, persistent menu and ice-breaker questions that your Facebook Page's Messenger chat shows.
area: automation
order: 45
documents: [nav:facebook-setup]
keywords: [messenger, get started, greeting, persistent menu, ice breakers, FAQ, welcome, profile, facebook page]
---

## What it is for

Messenger setup controls how a new conversation on your Facebook Page starts. You can set the **Get Started** button, a welcome **Greeting**, an always-on **Persistent menu** and tappable **Ice breakers**. Changes save straight to Facebook and apply to new conversations.

## How to use it

1. Open **Messenger setup** in the menu. If you have several Pages, choose one with **Page**.
2. Pick a tab: **Get Started button**, **Greeting**, **Persistent menu** or **Ice breakers**. A green dot means that piece is set up.
3. Read the explainer at the top of the tab: what it is, how customers use it and how to set it up.
4. Fill in the fields, then select **Save**. The preview on the right shows how it looks in Messenger.
5. To remove a piece, select its remove link and confirm.

> Each tap sends a payload to your inbox. Match that payload in a flow trigger if you want an automatic answer.

## Options and settings

- **Get Started** takes one payload word. It is sent to you when a customer taps the button.
- **Greeting** is one line, up to 160 characters, shown before anyone types.
- **Persistent menu** holds up to three items. Each item either sends a payload or opens a web address. You can hide the text box so people use only the menu.
- **Ice breakers** hold up to four questions. Each one sends its payload when tapped.

## Plan and access

Only people with the Messenger setup permission see the editing tabs. Others see the page without access. Changes apply to the Page you pick. The screen needs a connected Facebook Page; connect one in [Facebook Pages](help:facebook-pages).

## If something looks wrong

- **"The Messenger profile could not be loaded."** Reload the page. If it keeps happening, reconnect the Page.
- **"No Facebook Page connected yet."** Connect a Page first.
- **A change does not show in Messenger yet.** Meta can take a moment to apply changes to new conversations.
- **"That did not work."** Check the field lengths and try again. A long payload or title is refused by Facebook.
