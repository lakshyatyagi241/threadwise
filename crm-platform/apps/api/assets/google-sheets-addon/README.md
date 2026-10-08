# CRM add-on for Google Sheets

Six files make one Google Apps Script project. You copy them into a spreadsheet of your own; nothing here runs on a server of ours.
The `Code.gs` you downloaded from the CRM already points at your CRM's address (the `CRM_BASE` line near the top).

## Files

| File              | What it is                                                                 |
| ----------------- | -------------------------------------------------------------------------- |
| `Code.gs`         | The menu, the key storage, and every call to the CRM                       |
| `Dialog.html`     | The window for pulling contacts, pushing contacts and syncing products     |
| `Settings.html`   | Where you paste, check or remove your key                                  |
| `Help.html`       | The help window                                                            |
| `appsscript.json` | The project manifest: runtime and the three permissions it asks Google for |
| `README.md`       | This page (it is not part of the Apps Script project)                      |

## Put it in a spreadsheet

1. Open the spreadsheet, then **Extensions > Apps Script**.
2. In the editor open **Project Settings** (the gear) and tick **Show "appsscript.json" manifest file in editor**.
3. Replace the contents of `appsscript.json` with the file you downloaded.
4. Replace the contents of `Code.gs` with the downloaded `Code.gs`.
5. Add three HTML files (the plus next to Files, then HTML) named exactly `Dialog`, `Settings` and `Help` (the editor adds `.html`), and paste each downloaded file into its twin.
6. Save, reload the spreadsheet and wait a moment. A **CRM** menu appears. The first time you use it Google asks you to allow the three permissions below.
7. Choose **CRM > Settings**, paste your key and select **Save and check**.

## The key

Create your key in the CRM under Settings, Google Sheets add-on. It is shown once; copy it then. Pasting it here stores it in your own
Google account only (Apps Script user properties): not in the sheet, not in the document, not in any log. Creating a new key stops
the old one. An admin must have installed the add-on in the CRM Marketplace, and your role needs its permission.

## What the menu does

- **Check connection**: shows who you are, your workspace and what your role can do. Menu items your role cannot use are hidden.
- **Pull contacts into a sheet**: writes your contacts into a sheet named `CRM contacts`, replacing what it held.
- **Push contacts from this sheet**: reads the active sheet and creates or updates contacts. Up to 500 rows go in each call. Each row's result goes to a `CRM status` column.
- **Sync products to a shop**: reads the active sheet and creates or updates the products of a storefront shop. The shop is remembered in this spreadsheet.

### Columns

Row 1 holds the column names; case, spaces and underscores do not matter.

- Contacts: `email` or `phone` (one is required), `name`, `first name`, `last name`, `country code`, `source`, `unsubscribed`. A column called `attr:city` fills the custom contact property `city`. A blank cell never clears a stored value.
- Products: `name` and `price` (required), `category`, `description`, `image url`, `sku`, `stock` (blank means unlimited), `active` (yes or no).

## Permissions the add-on asks Google for

| Scope                      | Why                                               |
| -------------------------- | ------------------------------------------------- |
| `spreadsheets.currentonly` | Read and write the spreadsheet it is installed in |
| `script.container.ui`      | Show its menu and windows                         |
| `script.external_request`  | Call your CRM                                     |

## When something fails

Every answer from the CRM is read as JSON, and the message is shown as it is. The usual ones: key missing or no longer valid (create a new one),
add-on not installed (ask an admin), too many requests (wait the time shown), request too large (send fewer rows). A row that fails is marked in the
`CRM status` column and does not stop the others.
