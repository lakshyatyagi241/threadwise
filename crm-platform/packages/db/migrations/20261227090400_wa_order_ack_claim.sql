-- Durable claim for the WhatsApp order acknowledgement (ASYNC-022 / idempotency audit gap 1).
--
-- Why. The outbox reruns every subscriber of an event when any one of them fails, for hours, so the order-received message must be
-- sent once per order however many times `whatsapp.order.received` is delivered. The claim first lived in a Redis key; a Redis flush
-- inside the retry window could allow one repeat. It now lives on the order, so it survives a restart and a flush.
--
--   ack_claimed_at  when a worker took the right to send the acknowledgement. A claim older than 10 minutes with nothing sent is stale
--                   (the worker died mid-send) and can be taken again.
--   ack_sent_at     when the acknowledgement went out. Once set it is never sent again.
--
-- Nullable columns without a default: no table rewrite, no new table (so RLS, the privacy registry and the tenancy audit are unchanged).
-- The touch_row trigger bumps row_version and updated_at on the claim, which only matters to a merchant saving an edit in the same second
-- the order arrives.

ALTER TABLE wa_orders
  ADD COLUMN IF NOT EXISTS ack_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS ack_sent_at timestamptz;
