-- Two extra identities for the VAPT run (after `pnpm db:seed` and `pnpm --filter @crm/api seed:auth`, which give the tenant A and B
-- admins and agent@admin.test the password Passw0rd!). A viewer in each tenant clones the agent's password hash.
INSERT INTO users (org_id, email, full_name, password_hash, status, joined_at)
  SELECT org_id, 'viewer@admin.test', 'VAPT Viewer', password_hash, 'active', now() FROM users WHERE email = 'agent@admin.test'
  ON CONFLICT DO NOTHING;
INSERT INTO users (org_id, email, full_name, password_hash, status, joined_at)
  SELECT 2, 'viewer@ten.test', 'VAPT Viewer B', password_hash, 'active', now() FROM users WHERE email = 'agent@admin.test'
  ON CONFLICT DO NOTHING;
INSERT INTO user_roles (org_id, user_id, role_id)
  SELECT u.org_id, u.id, r.id FROM users u JOIN roles r ON r.org_id = u.org_id AND r.name = 'Viewer' WHERE u.email LIKE 'viewer@%'
  ON CONFLICT DO NOTHING;
