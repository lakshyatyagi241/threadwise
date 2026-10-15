---
id: saved-replies
title: Saved replies
summary: Write the answers your team gives again and again, then insert them into a reply by typing / in the message box.
area: settings
order: 55
documents: [tile:saved-replies, nav:inbox-saved-replies]
keywords:
  [
    saved replies,
    canned responses,
    quick replies,
    shortcuts,
    snippets,
    templates,
    slash,
    variables,
    inbox,
  ]
---

## What it is for

A saved reply is a ready-made answer with a short name, called a shortcut. Instead of typing the same greeting or the same refund policy again, an agent types `/` in the message box, picks the reply and edits it if needed. The text goes into the box. Nothing is sent until the agent presses **Send**.

Replies are either **Shared**, so every agent sees them, or **Mine**, so only you see them.

## How to write one

1. Open **Settings**, go to **Data and customization** and select **Saved replies**.
2. Select **New saved reply**.
3. Type the **Shortcut**. Capital letters and spaces are tidied for you: `Thank You` is saved as `thank_you`, and agents type `/thank_you`. Two replies of the same owner cannot share a shortcut, but a personal reply may reuse the shortcut of a shared one and then comes first in the list.
4. Add a **Title** and the **Text**. The text is plain text. Use `*bold*` and `_italic_` as in WhatsApp.
5. Choose who can use it: **Everyone in the workspace** or **Only me**. This cannot change after you save.
6. Select **Save**.

## Variables

Select a variable chip to add it where your cursor is, for example `{{first_name}}`. When an agent inserts the reply, the variables are filled in from the open conversation: the contact's name, email and phone, the agent's own name, the workspace name, today's date, and the name and number of the channel the conversation is on. Your own contact attributes work too, for example `{{city}}`.

A variable that cannot be filled in, because the contact has no value or the name does not exist, is left exactly as written and the box warns the agent, so the text is never sent with a gap nobody noticed. The preview in the form uses sample customer data.

## Restrict a reply to some channels

Under **Only on these channels**, tick the channels where the reply makes sense, for example email only. Leave them all unticked to offer it everywhere. The picker leaves out replies that are not meant for the open conversation's channel.

## Using a reply in the inbox

- Type `/` at the start of the box, or after a space. Keep typing to narrow the list by shortcut, title or text.
- Use the arrow keys to move, **Enter** or **Tab** to insert, **Esc** to close. You can also use the **Saved replies** button next to the attach button.
- The reply replaces what you typed after the `/` and the caret lands after it. If it would make the message longer than the channel allows, it is not inserted and you are told.
- On WhatsApp, the 24 hour rule is unchanged: a reply is free-form text, so after the window closes you send a template instead.

## Who can do what

- Everyone who can reply in the inbox can see the shared replies and their own, and insert them.
- Creating a reply, shared or personal, needs the permission to manage saved replies. Changing or deleting a shared reply needs it too; a personal reply is always its owner's.
- The most used replies come first.

## Plan limit

Your plan may cap how many saved replies the workspace holds. Shared and personal replies both count. The meter at the top shows how many you use; at the limit you delete one or upgrade before adding another.

## If something looks wrong

- **The shortcut is taken**: another reply of the same owner already uses it. Pick a different one.
- **Someone else changed this reply first**: close the window and open the reply again.
- **Nothing appears when you type `/`**: the `/` must start the box or follow a space or a new line, and you need the right to reply in that conversation.

## Import and export

On the Saved replies screen, **Export CSV** downloads the shared replies as a file with the columns title, shortcut, body, category, language and channel (channel kinds separated by `|`; empty means every channel). Personal replies stay with their owners and are not exported.

**Import CSV** adds or updates shared replies from a file with the same columns (title, shortcut and body are required; up to 1,000 rows and 1 MB):

1. Choose the file and what happens when a shared reply already uses a shortcut: **Keep the existing reply** (the row is skipped) or **Replace its text** (title, text, category, language and channels change; the use count stays).
2. Press **Check the file**. Nothing is saved yet: you see how many replies would be created, replaced, skipped or have a problem, with the line and the reason for each problem (a missing title, a shortcut repeated in the file, an unknown channel, a reply over your plan's limit).
3. Press **Import**. Rows with a problem are left out; the others are saved. If you change the file or the choice, check again.

A spreadsheet never runs a cell as a formula: a text that starts with `=`, `+`, `-` or `@` is saved with a leading apostrophe in the export and read back correctly when imported.

## AI agents and the email editor

An AI agent with **Use saved replies** switched on is shown your team's most used shared replies (never personal ones, at most 15) as examples of tone. Replies with variables such as the customer's name are left out, because the agent has no customer to fill them for.

In an email reply, the **Saved replies** button inserts the text where your cursor is. The `/` shortcut works in the plain message box only.
