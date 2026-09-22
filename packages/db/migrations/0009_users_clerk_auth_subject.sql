-- 0009_users_clerk_auth_subject
-- Clerk is now the identity provider for staff login (ADR-0006 called this
-- exact column for exactly this day). auth_subject holds the Clerk user id.
--
-- Partial unique index, not a table-wide UNIQUE: auth_subject is null for
-- every row until that user's first Clerk-verified login, and a plain
-- UNIQUE constraint treats multiple NULLs as fine in Postgres anyway — this
-- is written as partial regardless, to say explicitly that only non-null
-- values are constrained, not rely on that NULL behavior implicitly.

CREATE UNIQUE INDEX users_org_id_auth_subject_key
  ON users (org_id, auth_subject)
  WHERE auth_subject IS NOT NULL;
