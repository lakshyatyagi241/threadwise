-- @no-transaction
-- bluegreen-ok: ALTER TYPE ... ADD VALUE only appends a value to record_scope; no row, column or value the live slot reads changes. The new value is written only by new code (a role saved with 'My team and sub-teams'), after the switch.
-- Scope 'team_and_below' (BL-382, phase T2 of docs/specs/teams-unification.md): a role may grant a permission for the caller's team AND every
-- team below it (teams.parent_team_id, T1). Runs outside a transaction and holds exactly this one statement: an enum value cannot be used in the
-- transaction that adds it, so everything that mentions the value is in the migrations after this one.
-- Mirrored in packages/db/src/schema/enums.ts and packages/contracts/src/common/enums.ts.
ALTER TYPE record_scope ADD VALUE IF NOT EXISTS 'team_and_below';
