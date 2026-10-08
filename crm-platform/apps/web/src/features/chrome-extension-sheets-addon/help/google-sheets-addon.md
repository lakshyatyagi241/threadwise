---
id: google-sheets-addon
title: Google Sheets add-on
summary: Create your personal key, add the add-on to a spreadsheet and sync contacts and products between the sheet and your workspace.
area: settings
order: 110
documents: [tile:google-sheets-addon]
keywords: [google sheets, spreadsheet, add-on, apps script, key, import contacts, export contacts, sync products, shop]
---

## What it is for

The Google Sheets add-on adds a **CRM** menu to a spreadsheet. From it you can pull your contacts into a sheet, push the rows of a sheet back as contacts, and sync a product list to one of your storefront shops. It acts as you, so it only sees and changes what your role allows.

## How to use it

1. Open **Settings**, then **Integrations**, and select **Google Sheets add-on**. If the page says the add-on is not installed, an administrator must install it from the Marketplace first.
2. Select **Generate key**. Copy the key straight away: it is shown once and cannot be shown again.
3. Download the six files. In a spreadsheet open **Extensions**, then **Apps Script**, and paste the files in as the page describes. **Code.gs** already points at this workspace.
4. Reload the spreadsheet. In the **CRM** menu choose **Settings**, paste your key and select **Save and check**. The check shows who you are, your workspace and what your role can do.
5. Put the column names in row 1 of a sheet and use **Pull contacts**, **Push contacts** or **Sync products to a shop** from the menu.

## Options and settings

- **Contacts** need an **email** or a **phone** column. Add a column named **attr:city** to fill a custom property called city. A blank cell never clears a stored value. The result of each row is written to a **CRM status** column.
- **Products** need **name** and **price** columns. They are matched by SKU, then by name. A blank **stock** means unlimited. The shop is remembered in the spreadsheet, so later syncs update the same shop.
- **Generate a new key** replaces your key. The old key stops working at once.
- **Revoke key** switches the key off. The add-on stops working until you create and paste a new one.

## Plan and access

You need the Google Sheets add-on permission on your role, and the Marketplace must be included in your plan. Each action also needs the matching permission: pulling and pushing contacts follow your contact permissions, and syncing products needs access to shops and products. Actions your role cannot do are hidden in the sheet's menu.

## If something looks wrong

- **The page says the add-on is not installed.** Ask an administrator to install it from the Marketplace.
- **The sheet says the key is not valid.** It was replaced or revoked. Generate a new key and paste it again.
- **Too many requests.** Wait the number of seconds shown and try again.
- **Some rows failed.** Open the **CRM status** column to see the reason for each row. The other rows were still saved.
- **A file shows as not available.** The add-on source is not on this server yet. Ask your administrator.
