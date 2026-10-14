---
id: google-sheets-addon
title: Google Sheets add-on
summary: Create your key and Webhook URL, add the add-on to a spreadsheet and send new and changed rows to your workspace as contacts, or pull contacts and sync products.
area: settings
order: 110
documents: [tile:google-sheets-addon]
keywords:
  [
    google sheets,
    spreadsheet,
    add-on,
    apps script,
    key,
    webhook,
    webhook url,
    trigger column,
    initial setup,
    import contacts,
    export contacts,
    sync products,
    shop,
  ]
---

## What it is for

The Google Sheets add-on connects a spreadsheet to your workspace. New or changed rows are sent to the CRM as contacts, either the moment you edit a row or in an hourly sweep. The add-on's menu also lets you pull your contacts into a sheet, push a whole sheet as contacts, and sync a product list to one of your storefront shops. It acts as you, so it only sees and changes what your role allows.

## How to use it

1. Open **Marketplace**, stay on the **Integrations** tab and open **Google Sheets add-on**. If the page says the add-on is not installed, an administrator must install it from the Marketplace first.
2. Select **Generate key**. Copy the **Webhook URL** (and the key) straight away: they are shown once and cannot be shown again. The URL ends with your key.
3. In a spreadsheet choose **Extensions**, **Add-ons**, **Get add-ons** and install the add-on from the Google Workspace Marketplace. Until it is listed there, download the six files and paste them into **Extensions**, **Apps Script** as the page describes.
4. Reload the spreadsheet, choose **Extensions**, the add-on, then **Initial Setup**, and paste the Webhook URL.
5. Pick the sheet and the **trigger column**: a column letter such as F, or its heading in row 1. A row is sent when that cell is filled or changed. Leave it empty to send on any change.
6. Select **Send Test**. Nothing is saved in the CRM; the add-on and this page show the columns the CRM received. Then select **Submit**.
7. Tick **Send on event** to send a row as soon as you edit it, and/or **Send on schedule** to send, every hour, the rows that were added or changed from somewhere else such as a form, an import or another app.

## Options and settings

- **Last data received** on the page shows the columns and first row of the most recent test or send, kept for a day, so you can check what the sheet sends.
- **Rows sent by the trigger** become contacts, with the same rules as **Push contacts**. Row 1 holds the column names; products are not sent by the trigger, use **Sync products to a shop** for those.
- **Contacts** need an **email** or a **phone** column. Add a column named **attr:city** to fill a custom property called city. A blank cell never clears a stored value. The result of each row is written to a **CRM status** column.
- **Products** need **name** and **price** columns. They are matched by SKU, then by name. A blank **stock** means unlimited. The shop is remembered in the spreadsheet, so later syncs update the same shop.
- **Generate a new key** replaces your key and your Webhook URL. The old ones stop working at once; paste the new URL in Initial Setup.
- **Revoke key** switches the key off. The add-on stops working until you create and paste a new one.

## Plan and access

You need the Google Sheets add-on permission on your role, and the Marketplace must be included in your plan. Each action also needs the matching permission: pulling and pushing contacts follow your contact permissions, and syncing products needs access to shops and products. Actions your role cannot do are hidden in the sheet's menu.

## If something looks wrong

- **The page says the add-on is not installed.** Ask an administrator to install it from the Marketplace.
- **The sheet says the key is not valid.** It was replaced or revoked. Generate a new key and paste the new Webhook URL in Initial Setup.
- **Nothing is sent when I edit.** Check that **Send on event** is ticked, that you edited the sheet and the trigger column chosen in Initial Setup, and that the trigger cell is filled.
- **Too many requests.** Wait the number of seconds shown and try again.
- **Some rows failed.** Open the **CRM status** column to see the reason for each row. The other rows were still saved.
- **A file shows as not available.** The add-on source is not on this server yet. Ask your administrator.
