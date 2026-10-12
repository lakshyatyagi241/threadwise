---
id: email-mailboxes
title: Email mailboxes
summary: Connect Gmail, Microsoft 365 or IMAP mailboxes, shared or personal, check their health, and answer customer email in the team inbox.
area: settings
order: 70
documents: [nav:email, tile:email]
keywords: [email, gmail, google workspace, microsoft 365, outlook, imap, smtp, personal mailbox, email sharing, mailbox, shared inbox, support email, cc, bcc, reconnect, sync, attachments, signature, rich text, bounce]
---

## What it is for

Email mailboxes connects the addresses your customers write to, such as support@ or sales@: Gmail or Google Workspace, Microsoft 365 or Outlook, or any other provider through IMAP and SMTP. Customer emails arrive in the Team inbox, each email thread is one conversation, and your replies go out from the same address on the same thread. You can connect several mailboxes, and each one is its own inbox. A mailbox is either **Shared** (the company's, worked by the whole team) or **Personal** (one person's own, readable only by them).

## How to use it

1. Open **Settings**, then **Email** under **Integrations**.
2. Under **Add a mailbox**, choose how to connect. If personal mailboxes are on and you may connect one, first choose **Shared** or **Personal**.
   - **Connect Gmail** or **Connect Microsoft 365**: sign in with the account that owns the mailbox and allow reading and sending mail. Both are needed.
   - **Connect IMAP / SMTP**: pick your mail provider from the list, or fill in the incoming (IMAP) and outgoing (SMTP) server, port, security, user name and password. Select **Use the same user name and password for sending** when both servers share the login, then select **Verify and connect**. We log in to both servers first, and if one refuses the message says which. The password is stored encrypted and never shown again.
3. After the sign-in, you come back to the Email screen with a confirmation.
4. The mailbox shows on the Email screen. The last 7 days of mail are fetched into the inbox without notifying anyone, and new mail is checked every minute after that.
5. Open the mailbox in the inbox with **Open in inbox**, or pick it in the **Channel** filter of the inbox, where mailboxes are grouped under **Email**.
6. Select a conversation to read it. The subject is the conversation title, and each message shows its From, To, Cc and date. Attachments are listed under the message and download when selected.
7. Write your reply in the box. Select **Cc, Bcc and subject** to add copies or to change the subject, which is **Re:** and the original subject until you change it. Press Ctrl+Enter (Cmd+Enter on a Mac) to send; Enter starts a new line.
8. Format the text with the toolbar: bold, italic, underline, lists, a quote and links. **Switch to plain text** drops the formatting. Attach files with the paperclip, by dragging them onto the reply box or by pasting a picture. Each file uploads at once, and Send waits until they are done.
9. Under the box, pick the **Signature** that goes out. The default is added on its own, and you can switch to another one or choose **No signature**. A sent email shows its files, and one that bounced says **Not delivered to** the address with the reason.

> A reply on a resolved conversation is sent as usual, and a new customer email on a resolved thread reopens it.

## Options and settings

- **Display name** is the name replies go out under. Select **Edit** on the mailbox, type the name and select **Save**.
- Each mailbox card shows its provider, whether it is **Shared** or **Personal** (with the owner's name), **Live updates** when new mail arrives by push instead of waiting for the next check, and a **Signature** chip when the mailbox has a signature.
- **Send limit per hour** is how many emails the mailbox may send in an hour. Select **Edit**, type a whole number from 1 to 10000, or leave it empty for the platform default.
- **Sync now** fetches new mail straight away instead of waiting for the next check.
- **Reconnect** appears when a mailbox needs it. For Gmail and Microsoft 365, sign in with the same address (a different address is refused). For IMAP / SMTP, enter the password again.
- **Remove** stops reading and sending for that mailbox after you confirm. Its conversations stay in the inbox as read-only history, and connecting the same address again picks them up.
- The meter **x of N mailboxes** shows how many your plan allows. Personal mailboxes count too. At the limit, the connect buttons are switched off.
- **Email sharing** (administrators only) sets the policy for personal mailboxes: whether people may connect their own, whether only admins or also agents may, and whether admins may read other people's personal mailboxes. Select **Save** to apply it. Turning personal mailboxes off only hides the connect option; existing personal mailboxes stay private to their owners.
- Someone else's personal mailbox shows only as a summary (address, provider, owner and status), with no actions, unless the policy lets admins read personal mailboxes.
- Pictures from the internet inside an email are hidden. Select **Load images** under the message header to show them.
- Automatic replies, bounces and mailing-list mail are kept and marked **Automated**.
- **Signatures** (on the Email screen) are added at the end of replies. A mailbox can have a shared signature, and each agent can keep their own, which is used first. Write `{{name}}`, `{{title}}` and `{{phone}}` and they are filled in with the details of the person who sends. Agents change only their own signatures; changing a mailbox's shared signature needs the right to manage mailboxes.
- An email takes up to 10 files, each up to 10 MB and 20 MB together. A file that is too big, too many, or a type email cannot carry is refused with the reason. Files you attach but do not send expire after a day.
- Emails do not count against your message quota or wallet.

## Plan and access

You need the permission to view mailboxes to open the screen, and the manage permission to connect, rename, sync, reconnect or remove a shared one. Connecting and managing your own personal mailbox needs the personal mailbox permission and a policy that allows it, and the Email sharing panel needs the email settings permission. Replying in the inbox needs the usual reply permission. Email is an integration that comes with a plan or is subscribed to from the Marketplace. Without it the **Email** tile in Settings shows an upgrade mark and the screen asks you to upgrade. If the integration lapses, existing mail stays visible but sending and syncing stop.

## If something looks wrong

- **A connect button is switched off and says to ask your platform administrator.** Sign-in for that provider (Google or Microsoft) is not set up for the platform yet. The administrator adds the credentials in the operator console. IMAP / SMTP needs no platform setup.
- **The connect buttons are switched off and say you used all your mailboxes.** Remove a mailbox you no longer need, or ask an administrator to upgrade the plan.
- **The status is Needs reconnect.** The provider revoked or expired the access, or the mail server refused the saved password. Select **Reconnect** and sign in with the same address, or for IMAP / SMTP enter the password again.
- **IMAP / SMTP says the incoming or the outgoing server refused the login.** The message names which one. Check the user name and password; some providers need an app password. If it says the server cannot be reached, check the server name, port and security. The server certificate must be valid.
- **I cannot choose Personal.** An administrator has to turn personal mailboxes on in Email sharing, and your role needs the personal mailbox permission.
- **The status is Error.** The line below it shows the last problem. Select **Sync now**; if it keeps failing, reconnect the mailbox.
- **Mail is missing from the inbox.** Spam, trash and drafts are skipped, and so is mail you sent yourself from Gmail. Check that the status is Connected and that the last synced time moves.
- **A reply was refused.** The mail provider can refuse an address or a message that is too large. Fix the addresses in Cc and Bcc or shorten the text and send again.
- **You returned from the sign-in with a message and nothing was connected.** The message says why: cancelled, a missing permission, the plan limit, or a different account. Try again after fixing it.
- **A reply says the mailbox reached its hourly sending limit.** The message says when to try again. A manager can raise the limit on the mailbox card.
- **A sent email says Not delivered to an address.** A permanent refusal means the address is wrong or closed: correct it and send a new email. A temporary one, such as a full mailbox, may work if you send again later.
- **An attachment says upload failed.** Select **Retry**, or remove the file. Files over 10 MB, more than 10 files, or types email cannot carry (such as programs) are refused.
