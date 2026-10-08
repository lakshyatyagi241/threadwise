-- notif: Web Push, phase 3 of the realtime notifications (docs/specs/realtime-notifications.md section 14, BL-097).
-- Why this migration exists: a person who allowed browser notifications gets an OS-level push for the events that already put a row in
-- their bell, even with the CRM tab closed. That needs (a) one stored browser subscription per device the person enabled and (b) a
-- fourth, per-person channel ("push") next to bell, pop-up and sound.
--
-- push_subscriptions was created empty by the WaDesk schema port (20261001100400) with a single global unique on the endpoint and a
-- nullable owner. Web Push needs the opposite shape, so this reshapes it (the table holds no rows anywhere: nothing sent to it before):
--   * the owner is mandatory and a removed user takes their devices along (ON DELETE CASCADE); the composite FK stays;
--   * an endpoint is unique per person, not globally: the same browser profile signed in as two people (or in two workspaces) keeps one
--     subscription per person and the push service routes by endpoint, so a global unique would let one tenant's subscribe fail or
--     hijack another's. The service also drops the SAME endpoint from other people of the workspace when someone subscribes on a shared
--     browser, so a sign-out does not leave the previous person's alerts on the next person's screen;
--   * `last_notified_at` becomes `last_used_at` (the last time a push to the device was accepted by the push service);
--   * `last_error_at`, `failure_count` and `revoked_at` let the sender back off and stop: a push service answering 404 or 410 means the
--     browser dropped the subscription, so it is revoked (kept for the list's honesty, never sent to again) and pruned later;
--   * `label` is a short human name for the device ("Chrome on Windows") derived from the user agent when the device subscribes.
-- `endpoint` and the two keys are secrets: whoever holds them can push to that browser. They are only ever read by the sender.

DELETE FROM push_subscriptions WHERE user_id IS NULL;

ALTER TABLE push_subscriptions RENAME COLUMN last_notified_at TO last_used_at;
ALTER TABLE push_subscriptions
  ADD COLUMN label         text,
  ADD COLUMN last_error_at timestamptz,
  ADD COLUMN failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN revoked_at    timestamptz,
  ALTER COLUMN user_id SET NOT NULL;

ALTER TABLE push_subscriptions DROP CONSTRAINT uq_push_subscriptions_endpoint_hash;
ALTER TABLE push_subscriptions ADD CONSTRAINT uq_push_subscriptions_user_endpoint UNIQUE (org_id, user_id, endpoint_hash);

ALTER TABLE push_subscriptions DROP CONSTRAINT fk_push_subscriptions_user_id;
ALTER TABLE push_subscriptions ADD CONSTRAINT fk_push_subscriptions_user_id
  FOREIGN KEY (org_id, user_id) REFERENCES users (org_id, id) ON DELETE CASCADE;

ALTER TABLE push_subscriptions
  ADD CONSTRAINT chk_push_subscriptions_endpoint_len CHECK (char_length(endpoint) BETWEEN 1 AND 2048),
  ADD CONSTRAINT chk_push_subscriptions_failures CHECK (failure_count >= 0);

-- The sender asks for "this person's live devices"; the list asks for the same.
CREATE INDEX idx_push_subscriptions_live ON push_subscriptions (org_id, user_id) WHERE revoked_at IS NULL;
-- The prune of revoked rows.
CREATE INDEX idx_push_subscriptions_revoked ON push_subscriptions (revoked_at) WHERE revoked_at IS NOT NULL;

-- The per-person "push" channel. NULL = inherit the catalogue default (on for chat events, assignments and mentions only), exactly like
-- bell / toast / sound, so a later change of a default still reaches everyone who never chose.
ALTER TABLE notification_user_prefs ADD COLUMN push boolean;
