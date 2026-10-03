-- company: the companies table reshaped from the platform's generic record into the WaDesk company (WD-CTP-001..).
-- Why this migration exists: 0004 created `companies` for the CRM kernel (a nullable name, no creator) and 20261001103900 added the
-- WaDesk columns (email, phone, industry, size_range, address, notes). A company in WaDesk always has a name, remembers who created it
-- and has bounded text fields; the list pages on (created_at, id) and on the name. Those are fixed here. Applied migrations are
-- immutable, so this fixes forward, and the UPDATEs make any existing row valid before a rule is added, so it also runs on a
-- database that already has rows.
--
-- Column mapping from WaDesk: `website` is `domain`, `user_id` (the creator) is `created_by`, `owner_user_id` is `owner_id`,
-- `custom_attributes` is `data` (WaDesk never wrote or read it, so the port does not expose it).

SELECT set_config('app.privileged', 'on', true);

-- --- the creator ---------------------------------------------------------------------------------------------------------------

-- The record scope `own` means "owned by me or created by me" (as for tasks), so the creator has to be remembered. SET NULL: a
-- company outlives the person who typed it in.
ALTER TABLE companies
  ADD COLUMN created_by bigint,
  ADD CONSTRAINT fk_companies_created_by FOREIGN KEY (org_id, created_by)
    REFERENCES users (org_id, id) ON DELETE SET NULL (created_by);

-- --- value rules ---------------------------------------------------------------------------------------------------------------

-- WaDesk: name required, max 191; email an address, max 191; phone 32; website 191; industry 100; size range 40; address 500;
-- notes 2000. Rows that predate the rules are repaired first: trimmed, cut to length, a missing name filled from the website or the id.
UPDATE companies SET name = left(btrim(coalesce(nullif(btrim(name), ''), nullif(btrim(domain), ''), 'Company ' || id)), 191)
 WHERE name IS NULL OR name <> btrim(name) OR btrim(name) = '' OR char_length(name) > 191;
UPDATE companies SET domain = left(nullif(btrim(domain), ''), 191) WHERE domain IS NOT NULL AND (domain <> btrim(domain) OR domain = '' OR char_length(domain) > 191);
UPDATE companies SET email = left(email::text, 191)::citext WHERE email IS NOT NULL AND char_length(email::text) > 191;
UPDATE companies SET phone = left(nullif(btrim(phone), ''), 32) WHERE phone IS NOT NULL AND (phone <> btrim(phone) OR phone = '' OR char_length(phone) > 32);
UPDATE companies SET industry = left(nullif(btrim(industry), ''), 100) WHERE industry IS NOT NULL AND (industry <> btrim(industry) OR industry = '' OR char_length(industry) > 100);
UPDATE companies SET size_range = left(nullif(btrim(size_range), ''), 40) WHERE size_range IS NOT NULL AND (size_range <> btrim(size_range) OR size_range = '' OR char_length(size_range) > 40);
UPDATE companies SET address = left(nullif(btrim(address), ''), 500) WHERE address IS NOT NULL AND (address <> btrim(address) OR address = '' OR char_length(address) > 500);
UPDATE companies SET notes = left(nullif(btrim(notes), ''), 2000) WHERE notes IS NOT NULL AND (notes <> btrim(notes) OR notes = '' OR char_length(notes) > 2000);

ALTER TABLE companies
  ALTER COLUMN name SET NOT NULL,
  ADD CONSTRAINT chk_companies_name CHECK (btrim(name) <> '' AND char_length(name) <= 191),
  ADD CONSTRAINT chk_companies_domain CHECK (domain IS NULL OR char_length(domain) <= 191),
  ADD CONSTRAINT chk_companies_email CHECK (email IS NULL OR char_length(email::text) <= 191),
  ADD CONSTRAINT chk_companies_phone CHECK (phone IS NULL OR char_length(phone) <= 32),
  ADD CONSTRAINT chk_companies_industry CHECK (industry IS NULL OR char_length(industry) <= 100),
  ADD CONSTRAINT chk_companies_size_range CHECK (size_range IS NULL OR char_length(size_range) <= 40),
  ADD CONSTRAINT chk_companies_address CHECK (address IS NULL OR char_length(address) <= 500),
  ADD CONSTRAINT chk_companies_notes CHECK (notes IS NULL OR char_length(notes) <= 2000);

-- --- indexes -------------------------------------------------------------------------------------------------------------------

-- The list pages newest first on (created_at, id) and alphabetically on (lower(name), id); the same expressions are in the query so
-- the planner walks these indexes instead of sorting. The owner and creator indexes serve the record scope and the owner filter.
CREATE INDEX idx_companies_org_created ON companies (org_id, created_at DESC, id DESC);
CREATE INDEX idx_companies_org_name ON companies (org_id, (lower(name)), id);
CREATE INDEX idx_companies_owner ON companies (org_id, owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX idx_companies_created_by ON companies (org_id, created_by) WHERE created_by IS NOT NULL;
