import { randomBytes } from 'node:crypto';
import { createDbClientPair, type DbClientPair } from '@crm/db';
import { Redis } from 'ioredis';
import type { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { DatabaseService } from '../../../src/infra/db/database.service';
import { RbacService } from '../../../src/kernel/rbac/rbac.service';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import { PlatformStore } from '../../../src/modules/auth/platform/platform-store';
import { SecurityPolicyService } from '../../../src/modules/auth/platform/security-policy.service';
import { AccountGateService } from '../../../src/modules/auth/security/account-gate.service';
import { EmergencyHaltService } from '../../../src/modules/auth/security/emergency-halt.service';
import { OrgSuspensionService } from '../../../src/modules/auth/security/org-suspension.service';
import { EpochService } from '../../../src/modules/auth/sessions/epoch.service';
import { PartnerAgentStatusService } from '../../../src/modules/auth/sessions/partner-agent-status.service';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { PlanCatalogService } from '../../../src/modules/plans-subscriptions-trials/plan-catalog.service';
import { PlanEntitlementService } from '../../../src/modules/plans-subscriptions-trials/plan-entitlement.service';
import { PlanStore } from '../../../src/modules/plans-subscriptions-trials/plan-store';
import { startTestPg, type TestPg } from '../../support/pg-it';
import { startOwnRedis, type OwnRedis } from '../redis/own-redis';

/**
 * Item #66 test bench: a throwaway migrated Postgres (a database of its own on the dev server, or a container) and a private Redis
 * container (never the shared one), plus any number of "instances". An instance is a full set of the real cache-owning classes with
 * its own connections and its own in-process memory, which is what a second API process is as far as these caches can tell.
 */
export const APP_PW = 'crm_app_dev';

export interface Env {
  pg: TestPg;
  redis: OwnRedis;
  appUrl: string;
  /** Superuser-style Redis client of the test itself (reads keys, plants faults). */
  admin: Redis;
  stop(): Promise<void>;
}

export async function startEnv(): Promise<Env> {
  process.env.TEST_PG_ADMIN_URL ??= 'postgres://crm:crm@127.0.0.1:5432/postgres';
  const pg = await startTestPg();
  const u = new URL(pg.uri);
  u.username = 'crm_app_user';
  u.password = APP_PW;
  const redis = await startOwnRedis(['--save', '', '--appendonly', 'no']);
  const admin = redis.client();
  return {
    pg,
    redis,
    appUrl: u.toString(),
    admin,
    async stop() {
      await redis.stop();
      await pg.stop();
    },
  };
}

const KEY = randomBytes(32).toString('base64');
const config = {
  get: (k: string) => (k === 'CREDENTIALS_ENCRYPTION_KEY' ? KEY : undefined),
} as unknown as ConfigService<never, true>;

export interface Instance {
  name: string;
  redis: Redis;
  db: DatabaseService;
  settings: PlatformSettingsService;
  policy: SecurityPolicyService;
  orgs: OrgSuspensionService;
  gates: AccountGateService;
  partner: PartnerAgentStatusService;
  epoch: EpochService;
  halt: EmergencyHaltService;
  rbac: RbacService;
  prefs: NotificationPrefsResolver;
  planStore: PlanStore;
  entitlements: PlanEntitlementService;
  close(): Promise<void>;
}

/** One instance of the application's cache-owning classes. `redisUrl` lets a test route this instance through a fault proxy. */
export function buildInstance(env: Env, name: string, redisUrl = env.redis.url): Instance {
  const clients: DbClientPair = createDbClientPair({ url: env.appUrl, poolMax: 4 });
  const db = new DatabaseService(clients);
  // Same options the application's RedisModule uses, so a fault shows up the way it does in production.
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    commandTimeout: 2_000,
    retryStrategy: (n: number) => Math.min(n * 50, 500),
  });
  redis.on('error', () => undefined);
  const settings = new PlatformSettingsService(new PlatformStore(db), new CryptoService(config));
  const catalog = new PlanCatalogService(db);
  const planStore = new PlanStore(db);
  const policy = new SecurityPolicyService(settings, catalog);
  const orgs = new OrgSuspensionService(db, redis);
  return {
    name,
    redis,
    db,
    settings,
    policy,
    orgs,
    gates: new AccountGateService(db, policy, redis, orgs),
    partner: new PartnerAgentStatusService(db, redis),
    epoch: new EpochService(redis, settings),
    halt: new EmergencyHaltService(settings, redis),
    rbac: new RbacService(db, redis),
    prefs: new NotificationPrefsResolver(db),
    planStore,
    entitlements: new PlanEntitlementService(db, catalog, planStore),
    async close() {
      redis.disconnect();
      await clients.primary.close?.().catch(() => undefined);
    },
  };
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Polls `read` until it returns `want`; resolves with the seconds it took (measured on a monotonic clock), or rejects after `capS`. */
export async function secondsUntil<T>(
  read: () => Promise<T>,
  want: T,
  capS: number,
  stepMs = 100,
): Promise<number> {
  const t0 = performance.now();
  for (;;) {
    if ((await read()) === want) return (performance.now() - t0) / 1000;
    if ((performance.now() - t0) / 1000 > capS) throw new Error(`still stale after ${capS} s`);
    await sleep(stepMs);
  }
}

export interface Workspace {
  orgId: number;
  userId: number;
  roleId: number;
  agentId: number;
}

/** One workspace with an active user holding one role (no grants yet) and one partner agent. */
export async function seedWorkspace(env: Env, tag = randomBytes(3).toString('hex')): Promise<Workspace> {
  const q = async (sql: string, p: unknown[] = []) => (await env.pg.owner.query(sql, p)).rows[0] as { id: number };
  const org = await q(
    `INSERT INTO organizations (slug, name, plan) VALUES ($1,$2,'starter') RETURNING id`,
    [`ci-${tag}`, `Cache ${tag}`],
  );
  const orgId = Number(org.id);
  const user = await q(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1,$2,'U','x') RETURNING id`,
    [orgId, `u-${tag}@ci.test`],
  );
  const userId = Number(user.id);
  const role = await q(`INSERT INTO roles (org_id, name) VALUES ($1,'Sales') RETURNING id`, [orgId]);
  const roleId = Number(role.id);
  await env.pg.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [orgId, userId, roleId]);
  await env.pg.owner.query(`INSERT INTO user_security (org_id, user_id, email_verified_at) VALUES ($1,$2,now())`, [orgId, userId]);
  const agent = await q(
    `INSERT INTO partner_agents (org_id, code, name, email) VALUES ($1,$2,'A',$3) RETURNING id`,
    [orgId, `c${tag}`, `a-${tag}@ci.test`],
  );
  return { orgId, userId, roleId, agentId: Number(agent.id) };
}
