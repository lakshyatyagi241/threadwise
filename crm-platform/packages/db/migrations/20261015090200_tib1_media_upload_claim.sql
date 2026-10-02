-- tib1: remember which send used an uploaded attachment (follows 20261015090100).
-- Why this migration exists: a send names its attachment by upload id, and the same send can arrive twice (a client retries a request it
-- never saw the answer to). The first arrival claims the upload; the second must be recognised as the same send, which is answered with
-- the first message, not refused because "the upload is used". The sender's `clientMessageId` is what tells them apart: a different
-- message cannot take an upload that is already claimed.
SELECT set_config('app.privileged', 'on', true);

ALTER TABLE conversation_media_uploads ADD COLUMN used_by_client_message_id uuid;
ALTER TABLE conversation_media_uploads
  ADD CONSTRAINT chk_conversation_media_uploads_claim CHECK ((used_at IS NULL) = (used_by_client_message_id IS NULL));
