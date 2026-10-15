// Adds the shared demo owner account (owner@demo.desk.wabo.ai) to more workspaces, as an Owner. Run inside the API container:
//   docker compose --env-file .env run --rm -T -v ./add-demo-owner.js:/app/add-demo-owner.js:ro api node /app/add-demo-owner.js rhythm-watches iskm
// The account is one `users` row per workspace (that is how one email opens several workspaces). The new rows copy the password
// hash and name of the demo owner that already exists, so the same password signs in everywhere. Re-runnable; changes nothing else.
const { Client } = require('pg');

const EMAIL = process.env.DEMO_OWNER_EMAIL || 'owner@demo.desk.wabo.ai';
const slugs = process.argv.slice(2);

(async () => {
  if (slugs.length === 0) throw new Error('usage: node add-demo-owner.js <workspace-slug> [...]');
  const c = new Client({ connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query('BEGIN');
    const src = await c.query(
      `SELECT full_name, password_hash FROM users WHERE email = $1 AND password_hash IS NOT NULL ORDER BY created_at LIMIT 1`,
      [EMAIL],
    );
    if (!src.rows[0]) throw new Error(`no existing ${EMAIL} account to copy the password from`);
    const { full_name: fullName, password_hash: passwordHash } = src.rows[0];

    for (const slug of slugs) {
      const org = await c.query('SELECT id FROM organizations WHERE slug = $1', [slug]);
      if (!org.rows[0]) throw new Error(`workspace "${slug}" not found`);
      const orgId = org.rows[0].id;
      // The Owner preset's internal key is `admin` (see seed.js).
      const role = await c.query(`SELECT id FROM roles WHERE org_id = $1 AND system_key = 'admin'`, [orgId]);
      if (!role.rows[0]) throw new Error(`workspace "${slug}" has no Owner role`);
      const u = await c.query(
        `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, $3, $4)
         ON CONFLICT (org_id, email) DO UPDATE SET status = 'active' RETURNING id`,
        [orgId, EMAIL, fullName, passwordHash],
      );
      await c.query(
        `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [orgId, u.rows[0].id, role.rows[0].id],
      );
      console.log(`${EMAIL} -> ${slug} (Owner)`);
    }
    await c.query('COMMIT');
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
