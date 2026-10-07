---
id: webhooks
title: Webhooks
summary: Send events from your workspace to your own systems as they happen, signed and retried, with a log of every delivery.
area: settings
order: 40
documents: [tile:webhooks]
keywords: [webhook, webhooks, events, callback, endpoint, http, integration, signature, secret, delivery log, retry]
---

## What it is for

A webhook sends a message to a web address of yours each time something happens in your workspace, such as a contact being created or a deal moving to another stage. Use it to keep another system in step without asking this one for changes.

## How to use it

1. Open **Settings**, go to **Integrations and developer** and select **Webhooks**.
2. Select **Add webhook**. Enter the **Endpoint URL**: an https address that is reachable from the internet.
3. Choose the **Events** you want, or leave **All events** on.
4. Optionally type a **Signing secret**. When it is set, every delivery carries a signature your server can check.
5. Select **Add webhook**. Use **Send test** on the endpoint to confirm your server answers.
6. Select **Deliveries** to see the recent attempts: when, which event, what your server answered and how long it took.

> The signing secret is shown once, when you type it. It cannot be read back; to change it, type a new one.

## What your server receives

Each delivery is a `POST` with a JSON body: `id` (the same for every retry of one event), `event`, `createdAt` and `data` (the facts of the event). The headers are `X-Webhook-Event`, `X-Webhook-Id`, `X-Webhook-Timestamp` and, when a secret is set, `X-Webhook-Signature`: `sha256=` followed by the HMAC-SHA256, keyed with your secret, of the timestamp, a dot and the raw body. Answer with any 2xx status within 10 seconds.

## Retries and health

A delivery that does not get a 2xx answer is tried again up to six times in all, waiting longer each time. A refusal that cannot improve (most 4xx answers) is not repeated. An endpoint whose last delivery failed for good shows **Failing**; the next successful delivery clears it. You can switch an endpoint off without deleting it.

## Options and settings

- **Events**: the list of event types to send; **All events** sends every type, now and later.
- **Active**: off stops deliveries without losing the settings or the log.
- **Name**: a label for you.

## Plan and access

Seeing webhooks needs the permission to view them; adding, changing, deleting and testing need the permission to manage them. Owners and Admins hold both by default. Your plan must include outbound webhooks and have room under its webhook limit; a locked tile means the plan does not include them.

## If something looks wrong

- **The URL is refused.** It must start with https and point to a public address; localhost, private networks and internal names are not allowed.
- **Deliveries show "no answer".** Your server did not respond within 10 seconds or could not be reached. Check the address and the firewall.
- **Deliveries show 401 or 403.** Your server rejected the request; check it accepts the signature and any allow-list.
- **Nothing arrives.** Check the endpoint is **Active** and subscribed to the event, then use **Send test**.
