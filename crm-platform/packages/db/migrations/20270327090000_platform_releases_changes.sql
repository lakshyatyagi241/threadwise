-- What each product release carries: the build server writes the pull requests (number, title, author) that went into the release, so the
-- operator console's release history can say what was deployed. A nullable column: expand-only, it does not touch the live slot, and
-- releases recorded before it simply have none.
ALTER TABLE platform_releases ADD COLUMN IF NOT EXISTS changes jsonb CHECK (changes IS NULL OR jsonb_typeof(changes) = 'array');
