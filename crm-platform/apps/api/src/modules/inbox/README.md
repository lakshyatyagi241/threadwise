# Inbox & Bot

Not implemented yet. Structure to follow when it lands:

```
inbox/
  conversations/    controller · service · repository · mapper
  messages/         stream writes, thread reads
  bot/              flow engine, sessions, handoff
  assignment/       manual + round-robin
  sla/              policies, due stamps, breach sweep
  webhooks/         inbound provider webhooks (signature-verified)
  inbox.module.ts
  index.ts          ← the only import path other modules may use
```

## Decisions already made

- **One perpetual thread per contact per channel.** Unique on
  `(org_id, channel_id, contact_id)`. Resolving a conversation does not close
  it — the next inbound message reopens the same row. A new thread per message
  burst would fragment the history the agent needs.
- **`messages` and `message_events` are exempt from audit and outbox triggers.**
  They _are_ the log. At 10–25M rows/month, auditing them would double the
  write volume to record nothing new.
- **Conversation lifecycle events go through the outbox** (created, assigned,
  resolved, SLA breached). Individual messages do not — that firehose would
  bury the drain.
- **The 24h WhatsApp service window is state, not a rule in code.**
  `service_window_expires_at` on the conversation decides free-form vs template.
- **Webhook handlers ack fast and enqueue.** Meta retries aggressively on a slow
  response; parsing inline turns a provider hiccup into duplicate messages.

## Ordering note

Delivery receipts arrive out of order. `messages.status` must only move
forward (queued → sent → delivered → read); a late `sent` after a `delivered`
must be recorded in `message_events` and ignored for the summary column.
