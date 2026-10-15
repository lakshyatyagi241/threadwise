---
id: message-templates-overview
title: Message templates
summary: Write WhatsApp message templates, submit them to Meta for review, and track their status before you use them in broadcasts and campaigns.
area: campaigns
order: 30
documents: [nav:templates]
keywords: [whatsapp template, meta approval, review, buttons, variables, sync, quality]
---

## What it is for

WhatsApp only lets a business start a conversation with an approved template. The Templates screen is your library: write templates, send them to Meta for review, and follow each status. Approved templates can then be used in [Campaigns](help:campaigns-overview).

## How to use it

1. Open **Templates**. The left rail lists **All**, **Approved**, **In review** and **Rejected** with counts. Use the category tabs, the number picker (when you have several numbers), **Sort** and **Search** above the cards; your filters stay in the address. **Load more** shows the next eight.
2. Select **New Template Message**. Under **Identity**, name the template using only a to z, 0 to 9 and underscores, pick the category (Marketing, Utility or Authentication), a name using only a to z, 0 to 9 and underscores, and the language.
3. Add an optional text **Header**, then write the **Body**. Use the formatting buttons for bold, italic, strikethrough and code, and **Variable** to insert a placeholder. An **Attachment** (image, video, document or a location pin) replaces the header text.
4. Under **Variable mapping**, name the contact attribute that fills each variable when you send, and give a sample value for Meta's review.
5. Optionally add a **Footer** and up to three **Buttons** (call to action, quick reply, or a mix). Meta limits each kind, and quick replies must sit together.
6. Watch the preview and **Pre-submit checks** on the right. Fix every error, then select **Save draft** to keep working later or **Submit for review** to send it to Meta.

## Options and settings

- **Sync from Meta** (top right) fetches the templates already on your WhatsApp Business account.
- **Saved templates and Template gallery.** The two tabs above the library keep your own templates apart from the platform's default ones. **Saved templates** (the one that opens first) is your library: the templates you created or synced, with All, Marketing, Utility and Authentication. **Template gallery** shows the platform's default templates in a column for each use (ecommerce, food delivery, festival season, education, travel, others), the columns side by side in one row that you scroll sideways; narrow them with the category buttons or the search box. Hover one and select **Use this template** (on a small screen the button sits under it) to open the new-template form filled in from it: name, category, header, body with sample values, footer and buttons. Change what you need, choose the WhatsApp number, add a header picture if it has one, and save or submit as usual; it becomes one of your saved templates only then. Gallery templates are never counted or listed in your library.
- **Copy cURL** (the `</>` button on a card) opens the request that sends that template through the [customer API](help:rest-api-keys): `POST /api/v1/templates/{id}/send` with your key, the customer's number and one value for each `{{1}}`, `{{2}}` body variable. Select **Copy**, replace `YOUR_API_KEY` with a key from Developers that has the `templates:write` permission (a key is shown only once, when you create it), replace the number, and run it in a terminal. The API sends approved templates that are not paused or rated red and whose variables are all in the body; the button is greyed out for the others (authentication templates, a media header, a variable in the header or in a link button, named variables).
- An **Authentication** template is a one-time passcode: Meta writes the message and the Copy code button, and you can set how long the code stays valid.
- Each template shows a status: Draft, In review, Approved, Rejected, Paused, Disabled or Missing on Meta. Approved templates also show a quality rating.
- Open a template to see its Meta details. While it is in review the page checks every 30 seconds, and **Refresh** asks Meta now. A draft, in-review, rejected, approved or paused template can be edited; **Save changes** on a live template sends the edit to Meta and it goes back into review, and its name and language cannot change. A template you have not submitted shows **Submit to Meta** on its page.

## Plan and access

You need the right to view templates to open the screen. Creating and editing, deleting and syncing each need their own right, and the matching buttons are hidden without it. You also need a connected WhatsApp number to submit through.

## If something looks wrong

- **Submit for review is greyed out.** A line beside the buttons says why, such as no number chosen, no name, or errors in the checks.
- **Meta refused the template.** It is kept with Meta's reason on its page. Select **Edit & resubmit**, fix it and submit again.
- **Carousel, catalog, AI drafting and other channels.** These Reference template formats are not available yet.
- **Delete is refused.** A running or scheduled broadcast still uses the template. Cancel that broadcast or pick another template first.
- **A save says someone changed the template.** Reload it and apply your change again.
