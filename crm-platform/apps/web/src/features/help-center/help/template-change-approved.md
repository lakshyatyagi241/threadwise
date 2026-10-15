---
id: template-change-approved
title: Change an approved template
summary: An approved template cannot be edited here. Create a new version, wait for approval, then move your sends over and retire the old one.
area: campaigns
order: 56
documents: [nav:templates]
keywords:
  [edit approved template, new version, change template, copy template, delete template, resubmit]
---

## What it is for

Once Meta approves a template, this build locks it: there is no **Edit** button on an approved template, and the server refuses the change too. To change the wording or the buttons you create a new template and send it for review. This guide shows a safe way to switch over without interrupting your sends.

## Make the change

1. Open **Templates** and select **View** on the approved template. Note its number, category, body, buttons and variable mapping, because you will rebuild them.
2. Go back to the library and select **New template**. Choose the same WhatsApp number and category, and enter the changed text.
3. Give it a new name. A name can only be used once for a given language on a number, so the old and the new template cannot share both. Adding a version to the end, such as `_v2`, keeps them easy to tell apart.
4. Check **Pre-submit checks**, then select **Submit to Meta**. See [Template rules and pre-submit checks](help:template-rules-checks).
5. Wait for the status to become **Approved**. The new template page checks for an answer every 15 seconds while it is **In review**.

## Move over to the new template

Switch each place that used the old template:

- **Campaigns.** Open the campaign and select **Edit**, then pick the new template. A campaign can be edited only while it is a draft, scheduled or paused.
- **Guided campaigns.** A launched campaign cannot change its template. Cancel a scheduled one and create it again with the new template. See [Create a campaign](help:campaigns-create).
- **Scheduled messages.** Cancel the schedule and create a new one with the new template. See [Scheduled messages](help:scheduled-messages-overview).

Then retire the old one:

1. Keep it until nothing needs it any more. It keeps working while it stays approved.
2. When you no longer need it, open it and select **Delete**. Deleting removes it here and on Meta.

## Limits to know

- You cannot delete a template while a broadcast that uses it is running or scheduled. The message says so. Wait for that broadcast to finish, or delete it if it is still scheduled, then delete the template.
- The delete check looks at broadcasts only. Check your campaigns and scheduled messages yourself before deleting.
- A draft, an in-review or a rejected template can still be edited in place. Submitting an edited in-review template starts its review again.

## If something looks wrong

- **Meta says the name already exists.** Choose a different name, or a different language, for the new template.
- **The new template was refused.** Read the reason on its page. See [Fix a rejected template](help:template-rejected-fix).
- **You cannot see New template or Delete.** Each needs its own right. Ask a workspace admin to change your role.
