---
id: contacts-ask-in-english
title: Search contacts in plain English
summary: Describe the contacts you want in your own words, such as VIP contacts from India not active in 30 days, and the list filters itself.
area: audience
order: 11
documents: [nav:contacts]
keywords: [pql, ask, ai search, natural language, plain english, filter, conditions]
---

## What it is for

**Filter with AI** is the first choice in the **Filter** menu on **Contacts**. Instead of building a filter by hand, you describe the contacts you want and the list narrows to match. It fills in the same conditions you can set yourself, so you can check and change the result.

## How to use it

1. Open **Contacts** and select **Filter**.
2. Choose **Filter with AI**.
3. Type what you are looking for, for example `VIP contacts from India not active in 30 days`, or pick one of the examples under the box (they use your own tags and stages).
4. Select **Ask** or press Enter.
5. The list updates. A chip under the toolbar says what the search was turned into; select **×** on it to remove the filter.
6. To adjust the result, open **Filter** and choose **Add advanced filter**. To keep it, select **Save as segment**.

## What it understands

- Tags, groups, owners, lifecycle stages and statuses by the names your workspace uses.
- Your own custom properties.
- Dates, such as created in the last 7 days or no activity for 30 days.
- Countries, matched on the start of the phone number (for example +91 for India).
- Names, emails and phone numbers as plain words.

## Limits

- A search can be up to 500 characters.
- Each person can run 30 searches a minute.
- It only filters the list. It never changes, deletes or sends anything.

> Only your search words and the names of your tags, groups, owners, stages and custom properties are sent to the AI service. Contact details are not.

## If something looks wrong

- **Not understood: ...** appears under the box (the rest of your search is still applied). Part of the search named something your workspace does not have, such as a tag that does not exist. That part was left out. Check the spelling or use **Add advanced filter**.
- **Nothing in that search could be turned into a filter.** Reword it with a tag, a date or a stage.
- **English search is unavailable right now.** The AI service could not be reached or has no key set up. Try again, or use the other choices in **Filter** meanwhile.
- **The list is empty.** The conditions may match nobody. Open **Filter** then **Add advanced filter** to see them, or select **Reset filters**.
