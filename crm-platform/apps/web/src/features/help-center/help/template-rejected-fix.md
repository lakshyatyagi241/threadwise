---
id: template-rejected-fix
title: Fix a rejected template
summary: Find the reason Meta gave for refusing a template, fix it, submit it again, and see what Paused, Disabled and Missing on Meta mean.
area: campaigns
order: 50
documents: [nav:templates]
keywords: [rejected, meta review, resubmit, template status, paused, disabled, quality, refused]
---

## What it is for

Every template you submit is reviewed by Meta, and the answer is not always yes. This guide shows where to read the reason, how to fix the template and send it again, and what the other statuses mean. For the full screen, see [Message templates](help:message-templates-overview).

## Find out why it was refused

1. Open **Templates**. A refused template carries the status **Rejected**, and its card repeats Meta's reason in red under the name.
2. Select **View**. The banner **Rejected by Meta** shows the full reason. Below it, **Meta sync** lists the dates and the template ID, **Components** shows what was sent, and **Meta payload** shows exactly what we sent to Meta.
3. Select **Refresh status** to ask Meta for its latest answer. While a template is **In review**, the page checks by itself every 15 seconds, so you can leave it open.

> If the refusal came back the moment you pressed **Submit to Meta**, the form says "Saved, but Meta refused the template". The template is kept as a draft and your form is unchanged, so you can fix it right there.

## Fix it and submit again

1. On the template page, select **Edit**. A draft, an in-review or a rejected template can be edited. An approved one cannot, see [Change an approved template](help:template-change-approved).
2. Change what the reason points at, for example a variable with no sample value or text in the footer that should not be there.
3. Read **Pre-submit checks** on the right. Every error must be cleared before **Submit to Meta** turns on. Warnings are advice only. See [Template rules and pre-submit checks](help:template-rules-checks).
4. Select **Submit to Meta**. The status goes back to **In review** and the review starts over. **Save draft** keeps your changes without sending anything.

## What the other statuses mean

- **Draft.** Saved here, never sent to Meta.
- **In review.** Waiting for Meta.
- **Approved.** Ready to use in [Campaigns](help:campaigns-overview). A quality rating (High, Medium, Low or pending) appears next to it.
- **Paused.** Meta has paused the template, often because of its quality rating. It cannot be sent until the pause ends. The banner says until when, if Meta gave a date.
- **Disabled.** Meta has disabled it and it cannot be sent. Create a new template instead.
- **Missing on Meta.** Meta no longer lists the template. We keep our copy. Use **Sync from Meta** on the library to check again, or delete it.

## If something looks wrong

- **The reason mentions a token or a permission.** Your WhatsApp connection needs attention. Reconnect the number, then submit again.
- **Meta says the name already exists.** A template name can be used once per language on a number. Pick another name or language.
- **Nothing changes after Refresh status.** Meta has not decided yet. A background check also looks for stale statuses every ten minutes.
- **Edit is missing.** Only drafts, in-review and rejected templates can be edited, and you need the right to edit templates.
