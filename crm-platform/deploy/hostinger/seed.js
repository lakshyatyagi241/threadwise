// Generic first-run seed, run inside the API container (it uses that image's pg and argon2):
//   docker compose --env-file .env run --rm -T -v ./seed.js:/app/seed.js:ro -e WORKSPACE_PASSWORD=... api node /app/seed.js
// Creates one workspace ("Demo Workspace") with the five preset roles and one account per role. Re-runnable: it resets the
// demo accounts' password and never touches other data. No personal names or real addresses: role-named accounts only.
const { hash } = require('@node-rs/argon2');
const { Client } = require('pg');

const SLUG = process.env.WORKSPACE_SLUG || 'demo';
const NAME = process.env.WORKSPACE_NAME || 'Demo Workspace';
const DOMAIN = process.env.WORKSPACE_EMAIL_DOMAIN || 'demo.desk.wabo.ai';
const password = process.env.WORKSPACE_PASSWORD;

// Preset system_key -> account. (The Owner preset's internal key is `admin`, the Admin preset's is `workspace_admin`.)
const ACCOUNTS = {
  admin: { local: 'owner', label: 'Owner' },
  workspace_admin: { local: 'admin', label: 'Admin' },
  manager: { local: 'manager', label: 'Manager' },
  agent: { local: 'agent', label: 'Agent' },
  viewer: { local: 'viewer', label: 'Viewer' },
};

(async () => {
  if (!password || password.length < 12) throw new Error('WORKSPACE_PASSWORD (12+ characters) is required');
  const url = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('BEGIN');
    const passwordHash = await hash(password);
    const org = await c.query(
      `INSERT INTO organizations (slug, name, plan, tier) VALUES ($1, $2, 'growth', 'standard')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [SLUG, NAME],
    );
    const orgId = org.rows[0].id;
    await c.query('SELECT provision_workspace_presets($1)', [orgId]);
    const roles = await c.query('SELECT id, system_key FROM roles WHERE org_id = $1', [orgId]);
    for (const r of roles.rows) {
      const a = ACCOUNTS[r.system_key];
      if (!a) continue;
      const email = `${a.local}@${DOMAIN}`;
      const u = await c.query(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, email) DO UPDATE SET password_hash = EXCLUDED.password_hash RETURNING id`,
        [orgId, email, `Demo ${a.label}`, passwordHash],
      );
      await c.query(
        `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, u.rows[0].id, r.id],
      );
      console.log(`${a.label.padEnd(8)} ${email}`);
    }
    await c.query('COMMIT');
    console.log(`workspace "${SLUG}" ready`);
  } catch (e) {
    await c.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
