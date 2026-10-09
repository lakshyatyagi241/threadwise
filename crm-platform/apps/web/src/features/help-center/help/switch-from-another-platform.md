---
id: switch-from-another-platform
title: Move over from another platform
summary: A checklist for moving to this workspace from another tool: what you can bring across, what you must set up again and what does not move.
area: getting-started
order: 40
documents: []
keywords: [migrate, migration, switch, move, another platform, checklist, import, templates, contacts, history, webhooks]
---

## What it is for

This guide is a checklist for moving a team over from another WhatsApp or CRM tool. It only lists things this workspace can really do. Some parts of your old setup come across with a file or a sync, some you recreate by hand, and some cannot be moved at all. The last section says which.

> Plan an overlap. Keep the old tool running while you set things up here, and switch your customers' traffic over only once the checks at the end pass.

## The checklist

1. **Set up your team.** Invite the people who will work here and give each a role. See [Invite teammates and choose their roles](help:invite-teammates-and-roles).
2. **Connect your WhatsApp number.** See [Connect your first WhatsApp number](help:connect-first-whatsapp-number). The number must be on the WhatsApp Cloud API, and a number can be connected to one workspace at a time. If the card says **Not on Cloud API**, register it in WhatsApp Manager at Meta first, as the message on the card explains.
3. **Recreate how you describe contacts.** Before importing people, set up what the file will refer to: your lifecycle stages in [Contact stages](help:contact-stages), custom fields in [Contact properties](help:contact-properties), message variables in [Attributes](help:contact-attributes), and the audiences you want in [Contact groups](help:contact-groups).
4. **Import your contacts.** Export them from the old tool as a CSV file and follow [Import your contacts from a CSV file](help:import-contacts-csv). Rebuild your saved audiences as [Segments](help:segments-overview) afterwards.
5. **Bring your message templates across.** WhatsApp templates belong to your WhatsApp Business account at Meta. On **Templates**, select **Sync from Meta** to fetch the ones already on the account you connected. Templates that live elsewhere have to be created again with **New template** and submitted to Meta for review. See [Message templates](help:message-templates-overview). Wait for **Approved** before you use a template in a [campaign](help:campaigns-create).
6. **Check incoming messages.** Send a message to the number from another phone and look for it in the [Team inbox](help:team-inbox-overview). If it does not arrive, select **Fix inbound** on the number's card.
7. **Set up the rest you rely on.** Depending on your business: [deal pipelines](help:deal-pipelines) for sales, [business profile](help:business-profile-settings) and [tax rates](help:tax-rates-settings) for invoices, [Social leads](help:lead-sources) if forms or ads send leads by webhook, and your store connection under [Shopify](help:shopify-store) or [WooCommerce](help:woocommerce-store).
8. **Run both side by side for a short while.** Compare a few real conversations, a test broadcast to your own number and a handful of imported contacts before you retire the old tool.

## What does not move

- **Conversation history.** There is no way to import past chats from another tool. Finish old conversations there and start new ones here. The one exception is a number connected as a **Business App number** through Meta: Meta pushes the recent chat history of that phone once when you connect, and the number's **Health** page has **Sync chat history** to ask again.
- **Webhooks and the REST API.** Settings lists **Webhooks** and **REST API** as coming soon, so you cannot point your own systems at them yet. Anything that depended on the old tool's webhooks needs a different route for now.
- **Opt-outs.** The CSV import cannot carry opt-out status. Mark the people who opted out on their contact, using **Marketing opt-out**, so broadcasts and campaigns skip them.
- **Approvals and quality ratings.** These stay with Meta. A new template is reviewed again, and a number's quality and messaging limit are shown as Meta reports them.

## Plan and access

Each step needs the permission of the screen it uses, so the person doing the move should be an Owner or Admin. Contacts, seats and some features such as Social leads are limited by your plan.

## If something looks wrong

- **Contacts are missing after the import.** Open the import result and download the rejected rows. Common causes are a missing phone number or name, or a plan limit.
- **A template is rejected by Meta.** It stays as a draft with Meta's reason. Edit it and submit again.
- **Messages do not arrive here.** Check the number's card for **Inbound not wired** and use **Fix inbound**. Open **Health** to see what Meta reports for the number.
