---
id: forms-submissions
title: Form submissions
summary: Read what visitors sent, see what became of each submission, retry the ones that need attention and export them.
area: campaigns
order: 18
documents: []
gates:
  planFeature: form_builder
keywords: [submissions, answers, spam, needs attention, retry, export csv, erase, consent, utm]
---

## What it is for

**Submissions** lists what visitors sent through one form and what became of it. Open it from a form's row menu or from the builder.

## How to use it

1. Choose a group: **All**, **Needs attention** or **Spam**. All leaves spam out.
2. Narrow the list with the search box (name, email or phone), the status and a date range. The view is kept in the address so a refresh keeps it.
3. Select a row to open its details: the answers, where the visitor came from (UTM values, referring page, page address), the consent they gave with the exact text they saw, and links to the contact and company the submission created or updated.
4. Use **Load more** at the bottom for older submissions.

## Statuses

- **Created** or **Updated**: the submission made or updated a contact.
- **Needs attention**: the answers are kept but the CRM could not be written, for example because no email or phone was given, the contacts limit of your plan was reached, or the monthly submission limit was reached. The reason is shown with what to do.
- **Failed**: an unexpected error. Retry it.
- **Spam**: held back by the spam checks. Nothing was written to the CRM. If it is genuine, retry it.

## Retry and erase

- **Retry** runs a submission that needs attention, failed, or was held as spam again under the form's current settings. It needs permission to update submissions.
- **Delete answers** erases the answers and what identifies the visitor. A row stays with its outcome and consent record, and the contact is never deleted. It needs permission to delete submissions.
- Opening a submission's answers is recorded in your audit log.

## Export

**Export CSV** downloads the submissions that match the current status and dates, newest first, up to 10,000 rows. It says when the file was cut. Cells that start with a formula character are prefixed so a spreadsheet does not run them. The search box is not applied to an export. Exporting needs its own permission.

## Plan and access

Reading submissions needs permission to view them. Your plan limits the submissions accepted each month; over the limit a submission is still saved and marked as needing attention, never dropped.

## If something looks wrong

- **Answers are gone.** The form's retention period passed or someone erased them. The row stays as a record.
- **Retry is not offered.** It appears only for submissions that need attention, failed, or are held as spam, and only while their answers are still stored.
