#!/usr/bin/env tsx
/* eslint-disable no-console -- command-line tool: console is its interface */
import { resolve } from 'node:path';
import { hash } from '@node-rs/argon2';
import { config as loadEnv } from 'dotenv';
import { Client } from 'pg';

loadEnv({ path: resolve(__dirname, '../../../../../../.env') });
loadEnv({ path: resolve(process.cwd(), '.env') });

/**
 * Development seed for the auth domain (run after `pnpm db:seed`).
 *
 * The base seed creates staff users without a password (they used Clerk), so
 * nobody can sign in with email and password. This gives every existing staff
 * user a known dev password and a verified email, adds one non-admin agent to
 * the first organization, and creates a platform operator.
 *
 * The passwords are well known and weak by design: the script refuses to run
 * with NODE_ENV=production.
 */

const DEV_PASSWORD = 'Passw0rd!';
const OPERATOR = { email: 'operator@example.test', name: 'Platform Operator' };

/**
 * Three sample plans for local work, Reference's ladder in miniature: a free
 * Starter (the sign-up default, 14-day trial), a paid Growth (highlighted) and a
 * paid Scale (with an offer price and every feature, `remove_branding` included).
 * Inserted only when the slug is missing, so an operator's edits survive a
 * re-run; the registration default and trial length are set only while the
 * registration policy names no plan yet.
 */
interface SeedPlan {
  slug: string;
  name: string;
  subtitle: string;
  amount: string;
  offer: string | null;
  free: boolean;
  highlighted: boolean;
  sortOrder: number;
  limits: Record<string, number>;
  features: Record<string, boolean>;
}
const FEATURES_OFF = {
  automation: false,
  ai_assistants: false,
  calling: false,
  woocommerce: false,
  shopify: false,
  analytics: false,
  remove_branding: false,
  // Deals, tasks and pipelines: on for every sample plan (Reference's sales pipeline is a base feature); the cap is the lever.
  sales_pipeline: true,
};
const SAMPLE_PLANS: SeedPlan[] = [
  {
    slug: 'starter',
    name: 'Starter',
    subtitle: 'Everything you need to get going',
    amount: '0.00',
    offer: null,
    free: true,
    highlighted: false,
    sortOrder: 0,
    limits: {
      monthly_messages: 1000,
      devices: 1,
      users: 2,
      contacts: 500,
      broadcasts: 5,
      templates: 10,
      flows: 1,
      tags: 20,
      autoreplies: 5,
      pipelines: 2,
      scheduled_messages: 20,
      saved_replies: 10,
      routing_rules: 3,
      installed_apps: 2,
      lead_sources: 1,
      broadcast_recipients: 500,
      segments: 3,
      custom_fields: 5,
      team_chat_channels: 3,
      sla_policies: 1,
      booking_types: 1,
      chatbot_widgets: 1,
      catalog_products: 25,
      invoices_monthly: 10,
      recurring_invoices: 2,
      api_keys: 1,
      webhooks: 1,
      ai_token_limit_monthly: 50000,
    },
    features: FEATURES_OFF,
  },
  {
    slug: 'growth',
    name: 'Growth',
    subtitle: 'For teams that are scaling up',
    amount: '19.00',
    offer: null,
    free: false,
    highlighted: true,
    sortOrder: 10,
    limits: {
      monthly_messages: 10000,
      devices: 3,
      users: 5,
      contacts: 5000,
      broadcasts: 50,
      templates: 50,
      flows: 10,
      tags: 100,
      autoreplies: 50,
      pipelines: 10,
      scheduled_messages: 200,
      saved_replies: 50,
      routing_rules: 10,
      installed_apps: 10,
      lead_sources: 5,
      broadcast_recipients: 5000,
      segments: 20,
      custom_fields: 25,
      team_chat_channels: 15,
      sla_policies: 5,
      booking_types: 5,
      chatbot_widgets: 3,
      catalog_products: 250,
      invoices_monthly: 100,
      recurring_invoices: 20,
      api_keys: 5,
      webhooks: 5,
      ai_token_limit_monthly: 500000,
    },
    features: {
      ...FEATURES_OFF,
      automation: true,
      analytics: true,
      woocommerce: true,
      shopify: true,
    },
  },
  {
    slug: 'scale',
    name: 'Scale',
    subtitle: 'High volume, white-label, nothing held back',
    amount: '49.00',
    offer: '39.00',
    free: false,
    highlighted: false,
    sortOrder: 20,
    limits: {
      monthly_messages: 100000,
      devices: 10,
      users: 25,
      contacts: 0,
      broadcasts: 0,
      templates: 0,
      flows: 0,
      tags: 0,
      autoreplies: 0,
      pipelines: 0,
      scheduled_messages: 0,
      saved_replies: 0,
      routing_rules: 0,
      installed_apps: 0,
      lead_sources: 0,
      broadcast_recipients: 50000,
      segments: 0,
      custom_fields: 0,
      team_chat_channels: 0,
      sla_policies: 0,
      booking_types: 0,
      chatbot_widgets: 0,
      catalog_products: 0,
      invoices_monthly: 0,
      recurring_invoices: 0,
      api_keys: 20,
      webhooks: 25,
      ai_token_limit_monthly: 5000000,
    },
    features: {
      automation: true,
      ai_assistants: true,
      calling: true,
      woocommerce: true,
      shopify: true,
      analytics: true,
      remove_branding: true,
      sales_pipeline: true,
    },
  },
];

async function seedPlans(client: Client): Promise<number> {
  let created = 0;
  for (const p of SAMPLE_PLANS) {
    const res = await client.query(
      `INSERT INTO plans (slug, name, subtitle, amount, offer_amount, currency, is_free, is_highlighted,
                          is_default, sort_order, limits, features)
       VALUES ($1, $2, $3, $4::numeric, $5::numeric, 'USD', $6, $7,
               $6 AND NOT EXISTS (SELECT 1 FROM plans WHERE is_default), $8, $9::jsonb, $10::jsonb)
       ON CONFLICT (slug) DO NOTHING`,
      [
        p.slug,
        p.name,
        p.subtitle,
        p.amount,
        p.offer,
        p.free,
        p.highlighted,
        p.sortOrder,
        JSON.stringify(p.limits),
        JSON.stringify(p.features),
      ],
    );
    created += res.rowCount ?? 0;
  }
  await client.query(
    `INSERT INTO platform_settings (key, value, is_secret)
     VALUES ('registration', $1::jsonb, false)
     ON CONFLICT (key) DO UPDATE
       SET value = platform_settings.value || $1::jsonb, updated_at = now()
       WHERE platform_settings.value ->> 'defaultPlanId' IS NULL`,
    [JSON.stringify({ defaultPlanId: 'starter', trialDays: 14 })],
  );
  return created;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('refusing to seed with NODE_ENV=production');
    process.exit(1);
  }
  const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('Neither MIGRATION_DATABASE_URL nor DATABASE_URL is set.');
    process.exit(1);
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  const passwordHash = await hash(DEV_PASSWORD);

  try {
    await client.query(`SELECT set_config('app.privileged', 'on', false)`);
    await client.query('BEGIN');

    const users = await client.query<{ org_id: number; id: number; email: string; slug: string }>(
      `
      UPDATE users u SET password_hash = COALESCE(u.password_hash, $1)
      FROM organizations o WHERE o.id = u.org_id
      RETURNING u.org_id, u.id, u.email, o.slug
    `,
      [passwordHash],
    );
    for (const u of users.rows) {
      await client.query(
        `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (org_id, user_id) DO UPDATE
           SET email_verified_at = COALESCE(user_security.email_verified_at, now())`,
        [u.org_id, u.id],
      );
    }

    // One non-admin agent in the first organization, for role-aware landing demos.
    const first = await client.query<{ id: number; slug: string }>(
      `SELECT id, slug FROM organizations ORDER BY id LIMIT 1`,
    );
    if (first.rows[0]) {
      const org = first.rows[0];
      const agent = await client.query<{ id: number }>(
        `INSERT INTO users (org_id, email, full_name, password_hash)
         VALUES ($1, $2, 'Demo Agent', $3)
         ON CONFLICT (org_id, email) DO UPDATE SET password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash)
         RETURNING id`,
        [org.id, `agent@${org.slug.toLowerCase()}.test`, passwordHash],
      );
      const agentRole = await client.query<{ id: number }>(
        `SELECT id FROM roles WHERE org_id = $1 AND name IN ('Agent','Counsellor') ORDER BY name LIMIT 1`,
        [org.id],
      );
      if (agentRole.rows[0]) {
        await client.query(
          `INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
          [org.id, agent.rows[0]!.id, agentRole.rows[0].id],
        );
      }
      await client.query(
        `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at)
         VALUES ($1, $2, now(), now())
         ON CONFLICT (org_id, user_id) DO UPDATE SET email_verified_at = COALESCE(user_security.email_verified_at, now())`,
        [org.id, agent.rows[0]!.id],
      );
      console.log(
        `agent:    org "${org.slug}"  agent@${org.slug.toLowerCase()}.test / ${DEV_PASSWORD}`,
      );
    }

    await client.query(
      `INSERT INTO platform_operators (email, full_name, password_hash, role, password_changed_at)
       VALUES ($1, $2, $3, 'super_admin', now())
       ON CONFLICT (email) DO NOTHING`,
      [OPERATOR.email, OPERATOR.name, passwordHash],
    );

    const plansCreated = await seedPlans(client);

    await client.query('COMMIT');
    console.log(
      `plans:    starter (free, 14-day trial, sign-up default), growth, scale  (${plansCreated} created)`,
    );
    for (const u of users.rows)
      console.log(`staff:    org "${u.slug}"  ${u.email} / ${DEV_PASSWORD}`);
    console.log(
      `operator: ${OPERATOR.email} / ${DEV_PASSWORD}  (super_admin; must enrol MFA at first sign-in)`,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
