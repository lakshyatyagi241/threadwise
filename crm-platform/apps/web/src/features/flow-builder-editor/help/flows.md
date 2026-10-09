---
id: flows-overview
title: Flows
summary: Build automated WhatsApp conversations, in the Simple step-by-step builder or the Advanced canvas, then publish them.
area: automation
order: 10
documents: [nav:flows]
keywords: [flows, automation, chatbot, builder, simple, advanced, keyword, trigger, validate, schedule, segment, list, workflow]
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

- The top card says when the flow starts: one of the words you list (separated by commas, capitals do not matter) or any message, and the WhatsApp number it runs on.
- Select the **+** under a card to add a step. **Send** steps are message, media, buttons, list, link button, template, send a location and wait. **Ask the customer** steps are a question, name, email, phone number, number, letters and numbers, date, file or image, and their location. Open a step to edit it; use the arrows to move it, or duplicate or delete it.
- **Buttons** (up to 3, each up to 20 characters) and **List** (up to 10 rows) end their part of the flow. Each button or row says where the conversation goes next: any step, or **Ends here**. Choose **Lead to a new flow** to start another flow, which appears in the list on the left.
- A list, buttons or question can also copy what the customer picked or typed to a contact property: turn on **Also copy ... to the contact** and choose a property of your workspace (publishing the Simple builder is blocked until a property is chosen). Buttons and list save the label or row title, even when the customer types its number. In the Flow builder, the same options are **Save the selected option as variable** and **Also save to a contact attribute**.
- A question saves the customer's answer under a name you choose. Use it later in a message as the name in double curly braces. Give each question its own name.
- Name, email, phone number, number, letters and numbers, and date questions check the answer. A wrong answer gets your message (or a ready-made one) and the question stays open. **Stop after wrong answers** sets how many are tolerated: 0 keeps asking until the answer is right, a number moves the flow on without an answer or ends it. A name is letters and spaces only, 2 to 49 characters. A phone number has 7 to 15 digits. A date must be a real day in the format you pick, and a copy as year-month-day is kept in the variable ending `_iso`. Each of these can also copy the answer to a contact property.
- A file or image question accepts the kinds you tick (none ticked means any file), and a location question waits for the customer to share a location.
- **Import** (top right) fills the builder from a `.json` file: a flow exported from Flows, or a flow exported from the wabo console. A wabo file becomes flows of steps, in the console's order and with the console's names where the file has them; steps run in the console's order, and each button or row leads to the step the console linked it to. What Simple has no place for (header images, live-agent or link buttons, template variables, API actions) is listed after the import. The steps in the builder are replaced after you confirm, your WhatsApp number and trigger words stay, and nothing is saved until you press **Save**.
- The list on the left works like the console's: each flow is numbered, shows how many steps it has, can be searched, and has a copy button that duplicates the whole flow (the copy is named "… copy" and nothing leads to it until you link it). The first flow is the one the trigger starts; you can rename it, and it cannot be deleted. After a buttons or list step the flow can carry on with another part, which only runs when a button leads to it; it is marked "Another part of this flow".
- Steps are numbered like `1.2`: the flow, then the step in it, counting across all its parts.
- A flow that nothing leads to is marked with a warning, and it must be reached before you can publish.

## Options and settings

- **Simple and Advanced share one flow.** A flow made in the Simple builder opens on the canvas, and a canvas flow that is a plain list of steps opens in Simple. A flow that uses canvas-only steps (a webhook, a condition and so on) shows what does not fit and offers **Open in Advanced**.
- **Condition groups (Advanced).** A Condition step can hold groups of rules inside groups, for example `plan = pro AND (age > 18 OR city = Pune)`. Each group has an AND / OR switch (AND means every rule and sub-group must match, OR means any one), and **Add rule** / **Add group** build the tree: up to 3 levels deep and 20 rules in all. A rule with no variable, or a group with no rules, is marked in red (an empty group is always false). A Condition made before this existed keeps working exactly as it did; the first time you edit it, it opens as the equal groups. The step on the canvas shows the whole condition on one line with brackets.
- **Other ways to start a flow (Advanced).** Besides a keyword, the Trigger step can start a flow when a contact is added to a tag or a list, **leaves a list**, **enters a segment**, is **created or updated**, or when a **field matches a value** (a flow runs once for each value a contact takes). It can start at a **date and time** (once, every day, every week or every month, for everyone, a list or a segment, up to 5,000 people each time, using your workspace's time zone unless you set one), or **days before, on or after a date** stored on the contact, such as a birthday. For a Shopify or WooCommerce store it can start on **checkout started**, **abandoned cart**, **order fulfilled, refunded or cancelled**, or **a product ordered**; the customer is found by phone number and nobody is created. A list or field change made by another flow does not start these, so flows cannot trigger each other in a loop.
- **Steps that change or check the contact (Advanced).** **Update contact field** sets one field (a name, email, title, language, address or a custom field). **Add / remove list** puts the contact in a list or takes them out. **Is in list**, **Is in segment** and **WhatsApp session active** branch to yes or no. **Check Google Sheet cell** and **Save contact from Sheet** look up a row by a column and need a connected Google account.
- **Builder** (top of the Flows page, for people who can edit flows) sets which builder this workspace uses: Simple, Advanced, or the platform default your administrator chose. Changing it never changes a flow.
- **Publish** needs a trigger word (or any message), a WhatsApp number when you have one connected, and every step filled in. The list of what is missing opens above the steps.

## If something looks wrong

- The **WhatsApp number** list is empty: connect a WhatsApp number first; flows only run on a connected number.
- The flow does not answer: check that it is published, that the word you send matches one of its trigger words, and that its number is the one you wrote to.
- A button does nothing: check that it leads to a step. A button set to **Ends here** sends nothing more.
