---
id: ai-training-overview
title: AI Training
summary: Build smart agents and teach them from your own pages, files, text and question-and-answer pairs. Flows and the website chat answer from them.
area: settings
order: 5
documents: [tile:ai-training]
keywords: [knowledge base, smart agent, assistant, faq, train, sources, meta business agent, responder, chatbot]
---

## What it is for

AI Training is where you make **smart agents**: a persona, a model and a safety net, plus the **knowledge** the agent answers from. A flow's AI step and your website chat widget can use an agent, so replies come from your own content instead of the model's general knowledge.

## How to use it

1. Open **Settings**, then **AI Training** under Automation and AI, and select **New smart agent**.
2. **Identity.** Name the agent (visitors never see the name), choose whether it is live or paused, set its language and tone.
3. **Persona.** Write the opening line a visitor sees first, and the character brief that tells the agent how to behave.
4. **Brain.** Choose the provider and model from the list your admin enabled, how long replies may be, and how creative they may be.
5. **Safety.** Write a fallback reply for when the model fails, and set the phrase that hands the chat to a person.
6. **Knowledge.** Add what the agent should know. The agent is saved when you leave Safety, because entries attach to a saved agent.

Select **Finish & close** when you are done, or **Save draft** at any point.

## Adding knowledge

- **Live URL.** Give a public page address. The page is read in the background, so the entry shows **processing** for a moment and then **ready**, or **failed** with the reason, for example a page that needs a sign-in or a private address.
- **Free text.** Paste a help snippet or a policy.
- **Q&A pair.** One question with its answer, the quickest way to cover a common question.
- **File.** Upload a PDF, DOCX, TXT, Markdown, CSV or HTML file of up to 10 MB. The text is extracted for you. A scanned PDF with no text layer cannot be read: paste its text instead.

Only entries that are **ready** are used. Removing an entry stops the agent using it for new replies. A few well-chosen pages or one Q&A per common question usually does more than loading a whole site.

## Using an agent

In a flow, open the AI step and pick the agent under **Knowledge base**. If you have none yet, **Create knowledge base** opens this screen in a new tab, and **Refresh list** brings the new agent into the picker. Pick the same agent in the **Smart agent** step of a chat widget.

Duplicating an agent copies its settings and its entries. The copy is paused, so it never answers until you switch it on. Deleting an agent deletes its entries and uploaded files, and widgets or flows that used it stop answering with it.

## Who answers your WhatsApp

The card at the top of the page chooses between your own AI and Meta's Business Agent, so a customer never gets two answers.

- **Our AI answers.** The default: your AI and keyword auto-replies handle chats.
- **Meta agent answers.** Meta's agent replies and your AI stays silent.
- **Meta agent, then handoff.** Meta answers first questions and escalated chats land in your team inbox.

Tick **I use Meta Business Agent** to tell the workspace you have it switched on, then select **Save**. Meta's agent needs a WhatsApp Business (Cloud API) number. This setting only records your choice.

## Plan and access

The screen needs the **AI assistants** plan feature; without it an upgrade sheet covers the page. Viewing, creating, editing and deleting agents are separate rights, and changing who answers WhatsApp is its own right.

## If something looks wrong

- **An entry shows failed.** The reason is under the state. A page that needs a sign-in, points to a private address or has no text cannot be read. Remove the entry and add the text yourself.
- **A file is refused.** Check the type and size, and that old Word `.doc` files are saved as `.docx` first.
- **The agent does not use a new entry.** Entries still processing or failed are skipped, and an agent that is paused is hidden from pickers.
- **No models in the Brain step.** Ask your admin to enable a model, or add your own key under Settings, AI keys, where your plan allows it.
- **The page says it was changed elsewhere.** Reload it to get the latest version, then save again.
