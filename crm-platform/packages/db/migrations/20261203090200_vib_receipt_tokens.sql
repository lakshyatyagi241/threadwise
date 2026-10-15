-- vib: remember Viber's message token on each broadcast recipient (TW-VIB-013, 014).
--
-- Why this migration exists: Viber answers every send with a `message_token` and later reports `delivered` and `seen` for that token
-- and the user. Reference's broadcast mirror never stored the token on the recipient, so those receipts could not be matched to a
-- broadcast row and its delivered and seen figures never moved. The token goes on the recipient (a batch of up to 300 shares one
-- token, so a receipt is matched on token AND Viber user id), with the time of each receipt, and the broadcast carries the two
-- totals. `media_size` is the file's size in bytes, which Viber requires for a video message.
-- Additive only: nothing in the base schema is changed or dropped.

ALTER TABLE viber_broadcast_recipients
  ADD COLUMN message_token text,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN seen_at timestamptz;

CREATE INDEX idx_viber_broadcast_recipients_message_token
  ON viber_broadcast_recipients (org_id, message_token, viber_user_id);

ALTER TABLE viber_broadcasts
  ADD COLUMN delivered integer NOT NULL DEFAULT 0,
  ADD COLUMN seen integer NOT NULL DEFAULT 0,
  ADD COLUMN media_size bigint;
