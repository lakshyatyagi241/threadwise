-- QA #53: many staff users in the benchmark organisation, so a load test can hold many separate sessions (one user may hold only a few sessions at a time:
-- the oldest is signed out when a sixth sign-in arrives). Each new user is a copy of the first user of the organisation: same password, same role, so
-- everyone signs in with the password the benchmark already uses.
--   psql "$MIGRATION_DATABASE_URL" -v org=perf-org -v users=1000 -f tools/perf/seed-users.sql
-- Runs as the database owner, on a throwaway database only. Names: loaduser<N>@perf.example.test.
\set ON_ERROR_STOP on
\if :{?org} \else \set org perf-org \endif
\if :{?users} \else \set users 1000 \endif
SELECT id AS org_id FROM organizations WHERE slug = :'org' \gset
SELECT min(id) AS src FROM users WHERE org_id = :org_id \gset

INSERT INTO users (org_id, email, full_name, password_hash, status, joined_at)
SELECT :org_id, 'loaduser' || g || '@perf.example.test', 'Load User ' || g, u.password_hash, 'active', now()
FROM generate_series(1, :users) g, users u
WHERE u.org_id = :org_id AND u.id = :src
ON CONFLICT (org_id, email) DO NOTHING;

INSERT INTO user_profiles (org_id, user_id, display_name, phone_e164, phone_verified_at, locale, theme, timezone, chat_limit)
SELECT n.org_id, n.id, p.display_name, NULL, NULL, p.locale, p.theme, p.timezone, p.chat_limit
FROM users n JOIN user_profiles p ON p.org_id = n.org_id AND p.user_id = :src
WHERE n.org_id = :org_id AND n.email LIKE 'loaduser%@perf.example.test'
ON CONFLICT DO NOTHING;

INSERT INTO user_roles (org_id, user_id, role_id)
SELECT n.org_id, n.id, r.role_id
FROM users n JOIN user_roles r ON r.org_id = n.org_id AND r.user_id = :src
WHERE n.org_id = :org_id AND n.email LIKE 'loaduser%@perf.example.test'
ON CONFLICT DO NOTHING;

INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at, force_password_change, mfa_enabled)
SELECT n.org_id, n.id, s.email_verified_at, s.password_changed_at, false, false
FROM users n JOIN user_security s ON s.org_id = n.org_id AND s.user_id = :src
WHERE n.org_id = :org_id AND n.email LIKE 'loaduser%@perf.example.test'
ON CONFLICT DO NOTHING;

SELECT count(*) AS load_users FROM users WHERE org_id = :org_id AND email LIKE 'loaduser%@perf.example.test';
