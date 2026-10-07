-- forms: the company match of a public form looks a company up by its website (docs/specs/forms-builder-app.md 9.3).
-- Why this migration exists: the match runs on every submission that carries a company, from an anonymous request, so it must not scan
-- the workspace's companies. The query compares lower(domain) with the common spellings of the host, which this index serves.
CREATE INDEX idx_companies_domain ON companies (org_id, lower(domain)) WHERE domain IS NOT NULL;
