---
id: email-mailboxes
title: Email mailboxes
summary: Connect Gmail or Google Workspace mailboxes, see their health, reconnect or remove one, and read and answer customer email in the team inbox.
area: settings
order: 70
documents: [tile:email]
keywords: [email, gmail, google workspace, mailbox, shared inbox, support email, cc, bcc, reconnect, sync, attachments]
---

## What it is for

Email mailboxes connects the Gmail or Google Workspace addresses your customers write to, such as support@ or sales@. Customer emails arrive in the Team inbox, each email thread is one conversation, and your replies go out from the same address on the same thread. You can connect several mailboxes, and each one is its own inbox.

## How to use it

1. Open **Settings**, then **Email** under **Channels**.
2. Under **Add a mailbox**, select **Connect Gmail** and sign in with the Google account that owns the mailbox.
3. On the Google screen, allow reading and sending mail. Both are needed.
4. You come back to the Email screen with a confirmation. The last 7 days of mail are fetched into the inbox without notifying anyone, and new mail is checked every minute after that.
5. Open the mailbox in the inbox with **Open in inbox**, or pick it in the **Channel** filter of the inbox, where mailboxes are grouped under **Email**.
6. Select a conversation to read it. The subject is the conversation title, and each message shows its From, To, Cc and date. Attachments are listed under the message and download when selected.
7. Write your reply in the box. Select **Cc, Bcc and subject** to add copies or to change the subject, which is **Re:** and the original subject until you change it. Press Enter to send.

> A reply on a resolved conversation is sent as usual, and a new customer email on a resolved thread reopens it.

## Options and settings

- **Display name** is the name replies go out under. Select **Edit** on the mailbox, type the name and select **Save**.
- **Sync now** fetches new mail straight away instead of waiting for the next check.
- **Reconnect** appears when a mailbox needs it. Sign in with the same address. Signing in with a different address is refused.
- **Remove** stops reading and sending for that mailbox after you confirm. Its conversations stay in the inbox as read-only history, and connecting the same address again picks them up.
- The meter **x of N mailboxes** shows how many your plan allows. At the limit, **Connect Gmail** is switched off.
- Pictures from the internet inside an email are hidden. Select **Load images** under the message header to show them.
- Automatic replies, bounces and mailing-list mail are kept and marked **Automated**.
- Email does not offer emoji, templates or file attachments in the reply box. Emails do not count against your message quota or wallet.

## Plan and access

You need the permission to view mailboxes to open the screen, and the manage permission to connect, rename, sync, reconnect or remove one. Replying in the inbox needs the usual reply permission. Email is an add-on: without it the entry in Settings is hidden and the screen is closed. If the add-on lapses, existing mail stays visible but sending and syncing stop.

## If something looks wrong

- **Connect Gmail is switched off and says to ask your platform administrator.** Google sign-in is not set up for the platform yet. The administrator adds the Google credentials in the operator console.
- **Connect Gmail is switched off and says you used all your mailboxes.** Remove a mailbox you no longer need, or ask an administrator to upgrade the plan.
- **The status is Needs reconnect.** Google revoked or expired the access. Select **Reconnect** and sign in with the same address.
- **The status is Error.** The line below it shows the last problem. Select **Sync now**; if it keeps failing, reconnect the mailbox.
- **Mail is missing from the inbox.** Spam, trash and drafts are skipped, and so is mail you sent yourself from Gmail. Check that the status is Connected and that the last synced time moves.
- **A reply was refused.** Google can refuse an address or a message that is too large. Fix the addresses in Cc and Bcc or shorten the text and send again.
- **You returned from Google with a message and nothing was connected.** The message says why: cancelled, a missing permission, the plan limit, or a different account. Try again after fixing it.
