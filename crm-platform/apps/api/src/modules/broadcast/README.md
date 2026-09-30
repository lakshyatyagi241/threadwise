# Broadcast

Not implemented yet. Structure to follow when it lands:

```
broadcast/
  templates/        WhatsApp approval + DLT lifecycle
  audiences/        static lists + saved dynamic segments
  campaigns/        create, schedule, start/pause, report
  sender/           throttled dispatch worker
  broadcast.module.ts
  index.ts
```

## The campaign pipeline, in order

1. **Resolve audience** — static members, or evaluate the segment filter at
   send time (a dynamic segment is a query, not a snapshot).
2. **Consent + dedupe** — every skip is written to `campaign_recipients` with a
   `skip_reason`. Nobody is ever silently dropped; "why didn't this person get
   it" must always be answerable.
3. **Reserve budget** — estimated cost held on the wallet. Insufficient funds is
   a HARD BLOCK, not a warning: status becomes
   `paused_insufficient_funds` and nothing is sent.
4. **Throttled send** — BullMQ rate limiter at `throttle_per_min`. Each send
   writes a `usage_charge` with the rate frozen at that moment.
5. **Settle** — on completion, settle actuals and release the remainder of the
   reservation.

## Counters

`campaigns.sent_count` and friends are updated in **batches every 2–5s** by a
worker, never per delivery receipt. At 5 lakh messages/day, incrementing one
row per receipt means every worker queuing behind the same row lock.
