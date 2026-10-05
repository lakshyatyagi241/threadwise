# Interakt "Create New Template" builder: live-walk inventory

Source: walked live in the project owner's logged-in Interakt account (WhatsApp channel), 2026-10-04, through Claude in Chrome.
Read-only: no template was submitted, no payment config saved, no AI prompt sent, nothing created or deleted.
Everything below was observed on screen. Items that need a Submit, an AI call or a credit spend are listed in section 9 as
**NOT VERIFIED**. Interakt is the visual and behavioural reference for our template builder (owner's instruction, 2026-10-04); this
deliberately departs from the Reference template screens and must be recorded as `intended` in `parity/message-templates.md`.

## 1. Where it lives

| Screen | Interakt route | Notes |
| --- | --- | --- |
| Library / Active / Deleted | `/templates/list?channel_type=whatsapp&segment=library\|active\|deleted` | Sidebar: Market -> Templates ("Messages for campaigns & chat start") |
| New template (entry modal) | modal over the list | see 2 |
| Builder | `/template/create` | two-step accordion |
| Edit | `/template/<name>/edit` | see 7 |

## 2. Entry modal ("+ New Template")

"Create Template Image & Content": textarea ("eg: Launching my organic soap line next week with 20% off for early customers"),
quick chips (Exclusive Offer, Feedback Request, Event Reminder, Loyalty Program Invite, Trendsetter Alert, Thank You Note), button
"Generate Template with AI", then "OR", then card "Build a Template from Scratch / Build manually, full control" -> builder.
The AI path was not run (NOT VERIFIED).

## 3. Builder shell

- Top bar: back arrow, "Create New Template", divider, WhatsApp icon + "WhatsApp" (channel), **Submit** (top right).
  Submit is disabled until step 1 has been saved once; enabled afterwards.
- Left: accordion of two numbered steps, each with a chevron. **Save** button inside step 1 only. After Save, step 1 collapses to one
  line `CATEGORY | Type title` with a green check, and step 2 opens. Clicking step 1's header re-opens it and collapses step 2.
  Changing the type and saving again **keeps** everything already typed (name, languages, header, body) and does not warn.
- Right: sticky phone preview. Label **Sample Preview** while step 1 is open (shows a canned example for the highlighted type,
  with the caption "Use this preview to identify the template type that best fits your use case."); label **Actual Preview** in
  step 2 (live from the form). Android / iOS toggle (Android default; the choice persists across steps). iOS shows an iPhone
  frame with notch, 9:41 clock, back chevron, video and call icons.
- Leaving the builder with unsaved edits triggers the browser's "Leave site?" dialog.

## 4. Step 1: Choose Template Category & Type

Category pills (icons): Marketing, Utility, Authentication. Type list is a scrollable box of radio cards (icon, title, description).

| Category | Type card | Description |
| --- | --- | --- |
| Marketing | Template with Buttons (Quick Reply, URL, Copy Code etc) | Send a message with customised buttons to engage customers |
| Marketing | Simple template (No buttons / Carousels) | Send a message only having a header / body / footer |
| Marketing | Template with WhatsApp Pay Checkout | Send messages through which customers can pay you |
| Marketing | Carousel | Send a carousel of images / videos showcasing your products |
| Marketing | Catalog | Send messages that drive sales by connecting your product catalog |
| Utility | Template with Buttons (Quick Reply, URL, Copy Code etc) | (same text) |
| Utility | Simple template (No buttons / Carousels) | (same text) |
| Authentication | One-Time Passcode | Send OTPs to verify a transaction or login |

Each card's canned preview: Buttons (marketing) "Upskill Faster This Year..." with Explore Courses / Get Fee Details / Copy offer code;
Buttons (utility) "Order Dispatched..." with Track Order / Download Invoice / Need Help; Simple "New Season. New You..." with footer
"Limited stocks available"; Pay Checkout "Secure your spot for our upcoming webinar..." with image and a "Review and Pay" button;
Carousel "Discover everyday styles..." with one image card (See More / Buy Now); Catalog "Our Best Picks for You..." with footer
"Tap a product to view details & pricing" and a "View items" button; OTP "Verification Code ... Your one-time passcode is {{1}}...".

Choosing **WhatsApp Pay Checkout** and pressing Save opens a modal (section 6.3) before step 2. Closing the modal reverts the
selection to the previously saved type.

## 5. Step 2 pieces shared by every type except Authentication

**Template Name** (placeholder "Enter template name....") takes free text as typed (spaces, capitals, hyphens accepted on screen).
The list later shows a friendly name plus a generated unique name with a copy icon (for example `order_shipped_9q`, `launch_alert`),
so the Meta name is derived and made unique after submit (derivation NOT VERIFIED).

**Select Language**: searchable multi-select with checkboxes (Afrikaans, Albanian, Arabic, Azerbaijani, Bengali, ...), English preselected,
removable chips. Every selected language gets its own tab with a full independent set of header, body, footer and buttons content;
the preview follows the active tab. The list view shows one language per row, so a multi-language submit becomes one row per language.

**Header (Optional)**: radios None / Text / Image / Video / Document (no Location).
- Text: input with counter `0/60` and "Add variable (i)".
- Image / Video / Document: dashed upload tile ("Upload Image" / "Upload Video" / "Upload Document"); limits printed beside it:
  **Image 5MB, Video 16MB, Document 100MB**. Note under the tile: "This media file will be sent as a sample to WhatsApp, for approval.
  At the time of sending the template, you can change the media file, if required. You can also send separate media files for each
  customer in a campaign."

**Body**: label "The Whatsapp message in the language you have selected", textarea. No character counter was visible. Toolbar under it:
"Add variable (i)" (tooltip: "These make the content of the message personalized for users"; inserts `{{1}}`, `{{2}}`... and the
preview updates live), an AI button, emoji picker (searchable, "Frequently Used", "Smileys & People", category tabs), **B**, *I*.
- AI button on Marketing: **Generate with AI** opens "Interakt Copilot": "0/10 of your daily prompts used", "How can I assist you
  today?", the six suggestion chips, free-text box with send. Not sent (NOT VERIFIED beyond the shell).
- AI button on Utility: replaced by **Ensure Utility Compliance**, which opens the same Copilot with the box pre-filled "Please refine
  my template to increase the chances of being approved as a Utility template by Meta."

**Footer (Optional)**: single input `0/60` ("Add a short line of text to the bottom of your message template.").

## 6. Step 2 per type

### 6.1 Template with Buttons (Marketing and Utility, identical except the AI button)
Header, Body, Footer as in section 5, then the card "Template with Buttons (Quick Reply, URL, Copy Code etc) / Create buttons that let
customers respond to your message or take action." Banner "The total number of buttons cannot exceed 10. Learn More" with counter `n/10`.
Four drag-reorderable checkbox rows (drag handles; the Coupon Code handle looks fixed):
1. **Add Coupon Code**: a locked "Copy Code" label field plus input "Enter text for coupon code" `0/15`, remove (red minus).
2. **Add Website URL**: dropdown **Static / Dynamic**, protocol dropdown **https:// / http://**, URL input `0/2000`
   (placeholder "Enter url, example: www.interakt.shop"), link **Add UTM Parameters**, button text `0/25`, **Add Another Website URL**, remove.
   - UTM panel ("Adding UTM parameters will help track conversions on tools like Google Analytics"): Campaign Id, Campaign Source,
     Campaign Medium, Campaign Name, Campaign Term, Campaign Content (6 inputs). Edit view shows a summary line `UTMs added: utm_id = ..., ...`.
   - Dynamic shows a blue note "There are 2 ways of providing the dynamic URL: ...read more": (1) dynamic portion as a variable
     (`https://www.example.com/order/{{1}}`), (2) full URL as a variable via an Interakt redirect
     (`https://api.interakt.ai/cta?redirect={{1}}`, with a copy icon); in both, `{{1}}` is mapped to a user trait or event trait.
3. **Add Phone Number**: country-code selector (+91 default), number input `0/20`, button text `0/25`, remove.
4. **Add Quick Replies**: input "Enter text for the Quick Reply button" `0/25`, **Add Another Quick Reply**, remove.

Below the buttons card: **Enable Button Click Tracking (Optional)** toggle (**on by default**), "You can enable this to track clicks on CTAs or
Quick Reply buttons.", amber note "Click tracking will work only if the template is sent via Interakt Campaigns. It won't work if sent via
Interakt's APIs, or via the inbox or any other approach."
The preview shows up to three buttons then "See all options" when there are more.

### 6.2 Simple template (Marketing and Utility)
Header (optional), Body, Footer. No buttons card.

### 6.3 Template with WhatsApp Pay Checkout (Marketing only)
Modal "WhatsApp Pay Integration" (opens on Save in step 1; its own Submit stayed disabled and was not used):
- Amber note: WhatsApp Pay messages only reach recipients with +91 numbers and fail for other numbers.
- STEP 1: "Configure Payment Gateway from your Facebook Business Manager. See how" plus a support-form link.
- STEP 2 "Provide the following details": **Payment Configuration Name** `0/60` ("Provide the same name which you have entered in FB
  Business Manager"); **Select a Payment Gateway** (Razorpay, PayU); **Type of Goods** (Digital Goods, Physical Goods);
  **Payment Confirmation Message** toggle (on by default) with an editable text "Your payment of {{amount}} has been received."; Submit.
Step 2 form (from the page text; layout not captured visually): "Select a button type to proceed" radios **Carousel Message / Single
Image / Video** (Single selected); Header (Image / Video upload, same limits); Body with Add variable and Generate with AI; card
"Template with WhatsApp Pay Checkout / Add checkout button & provide product details" with **Type of Action**, **Button Text**,
"Would you like to send the same product to all customers?" (**Send the same product** / **Send Different Products**), **Product
Details**, **Add Quick Reply Button**. Preview button label "Review and Pay" with a cart icon.

### 6.4 Carousel (Marketing only)
Header section shows only **None** (no header on the main message). Body (with Add variable, AI, emoji, B, I). **No footer.**
Card "Carousel / Create buttons that let customers respond to your message or take action." Banner "The total number of carousel cards
cannot exceed 10." with counter `1/10` (one card exists by default). Each card (drag handle, remove):
- **Upload Card Header** tile (image or video; limits and dialog not captured).
- Card body textarea `0/160` with Add variable, emoji, B, I (no AI).
- **Add a Card Button** menu: **CTA**, **Quick Reply**, **Phone Number**. CTA = dropdown (Static / Dynamic), protocol, URL `0/2000`,
  Add UTM Parameters, button text `0/25` (same dynamic-URL note). More card buttons via "Add a Card Button".
- **Add another Carousel Card** below the list.

### 6.5 Catalog (Marketing only)
Header section is **required** and fixed to **Text** (`0/60`, Add variable). Body (Add variable, AI, emoji, B, I). Footer optional `0/60`.
Card "Catalog": "Customise your campaign or inbox messages by selecting up to 30 products to showcase." with radios
**Send Specific Products** (default) / **Send Entire Catalog**. Preview button "View items".

### 6.6 One-Time Passcode (Authentication only)
Step 2 header shows **Ready to Submit** (green check) as soon as it opens. Name and language as in section 5; per-language tabs exist.
No header, body text, footer or free buttons (body is fixed: preview "{{1}} is your verification code.").
- **Code delivery setup** ("Choose how customers send the code from WhatsApp to your app. Edits to this section won't require review or
  count towards edit limits."): radios
  - **Zero-tap auto-fill** (default, "recommended as the easiest option"): required checkbox of terms ("By selecting zero-tap, I understand
    that <business>'s use of zero-tap authentication is subject to the WhatsApp Business Terms of Service. It's <business>'s
    responsibility to ensure that its customers expect that the code will be automatically filled in...") with links "Learn more and
    review best practices" and amber "This box must be ticked to submit this template."
  - **One-tap auto-fill** ("The code sends to your app when customers tap the button. A copy code message will be sent if auto-fill isn't possible.")
  - **Copy Code** ("Basic authentication with quick setup...").
- **App setup** ("You can add up to 5 apps."): Package Name `0/224` (placeholder "com.example.myapplication"), App Signature Hash `0/11`,
  **Add another app**.
- **Content**: checkbox **Add security recommendation** (checked by default); checkbox **Add expiry time for the code** ("After the code has
  expired, the auto-fill button will be disabled.", unchecked by default). Note: "Content for authentication message templates can't be edited."
- **Buttons**: "You can customise the button text for both auto-fill and copy code. Even when zero-tap is turned on, buttons are still
  needed for the backup code delivery method." Inputs **Auto-fill** (default "Autofill", `8/25`) and **Copy Code** (default "Copy code", `9/25`).
- **Message validity period (i)**: toggle **Set custom validity period for your message** (on by default; "If you don't set a custom validity
  period, the standard 30 days WhatsApp message validity period will be applied."), dropdown **Validity period** default **10 minutes**,
  options start 1, 2, 3, 5, 10 minutes (list scrolls; full list not captured). Explanatory line: undelivered messages are not charged.

## 7. List and lifecycle screens

- **Template Library** tab: horizontal board of ready-made templates grouped by use case: Special Occasions, Occasion Based, Informative,
  Promotional, Lead Qualification, Transactional, Service Alerts. Each card shows a preview (image or text, buttons) and the template
  name. Hovering a card shows two buttons, **Use this template** and **Expand**. "Use this template" opens
  `/template/create?activeTab=template_details` with the category and type already chosen (Marketing, Template with Buttons), step 1
  already checked, and step 2 prefilled (template name = the library name, header text, body, buttons) and marked Ready to Submit.
  "Expand" (a larger preview) was not opened.
- **Active** tab: search "Search a template by name"; **Status** filter (single-choice radios, complete list: Any, Approved, Disabled,
  In Appeal, Pending, Pending Deletion, Rejected, Waiting; "Done"); **Category** filter (checkboxes Marketing, Utility, Authentication; "Done"); amber bar
  "WhatsApp can take up to 24 hours to review (approve / reject) a template. See More"; "Last synced on: <time> + **Sync**" button;
  table columns Template Name (display name + generated name with copy icon), Status (dot + label), Category, Language(s), Created By;
  row hover actions **Send campaign**, **Edit template**, kebab -> **Duplicate**, **Delete**; pagination "20 out of 31 Templates", pages.
- **Edit**: for an approved template a modal "Editing an approved template / Editing an approved template will make changes in the current
  template. If you want to keep the original intact, please choose "Duplicate" option." with **Duplicate** and **Continue Editing**.
  Editor header "Editing Template"; amber banner "An approved template can be edited once per day, upto 10 times per month."; step 1 is
  greyed and locked; Template Name is disabled; step 2 shows Ready to Submit; bottom bar **Cancel** and **Resubmit for Approval** (disabled
  until something changes).
- **Deleted** tab: same filters and columns; per-row restore (clock-arrow) icon with the tooltip "Restore" (what it does was not
  exercised: it would act on a real deleted template); includes Rejected rows.

## 8. What our builder has today that Interakt's screens do not show

Location header, our live lint panel, the variables panel with named mapping keys, the connection (WhatsApp number) picker, name sanitising
rules, draft saving. These stay (they are capabilities, not screens); where they sit in the new layout is a design decision.

## 9. NOT VERIFIED (needs a Submit, an AI call, a credit spend, or a screen not opened)

1. Where the **sample values for variables** are collected (nothing appears before Submit).
2. Validation messages and the rules behind them (name, body, URL, buttons, ordering of buttons, mixed button types).
3. How the unique Meta name is derived from the friendly name; success and failure screens after Submit.
4. AI generation outputs and limits beyond "10 daily prompts"; the entry-modal AI path.
5. What the Library "Expand" button shows; what the Deleted tab's "Restore" does.
6. Carousel: upload dialog, card header format rules, second-card behaviour, per-card button limits, preview carousel behaviour.
7. Pay Checkout step 2 visual layout, product-details sub-form, how the gateway modal's Submit stores data.
8. Validity-period full option list; per-row Status wording for Rejected/Paused with reasons.
9. Utility-specific rule differences beyond the AI button (for example whether Coupon Code is really allowed there at submit time).
10. Quick-reply / URL / phone ordering rules and limits beyond the 10 total and 25-character texts.
