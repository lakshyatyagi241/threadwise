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
export function buildInstance(env: { appUrl: string; redis: { url: string } }, name: string, redisUrl = env.redis.url): Instance {
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

