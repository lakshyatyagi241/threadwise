-- tib1: a saved reply's shortcut is unique per owner (plan-inbox-chat.md sections 3.3 and 7 row 20).
-- Why this migration exists: WaDesk slugifies the shortcut but never enforces it, so two replies can answer to `/hello` and the picker
-- picks one at random. Shared replies have no owner (user_id NULL), and NULL is "distinct" for a normal unique index, so
-- NULLS NOT DISTINCT is what makes "one shared reply per shortcut" hold. A personal reply may reuse a shared shortcut: the picker
-- shows both and the personal one wins, as in WaDesk.
-- Rows that would violate this cannot exist yet (no code writes the table), but a development database may have test rows, so any
-- duplicate is renamed rather than failing the migration.
SELECT set_config('app.privileged', 'on', true);
WITH ranked AS (
  SELECT org_id, id, row_number() OVER (PARTITION BY org_id, user_id, shortcut ORDER BY id) AS rn
  FROM saved_replies
)
UPDATE saved_replies s SET shortcut = s.shortcut || '-' || ranked.rn
  FROM ranked
  WHERE ranked.org_id = s.org_id AND ranked.id = s.id AND ranked.rn > 1;

CREATE UNIQUE INDEX uq_saved_replies_owner_shortcut ON saved_replies (org_id, user_id, shortcut) NULLS NOT DISTINCT;
