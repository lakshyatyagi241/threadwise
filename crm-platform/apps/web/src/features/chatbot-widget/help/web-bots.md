---
id: web-bots-overview
title: Website chat bots
summary: Every bot you built for website chat, the widget it runs in, and shortcuts to change its look or copy its embed code.
area: settings
order: 31
documents: [tile:web]
gates:
  planFeature: chatbot_widgets
keywords:
  [website chat, web, widget, chat window, embed, deploy, customize, bot, live chat, channel]
---

## What it is for

A website chat bot is a flow built for the **Website chat** channel. Visitors talk to it in a chat window on your site. **Website chat** under Settings, then Channels lists every such bot with the widget it runs in, so you can change how the window looks or copy its embed code without hunting through your flows.

## How to use it

1. Open **Settings**, then **Website chat** under Channels.
2. Read the state next to each bot:
   - **Needs customizing**: the chat window has not been saved yet. Open **Customize** and save it once.
   - **Draft**: the window is saved but the bot is not published.
   - **Live**: the bot is published and visitors get answers.
   - **Paused**: the bot is unpublished or switched off, or its widget is paused.
3. Select **Customize** to open the bot with its **Customize** tab ready, or **Deploy** to open its **Deploy** tab and copy the embed code. Select the bot's name to open its builder.
4. Select **New website bot** to build another one. You choose the channel first, and Website chat is already chosen.

## Options and settings

- **Customize** has a slim rail of section icons (**Brand**, **Window**, **Launcher**, **Behaviour**, **Launch**) that jumps to that section, the settings panel beside it, and a live preview on the right in front of a sample web page. The preview is the real chat window and follows every change before you save. Switch it between **Chat window**, **Expanded**, **Phone** and **Closed launcher** to check each way a visitor can meet the bot.
- **Brand** (in Customize) takes your **Bot name**, a **Primary colour** that tints the header, the launcher and the buttons together (every colour can still be set on its own under **Fine-tune every colour**), the **Header background**, the **Body corners** and three pictures: a **Company logo** (shown in the round place of the chat header), a **Chatbot avatar** (shown beside each message the bot sends) and a **Chat background**. Upload SVG, PNG, GIF, JPG or WebP files up to 1 MB; they are stored with the bot and served to your visitors from our address, so they keep working on any site. An SVG that contains scripts, links or embedded pages is refused.
- **Behaviour** (in Customize) sets the opening message, which details the window asks for first (name, email, phone), **Open by itself after** a number of seconds (0 keeps the chat closed; it opens once per visit and never after the visitor has opened or closed it), a soft **sound** for new bot lines with its volume, the **voice conversation** (the microphone), **Read the bot's lines aloud**, and the devices (desktop, tablet, phone) the widget shows on. **Only show the chat on these websites** limits the widget to the sites you list (up to ten, written as `example.com`; a site's subdomains are not included unless you add them). Visitors on any other site get no chat, and switching it off allows every site again. **Offer a floating chat window** lets a visitor who has written and then switches tabs keep chatting in a small window that floats over other tabs and apps, like a video call. It needs a browser with the Picture-in-Picture window feature (Chrome or Edge); other browsers do not show it. After the visitor's first message the window asks once whether to allow notifications; when they then leave the tab, a notification offers to continue, and the chat window also has a float button in its header. The browser decides when a floating window may open, so the notification can bring the visitor back to the tab with the offer ready.
- **Conversation tools** (in Customize, at the bottom of **Window**) hold four things your chat window can carry, each a card you open to edit, each with its own switch that turns it off without losing what you typed:
  - **Notification block**: a bell in the header with up to five cards. Each card has a picture, a title (60 characters), a line of text (100), a button with a title (28) and an address, and a footer (20). Pick one of four bell styles.
  - **Quick menu**: up to five entries in a menu behind the hamburger icon at the start of the header, shown as **Lists** or **Blocks**. An entry with a picture and an address opens that page, call or email; an entry with no address sends its title as the visitor's message, which the bot answers.
  - **Banner**: up to five slides above the conversation, each a picture or a YouTube or Vimeo video, with an optional link. Pictures change every few seconds; a visitor can dismiss the banner.
  - **Quick replies**: up to four lines under the conversation until the visitor writes. A tap sends the line as a message, or, when you pick a step under **When tapped**, starts the bot from that step.
  - A quick menu entry or a banner slide can **Add link** (a page, a call or an email) or **Link to flow**: pick a step of the bot and a tap starts the bot from that step, replacing the conversation in progress. Only the bot's own saved steps are offered, so save the bot after adding steps.
- **Chat window** (in Customize) sets the **text size**, the **reply button hover colour**, the **Header background** (solid, diagonal, vivid, dusk or soft sweep, drawn from your header colour), the text direction (follow the visitor's language, or force left to right or right to left), whether reply buttons carry a round icon, how reply buttons are filled (outline, tinted or solid) and shaped (pill, rounded, soft or square), the typeface and the window size, up to four **suggestions** shown under the conversation until the visitor writes, the copy and thumbs icons under each bot line (a thumbs up or down is kept on that line for your team), the expand button, and a **voice conversation** that uses the visitor's browser to listen and speak.
- **Closed launcher** (in Customize) sets where the launcher sits (a gap from the screen's side and bottom, set apart for a desktop and for a phone) and what visitors see before they open the chat: a callout (a bubble above, a pill beside, a pill with an avatar, a picture card or an input bar) with your text and picture, a bounce or ripple, and the unread dot. A visitor can dismiss the callout.
- **The cross in the chat window.** Every website bot's window has a cross in its header. Selecting it offers two choices: **Close this chat** first asks the visitor for 1 to 5 stars (once they have written; **Skip** closes without a rating), then hides the window and ends the chat, and **Restart this chat** starts a new conversation straight away. Either way the visitor gets a fresh conversation (the details they gave on the opening form are asked again), and the earlier conversation stays in your inbox as it was; the stars are kept as that conversation's satisfaction rating, which the dashboards count. The words come in the visitor's language.
- The chat window speaks the visitor's browser language (21 languages, right to left where it applies).
- **Deploy** shows the embed code to paste just before the closing `</body>` tag, and a link to the standalone chat page. Nothing is deployed from there: the bot goes live when you publish it.
- A website chat bot starts when the visitor writes their first message. It answers with text, pictures, videos, audio and documents (the **Media** step), quick replies (up to three buttons), **Link button** steps (up to three buttons that open a web page, start a phone call or write an email) and **Carousel** steps (up to ten scrolling cards with a picture, a title, a line of text and up to two buttons each). A button can reply in the chat, open a page, call, write an email or hand the visitor to a person of the team you choose. A **Condition** step branches on rules joined by AND or OR. Questions follow. A question can ask for a name, email, phone number, number, letters and numbers or a date (a phone question can also **verify the number with a one-time code** sent to it, which needs the country code), and the chat window then shows the matching keyboard or date picker. **Ask for file / image** shows an **Attach a file** button, and the file is checked again on the server (up to 10 MB). A longer menu is shown as numbered options.
- **Button icon** (in the flow builder): on a website chat bot, a reply button or a link button can carry a small picture, an optional **Icon** you upload on the button's step (PNG, JPG, WebP, GIF or SVG, up to 1 MB). The bot has to be saved once first. The picture replaces the round arrow in front of the button; buttons without one look as before.
- Each bot has one widget. Deleting the bot deletes its widget.

## Plan and access

You need the right to view flows to open this page and to change a bot. Saving the chat window needs the **Chatbot widgets** plan feature. The list shows the newest 200 bots and says how many there are in all.

## If something looks wrong

- **Publish says to customize first.** A website chat bot cannot go live until its chat window has been saved once. Open the **Customize** tab, then save.
- **The bot is Live but the window does not answer.** Check that the embed code on your page is the current one, and that the bot is not paused.
- **A bot is missing.** Only bots built for Website chat are listed. WhatsApp bots are in **Flows**.
