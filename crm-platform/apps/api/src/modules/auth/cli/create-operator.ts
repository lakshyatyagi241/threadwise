#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import { hash } from '@node-rs/argon2';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';
import { evaluatePassword } from '../support/password-policy';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Creates (or resets the password of) a platform operator. This is how the
 * first super admin exists in an environment: there is no public sign-up for
 * operators.
 *
 *   OPERATOR_PASSWORD='...' pnpm --filter @crm/api operator:create -- \
 *     --email ops@example.com --name "Ops Lead" [--role super_admin|support|auditor]
 *
 * The password comes from the environment, never from an argument, so it does
 * not land in shell history or a process listing.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const email = arg('email')?.toLowerCase();
  const name = arg('name');
  const role = (arg('role') ?? 'super_admin') as 'super_admin' | 'support' | 'auditor';
  const password = process.env.OPERATOR_PASSWORD;

  if (!email || !name || !password) {
    console.error(
      'usage: OPERATOR_PASSWORD=... operator:create --email <email> --name <name> [--role super_admin|support|auditor]',
    );
    process.exit(1);
  }
  if (!['super_admin', 'support', 'auditor'].includes(role)) {
    console.error(`unknown role ${role}`);
    process.exit(1);
  }
  // Operators are the highest-trust accounts: always the strict rules, whatever the tenant policy says.
  const problems = evaluatePassword(
    password,
    {
      passwordMinLength: 12,
      passwordRequireUpper: true,
      passwordRequireNumber: true,
      passwordRequireSymbol: true,
    },
    { email, fullName: name },
  );
  if (problems.length > 0) {
    console.error(`password rejected: ${problems.map((p) => p.message).join(' ')}`);
    process.exit(1);
  }

  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    const res = await client.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role, password_changed_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash, full_name = EXCLUDED.full_name, role = EXCLUDED.role,
             status = 'active', password_changed_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [email, name, await hash(password), role],
    );
    console.log(`${res.rows[0]?.inserted ? 'created' : 'updated'} operator ${email} (${role})`);
    if (role === 'super_admin')
      console.log('They must enrol two-factor authentication at first sign-in.');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
