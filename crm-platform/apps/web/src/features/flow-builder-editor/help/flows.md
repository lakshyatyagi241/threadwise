---
id: flows-overview
title: Flows
summary: Build automated WhatsApp conversations, in the Simple step-by-step builder or the Advanced canvas, then publish them.
area: automation
order: 10
documents: [nav:flows]
keywords:
  [
    flows,
    automation,
    chatbot,
    builder,
    simple,
    advanced,
    keyword,
    trigger,
    validate,
    schedule,
    segment,
    list,
    workflow,
  ]
---

## What it is for

A flow is an automated conversation. It starts when a customer sends a word you chose, then sends messages, asks questions and offers buttons or lists. **Flows** lists your flows and is where you create, open, pause, rename, duplicate, export and delete them.

## How to use it

1. Open **Flows** and select **Create flow**.
2. Your workspace's builder opens. In **Simple** you go straight to the steps, one under another. In **Advanced** you choose **Messaging flow** (the canvas) or **Call** (a voice flow on the canvas).
3. Set when the flow starts and which WhatsApp number it runs on (see below), then add the steps.
4. Select **Save** to keep a draft, and **Publish** to make the flow live.
5. To change a flow later, select it in the list. It opens in your workspace's builder.

## The Simple builder

- Under the header, **Build** is the steps and **FAQs** holds this flow's own FAQs, settings, test, unanswered messages and insights (see [FAQs](help:faq-knowledge)). The FAQs tab needs the flow to be saved once and a role that can read FAQs; a website chat bot also has **Customize** and **Install**. Moving between tabs keeps your unsaved changes to the flow. The Advanced builder has no FAQs tab.
- The top card says when the flow starts: one of the words you list (separated by commas, capitals do not matter) or any message, and the WhatsApp number it runs on.
- Select the **+** under a card to add a step. **Send** steps are message, media, buttons, list, link button, template, send a location and wait. **Ask the customer** steps are a question, name, email, phone number, number, letters and numbers, date, file or image, and their location. **Answer** has **Answer from FAQ**, which replies from this flow's FAQs. Open a step to edit it; use the arrows to move it, or duplicate or delete it.
- **Buttons** (up to 3, each up to 20 characters) and **List** (up to 10 rows) end their part of the flow. Each button or row says where the conversation goes next: any step, or **Ends here**. Choose **Lead to a new flow** to start another flow, which appears in the list on the left.
- A list, buttons or question can also copy what the customer picked or typed to a contact property: turn on **Also copy ... to the contact** and choose a property of your workspace (publishing the Simple builder is blocked until a property is chosen). Buttons and list save the label or row title, even when the customer types its number. In the Flow builder, the same options are **Save the selected option as variable** and **Also save to a contact attribute**.
- A question saves the customer's answer under a name you choose. Use it later in a message as the name in double curly braces. Give each question its own name.
- Name, email, phone number, number, letters and numbers, and date questions check the answer. A wrong answer gets your message (or a ready-made one) and the question stays open. **Stop after wrong answers** sets how many are tolerated: 0 keeps asking until the answer is right, a number moves the flow on without an answer or ends it. A name is letters and spaces only, 2 to 49 characters. A phone number has 7 to 15 digits. A date must be a real day in the format you pick, and a copy as year-month-day is kept in the variable ending `_iso`. Each of these can also copy the answer to a contact property.
- A file or image question accepts the kinds you tick (none ticked means any file), and a location question waits for the customer to share a location.
- **Import** (top right) fills the builder from a `.json` file: a flow exported from Flows, or a flow exported from the old Geta console (a WhatsApp bot or a website chat bot: its buttons, carousels, phone, date and file questions come across, and a file of website chat records opens as a website chat bot). A console file becomes flows of steps, in the console's order and with the console's names where the file has them; steps run in the console's order, and each button or row leads to the step the console linked it to. What Simple has no place for (header images, live-agent or link buttons, template variables, API actions) is listed after the import. The steps in the builder are replaced after you confirm, your WhatsApp number and trigger words stay, and nothing is saved until you press **Save**.
- The list on the left works like the console's: each flow is numbered, shows how many steps it has, can be searched, and has a copy button that duplicates the whole flow (the copy is named "… copy" and nothing leads to it until you link it). The first flow is the one the trigger starts; you can rename it, and it cannot be deleted. After a buttons or list step the flow can carry on with another part, which only runs when a button leads to it; it is marked "Another part of this flow".
- Steps are numbered like `1.2`: the flow, then the step in it, counting across all its parts.
- A flow that nothing leads to is marked with a warning, and it must be reached before you can publish.

## Choose a channel, then customize and deploy

A bot is built for one channel, and you choose it when you create the bot. Select **Create**, then pick **WhatsApp** or **Website chat** (the Advanced builder also offers **Call**). The channel stays with the bot, because a component that works on one channel may not work on another. A website chat bot offers a **Condition** step (rules joined by AND or OR, with a Yes exit and a No exit), text, media (pictures, videos, audio and documents), quick replies, link buttons (a web page, a phone call or an email), carousels (scrolling cards with pictures and buttons), questions (including Ask for file / image) and waiting.

A WhatsApp or website chat bot has three tabs under its name: **Build**, **Customize** and **Deploy**.

1. **Build** is the builder you already know.
2. **Customize** sets how the bot appears on your website. For a website chat bot it is the chat window: colours, title, welcome message, position and intake fields. For a WhatsApp bot it is the website button that opens WhatsApp. The button starts from the number picked on the bot's Trigger and from its keyword, so a tap on the button starts the bot. You can also set a logo, bot name, sub-header and call-to-action text, edit the pre-filled message, switch on a popup bubble that invites a chat (with a side or top position, your own text and an optional picture), and pick a bounce or ripple animation for the button. An amber dot on the tab stays until you have saved it once.
3. **Deploy** gives you the embed code to paste on your website and a preview. A WhatsApp bot also gets the direct WhatsApp link to share in emails and bios, and a QR code you can download and print. Scanning it opens a WhatsApp chat with the bot.

**Publish** asks you to save **Customize** once first. Deploy shows the code only; the bot goes live when you publish it. A website chat bot answers a visitor from their first message. See [Website chat bots](help:web-bots-overview).

## Options and settings

- **Simple and Advanced share one flow.** A flow made in the Simple builder opens on the canvas, and a canvas flow that is a plain list of steps opens in Simple. A flow that uses canvas-only steps (a webhook, a condition and so on) shows what does not fit and offers **Open in Advanced**.
- **Condition groups (Advanced).** A Condition step can hold groups of rules inside groups, for example `plan = pro AND (age > 18 OR city = Pune)`. Each group has an AND / OR switch (AND means every rule and sub-group must match, OR means any one), and **Add rule** / **Add group** build the tree: up to 3 levels deep and 20 rules in all. A rule with no variable, or a group with no rules, is marked in red (an empty group is always false). A Condition made before this existed keeps working exactly as it did; the first time you edit it, it opens as the equal groups. The step on the canvas shows the whole condition on one line with brackets.
- **Other ways to start a flow (Advanced).** Besides a keyword, the Trigger step can start a flow when a contact is added to a tag or a list, **leaves a list**, **enters a segment**, is **created or updated**, or when a **field matches a value** (a flow runs once for each value a contact takes). It can start at a **date and time** (once, every day, every week or every month, for everyone, a list or a segment, up to 5,000 people each time, using your workspace's time zone unless you set one), or **days before, on or after a date** stored on the contact, such as a birthday. For a Shopify or WooCommerce store it can start on **checkout started**, **abandoned cart**, **order fulfilled, refunded or cancelled**, or **a product ordered**; the customer is found by phone number and nobody is created. A list or field change made by another flow does not start these, so flows cannot trigger each other in a loop.
- **Steps that change or check the contact (Advanced).** **Update contact field** sets one field (a name, email, title, language, address or a custom field). **Add / remove list** puts the contact in a list or takes them out. **Is in list**, **Is in segment** and **WhatsApp session active** branch to yes or no. **Check Google Sheet cell** and **Save contact from Sheet** look up a row by a column and need a connected Google account with the Sheets permission (see [Google account](help:google-account)).
- **Call a saved API (Advanced).** The **API (from library)** step, in the Integrations group, runs an API you saved in [API Library](help:api-library-overview) for the contact of the run. Pick the API, optionally type a value for any of its variables (values can use curly-brace variables), and choose the variable the answer is saved under. It leaves by **success** when the API answers 2xx and by **error** otherwise, and a publish is blocked until an API is picked. Simple does not offer this step.
- **Answer a question from your FAQs.** The **Answer from FAQ** step (Advanced: the AI group; Simple: **Answer** in the **+** menu) matches a message against the [FAQs of this flow](help:faq-knowledge) by meaning, and its form links to the flow's FAQs tab in the Simple builder (before the first save the flow has none). By default it matches the customer's last message; **Message to match** can be another message or a variable a question step saved. It leaves by **answered** when an FAQ answered: a text FAQ is sent to the customer, and an FAQ that goes to a step continues there (a step of this flow, or of another flow) and does not come back. It leaves by **no match** when nothing was close enough, when the platform has switched FAQ answering off, when the flow or step an FAQ goes to is gone, or when the message is empty. **Only these FAQs** limits the match to one category of this flow's FAQs. **Minimum score** (0.05 to 0.99) replaces the flow's score for this step only; leave **Use this flow's setting** on to keep it, and try a message on the flow's FAQ test page before choosing a number, because scores depend on the embedding model the platform uses. Turn off **Send the answer to the customer** to only save the answer, so a later step can word the reply. The result is saved as `faq.answer`, `faq.question`, `faq.score`, `faq.id` and `faq.matched` (yes or no); you can change `faq` to another name. The step works even if you never switched automatic FAQ answering on in the flow's FAQ settings. Publishing is blocked when the minimum score is outside 0.05 to 0.99. In the Simple builder the step ends its part of the flow like buttons and lists do: you choose where each of its two exits leads, and it can only be added last in a part. The test chat does not look up the flow's FAQs: it sends nothing, leaves by **answered** (or by **no match** when only that exit is connected) and says it is simulated.
- **Builder** (top of the Flows page, for people who can edit flows) sets which builder this workspace uses: Simple, Advanced, or the platform default your administrator chose. Changing it never changes a flow.
- **Publish** needs a trigger word (or any message), a WhatsApp number when you have one connected, and every step filled in. The list of what is missing opens above the steps.

## If something looks wrong

- The **WhatsApp number** list is empty: connect a WhatsApp number first; flows only run on a connected number.
- The flow does not answer: check that it is published, that the word you send matches one of its trigger words, and that its number is the one you wrote to.
- A button does nothing: check that it leads to a step. A button set to **Ends here** sends nothing more.
