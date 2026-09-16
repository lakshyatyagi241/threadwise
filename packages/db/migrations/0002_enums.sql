-- 0002_enums
-- Only the enums the foundation + contacts slice actually uses. The remaining
-- enums from the platform diagram land with their own domain migrations.
--
-- Reminder for later: adding a value is ALTER TYPE ... ADD VALUE (cheap, but
-- it cannot run inside a transaction block — use -- @no-transaction).
-- REMOVING a value is not supported; plan enum values as append-only.

DO $$ BEGIN
  CREATE TYPE record_lifecycle AS ENUM ('draft', 'active', 'archived', 'deleted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE perm_effect AS ENUM ('allow', 'deny');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE record_scope AS ENUM ('all', 'team', 'own');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE partner_agent_status AS ENUM ('active', 'suspended');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE api_key_status AS ENUM ('active', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
