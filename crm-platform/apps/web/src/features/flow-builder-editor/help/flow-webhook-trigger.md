---
id: flow-webhook-trigger
title: Start a flow from another system (webhook)
summary: Give a flow its own web address so a shop, a form tool or your own software can start it for a contact.
area: automation
order: 14
documents: [nav:flows]
keywords: [webhook, api, zapier, integration, trigger, http, post, json]
---

## What it is for

A flow with the **Webhook** start has its own web address. When another system posts a short JSON message to that address, the flow starts for the contact the message names. Use it when something outside Threadwise should begin a conversation: an order was shipped, a form was filled in on another site, a payment failed.

## How to set it up

1. In the Advanced builder, open the **Trigger** node and choose **Integration: an outside system posts to a webhook**.
2. Save the flow. The address belongs to the saved flow, so a new flow shows it only after the first save.
3. Publish the flow and keep it active. Until then the address answers "not found".
4. Copy the **Webhook address** and paste it into the other system as a POST target. The **Try it** box shows a ready-made `curl` call you can run to test.

## What the other system sends

Send a JSON object. Everything in it is optional except a way to find the contact:

- `phone` finds or creates the contact by phone number. `mobile`, `whatsapp` and `phone_number` work too. Include the country code.
- `email` is used when there is no phone number.
- `name` is kept on a contact that is created now. A contact that already exists keeps its own name.
- Every other field becomes a variable you can use in the flow's messages. A field called `order_id` is `{{order_id}}`. A nested field such as `customer.city` is `{{customer_city}}`.

If the message has neither a usable phone nor an email, the call is refused with a 422 and nothing starts.

## Sending the same message twice

Add an `Idempotency-Key` header (or `X-Delivery-Id`) with an id that is unique for each event, for example the order number. If the other system retries a post with the same id, it is acknowledged and the flow does not start again. Without the header, a body that is exactly the same counts as the same post. A different id for the same person starts the flow again, as long as their earlier run has finished.

## Limits and safety

- The address contains a secret part. Anyone who has the address can start the flow, so share it only with the system that should, and never post it in public.
- A flow accepts up to 300 posts a minute, and a body can be up to 64 KB.
- The address works only while the flow is published and active. A wrong address, an unpublished flow and a flow without a Webhook start all answer the same "not found".
- Messages the flow sends still follow the contact's consent and your channel's rules.

## If something looks wrong

- **"Not found"**: check the flow is published and active and that its start is the Webhook one, and that the address was copied whole.
- **422**: the body has no usable `phone` or `email`.
- **Nothing happens after "started"**: look at the flow's runs. A contact who is still in the middle of an earlier run is not started a second time.
