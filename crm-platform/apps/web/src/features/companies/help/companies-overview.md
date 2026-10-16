---
id: companies-overview
title: Companies
summary: Group contacts and deals under an organization: search and filter companies, create them, and see their contacts, open deals and won revenue.
area: audience
order: 60
documents: [nav:companies]
keywords: [organizations, accounts, businesses, industry, owner, revenue, b2b, columns, filter, export, import, csv, brief]
---

## What it is for

**Companies** lets you group contacts and deals under an organization, so you can see every contact, open deal and amount of won revenue for a customer in one place. The list has three tiles: **Companies**, **With open deals** and **Won revenue**. The tiles follow the filters you set.

## How to use it

1. Open **Companies** in the CRM area of the menu, or go to `/companies`.
2. Find a company with the search box, **Industry**, **Owner** (including **No owner**) and **With open deals**. Use **Order** to sort by newest or by name from A to Z, and **Clear** to remove the filters.
3. Select **New company**. A company name is required. You can also add industry, website, email, phone and notes. Under **More details** you can set size (for example 1-10), owner and address. After you create it, the company page opens.
4. Select a company's name, or anywhere on its row, to open its page.
5. The list loads in pages. Select **Load more** to see further companies.

## Columns, property filters and order

- **Columns** chooses what the table shows: the company's website, email, phone, size, owner and created date, and every one of your [company properties](help:company-properties). The company column is always there. The choice is remembered in this browser, and **Back to the usual columns** restores the table you started with.
- **Properties** filters by your company properties. Add a condition, pick a property, an operator that fits its type (for a number: is, between, greater than; for a date: in the last days, before, after; for a dropdown: is one of; for a checkbox: is ticked) and a value. All the conditions you add must hold. The tiles follow them, and so does the address of the page, so you can share a filtered list.
- **Order** can also sort by a property of text, dropdown, number, date or checkbox type, and **Direction** reverses it. Companies without a value come first when ascending. A multi-select property cannot sort the list.
- A property marked as masked is never offered as a column, a filter or an order.

## Export and import

- **Export** (needs permission to export companies) downloads a CSV of the list as it is filtered and ordered, with the columns you chose and your company properties. It holds at most 5,000 companies, so narrow the list with a filter first if it says there are too many. You only get companies inside your record scope, and each export is recorded in the audit log.
- **Import** (needs permission to import and to create companies) reads a CSV file of up to 1,000 companies. The first line names the columns: **name** (or **website**), **email**, **phone**, **industry**, **size**, **address**, **notes**, **owner** (a member's email or full name) and any company property by its name. Tick **Fill in companies that already exist** to match a company by website, or by name when there is no website, and fill only its empty fields without changing anything it already has; leave it unticked to always create new companies. After the import you see how many were created, filled in and unchanged, and each row that was not imported with its line number and why. Columns it did not recognise are listed and skipped.

## On a company page

- **Edit** and **Delete** are at the top. Deleting a company keeps its contacts and deals and only unlinks them.
- **Contacts** lists the people in the company. **Add contacts** lets you search by name, email or number and tick several. A contact can belong to one company, so adding a contact that is in another company moves it here. The remove button on a row takes a contact out of the company.
- **Deals** lists the company's deals, open ones first, each with its stage and value. Select one to open it.
- **Tasks** lists the company's open tasks. Type a title and select **Add** to start a new task already linked to the company, tick the circle to complete one, use **Show completed** to see the finished ones, and **View all** to open the Tasks screen filtered to this company. This card needs permission to read tasks.
- **Properties** shows the values of your own company properties (see [Company properties](help:company-properties)), under their sections. It only appears when the company holds a value for one.
- You also see the notes, the details (owner, size, address, who created it, when it was created and last changed) and an **Activity** history. Changes to properties are listed by name, never by value.
- **Generate brief** at the top writes an AI summary of the company. See [Account brief](help:company-brief).

## Linking a company from a contact or a deal

- **Contacts.** The contact form has a **Company** field. Type to search the companies you can see, pick one, or select the cross to remove it. If the name you typed has no match and you may create companies, **Create "name"** makes the company on the spot and picks it.
- **Deals.** The same **Company** field is on **New deal** and in a deal's panel. Left empty on a new deal, the deal takes its contact's company.
- You can only pick companies you may read, within your record scope. If the form says you cannot use a company, pick another one or clear the field.

## Options and settings

- To delete several companies at once, tick their rows and select **Delete** in the bar that appears. Contacts and deals are kept.
- A count or amount for contacts or deals that you may not read shows as a dash and never as zero.

## Plan and access

Opening the screen needs permission to read companies and the sales pipeline feature on your plan. Creating, editing, deleting, exporting and importing need their own permissions. The contacts list on a company page needs permission to read contacts, and adding contacts needs permission to update companies and contacts. The deals list needs permission to read deals.

## If something looks wrong

- **No companies match.** Select **Clear filters**.
- **One of the property conditions cannot be used.** The property may have been deleted or deactivated since you set the filter. Remove that condition.
- **That is too many companies for one file.** Narrow the list with a filter and export again.
- **That file cannot be imported.** It needs a first line naming the columns, including a name or website column, and at most 1,000 companies.
- **Someone else changed this company.** Their changes are loaded and your edits are kept. Review them and save again.
- **The owner must be an active member of this workspace.** Choose someone else.
- **Your plan does not include companies.** Upgrade your plan to unlock them.
- **Companies are not available.** The list could not be found on this server; reload the page. A connection problem or a server error says so in its own words and offers **Try again**. "That company no longer exists" appears only on a company's own page and its cards.
