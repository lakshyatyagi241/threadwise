---
id: import-contacts-csv
title: Import your contacts from a CSV file
summary: Prepare a CSV file, upload it from Contacts, check the preview, then import and review what was created, updated or rejected.
area: getting-started
order: 30
documents: [nav:contacts]
keywords: [import, csv, upload, bulk upload, contacts, spreadsheet, migrate, duplicates, groups, tags]
---

## What it is for

Use this to bring a list of people into your workspace in one go, for example from a spreadsheet or an export from another tool. Nothing is created until you confirm, and the preview tells you what would happen first. The Contacts screen itself is described in [Contacts](help:contacts-overview).

## Prepare the file

- Save the list as a **CSV** file with a header row, up to 20 MB and 200,000 rows.
- Every row needs a **phone number** and a **name**. Use a single name column, or first and last name columns.
- Write phone numbers with the country code and a plus sign, for example +919876543210. Without it, add a country code column, otherwise the number may be rejected.
- Optional columns are email, group, tags, language, title, address, memo, status and source. Column names such as name, phone, mobile, whatsapp, email, group and tags are recognised on their own. Put several groups or tags in one cell separated by commas.
- Not sure about the layout? The import window has **Download sample CSV**.

## Import the file

1. Open **Contacts** in the CRM area of the menu, or go to `/contacts`.
2. Open **More Actions** and select **Bulk upload**.
3. Choose your CSV file, or drop it on the window.
4. Read **What we found in your file**. It shows which column was matched to each field, and the counts: **Rows**, **New contacts**, **Existing, updated**, **Rejected**, **Repeated in file** and **Plan room left**. If a required field says **Pick a column**, choose the right column from its list.
5. Under **Apply to every imported contact**, optionally choose a **Status**, a **Source**, a **Group** and **Tags**. **Status** and **Source** are set on the new contacts the file creates. **Group** and **Tags** are added to new and existing contacts alike. Any groups and tags named in the file that do not exist yet are created.
6. Select **Import N contacts**. A small file finishes straight away. A file with more than 1,000 rows runs in the background: you can close the window and keep working, and the list refreshes when it is done.
7. Read the result: how many contacts were imported, how many existing contacts were updated and how many rows were skipped. Select **Download rejected rows** to get the rejected rows with the reason for each.

## Check the result

- On Contacts, use **Select Segment** and choose **Imported** to see only the contacts that came in through an import.
- A contact whose phone number already exists is updated, not duplicated: the name and any other column you filled in are written over, empty cells leave the old value alone, and the phone number, status and source are not changed. The same number twice in one file counts once and is shown as **Repeated in file**.
- Import cannot mark people as opted out of marketing. Open a contact and use its **Marketing opt-out** setting for those who should not receive broadcasts or campaigns.

## Plan and access

You need the permission to import contacts, or **Bulk upload** is hidden. Your plan can cap the number of contacts. When the cap is reached, further new contacts are skipped and the result says so. Rows for people who already exist are still updated.

## If something looks wrong

- **The file could not be read.** Check that it is a CSV with a header row and at least one contact.
- **A row was rejected for no name, no phone number or an invalid phone number.** Fix it in your spreadsheet. Download the rejected rows, correct them and import that file.
- **A required field is missing.** Pick the column for it in the preview. If the file has none, add the column to your file.
- **Fewer contacts than expected.** Check **Existing, updated** in the preview, and whether your plan limit was reached.
- **You imported the wrong file.** Use the **Imported** view on Contacts to find those contacts, then remove or tag them from **More Actions**.
