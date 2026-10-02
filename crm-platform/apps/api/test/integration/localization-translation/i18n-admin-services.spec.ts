import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@crm/contracts';
import { createDbClient, runMigrations, withPrivileged, withTenant, type DbClient } from '@crm/db';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { RequestContextStore } from '../../../src/common/context/request-context';
import type { DatabaseService } from '../../../src/infra/db/database.service';
import {
  AuthAuditService,
  PlatformSettingsService,
  type PlatformStore,
} from '../../../src/modules/auth';
import { AuditService } from '../../../src/kernel/audit/audit.service';
import { OutboxService } from '../../../src/kernel/outbox/outbox.service';
import type {
  Entitlements,
  PlanEntitlementService,
} from '../../../src/modules/plans-subscriptions-trials';
import { TranslationSettingsService } from '../../../src/modules/localization-translation/translation-settings.service';
import { TranslationUsageService } from '../../../src/modules/localization-translation/translation-usage.service';
import { LanguagesService } from '../../../src/modules/localization-translation/languages.service';
import { ProviderCredentials } from '../../../src/modules/localization-translation/provider-credentials';
import { ProviderRouterService } from '../../../src/modules/localization-translation/provider-router.service';
import { ProvidersAdminService } from '../../../src/modules/localization-translation/providers-admin.service';

/**
 * The operator-side services against a real Postgres as the restricted application role: the language registry
 * rules (WD-I18N-003, 004, 005) and the provider catalogue rules (WD-I18N-016, 017, 018). Mocks cannot show that the
 * row lock, the audit row and the single-default index all behave inside one transaction.
 */
describe('i18n operator services (language registry and provider catalogue)', () => {
  const MIGRATIONS = resolve(__dirname, '../../../../../packages/db/migrations');
  const KEY = Buffer.alloc(32, 7).toString('base64');

  let container: StartedPostgreSqlContainer;
  let owner: Client;
  let dbClient: DbClient;
  let languages: LanguagesService;
  let providers: ProvidersAdminService;
  let settings: PlatformSettingsService;
  let workspace: TranslationSettingsService;
  let planFeatures: Record<string, unknown> = {};
  let orgId: number;

  const asOperator = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      {
        requestId: 'req-i18n',
        orgId: 0,
        actorType: 'platform_operator',
        actorId: 1,
        userId: null,
        operatorRole: 'super_admin',
      },
      fn,
    );

  const events = async (event: string) =>
    Number(
      (
        await owner.query(`SELECT count(*)::int AS n FROM security_events WHERE event = $1`, [
          event,
        ])
      ).rows[0].n,
    );

  const lang = async (code: string) => (await languages.list()).data.find((l) => l.code === code)!;
  const provider = async (slug: string) =>
    (await providers.list()).data.find((p) => p.slug === slug)!;
  const rejects = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { code?: string }) => e.code ?? 'no-code',
    );

  beforeAll(async () => {
    Logger.overrideLogger(false);
    container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('crm')
      .withUsername('crm')
      .withPassword('crm')
      .start();
    owner = new Client({ connectionString: container.getConnectionUri() });
    await owner.connect();
    await owner.query(
      `CREATE ROLE crm_app_user LOGIN PASSWORD 'test' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await runMigrations(container.getConnectionUri(), { dir: MIGRATIONS, log: () => undefined });

    dbClient = createDbClient({
      url: `postgres://crm_app_user:test@${container.getHost()}:${container.getPort()}/crm`,
      poolMax: 4,
    });
    const db = {
      primary: dbClient.db,
      tx: <T>(fn: Parameters<typeof withTenant<T>>[2]) => {
        const c = RequestContextStore.require();
        return withTenant(dbClient.db, { orgId: c.orgId, userId: c.userId }, fn);
      },
      txAs: (
        tenant: Parameters<DatabaseService['txAs']>[0],
        fn: Parameters<DatabaseService['txAs']>[1],
      ) => withTenant(dbClient.db, tenant, fn),
    } as unknown as DatabaseService;
    const store = {
      tx: (fn: Parameters<PlatformStore['tx']>[0]) => withPrivileged(dbClient.db, fn),
    } as unknown as PlatformStore;
    const crypto = new CryptoService({
      get: () => KEY,
    } as unknown as ConfigService<never, true>);
    const audit = new AuthAuditService(db);
    settings = new PlatformSettingsService(store, crypto);
    const credentials = new ProviderCredentials(crypto);
    const router = new ProviderRouterService(store, db, settings, credentials, {} as never);
    const redis = { get: async () => null, set: async () => 'OK', del: async () => 1 };
    languages = new LanguagesService(store, db, audit, settings, redis as never);
    providers = new ProvidersAdminService(store, audit, settings, credentials, router);
    orgId = Number(
      (
        await owner.query(
          `INSERT INTO organizations (slug, name) VALUES ('i18n-ws', 'WS') RETURNING id`,
        )
      ).rows[0].id,
    );
    const plans = {
      forOrg: async () =>
        ({ platformOwned: false, planKnown: true, overrides: {}, planFeatures }) as Entitlements,
    } as unknown as PlanEntitlementService;
    workspace = new TranslationSettingsService(
      db,
      plans,
      new TranslationUsageService(db, store),
      router,
      new AuditService(),
      new OutboxService(),
    );
  }, 180_000);

  afterAll(async () => {
    await dbClient?.close();
    await owner?.end();
    await container?.stop();
  });

  describe('languages', () => {
    it('refuses to delete or switch off the platform default and leaves the row (WD-I18N-005, 003)', () =>
      asOperator(async () => {
        const en = await lang('en');
        expect(await rejects(languages.remove(en.id, en.rowVersion))).toBe(
          ERROR_CODES.I18N_LANGUAGE_IS_DEFAULT,
        );
        expect(await rejects(languages.toggle(en.id, en.rowVersion))).toBe(
          ERROR_CODES.I18N_LANGUAGE_IS_DEFAULT,
        );
        expect((await lang('en')).isActive).toBe(true);
      }));

    it('deletes a non-default language, audits it, and refuses a stale version (WD-I18N-005)', () =>
      asOperator(async () => {
        const fr = await lang('fr');
        expect(await rejects(languages.remove(fr.id, fr.rowVersion + 5))).toBe(
          ERROR_CODES.ROW_VERSION_CONFLICT,
        );
        await languages.remove(fr.id, fr.rowVersion);
        expect((await languages.list()).data.some((l) => l.code === 'fr')).toBe(false);
        expect(await events('platform.i18n.language_deleted')).toBe(1);
      }));

    it('switches a language off and on, and only an active one can become the default (WD-I18N-003, 004)', () =>
      asOperator(async () => {
        const de = await lang('de');
        const off = await languages.toggle(de.id, de.rowVersion);
        expect(off.isActive).toBe(false);
        expect(await rejects(languages.setDefault(off.id, off.rowVersion))).toBe(
          ERROR_CODES.I18N_LANGUAGE_INACTIVE,
        );
        const on = await languages.toggle(off.id, off.rowVersion);
        expect(on.isActive).toBe(true);

        const made = await languages.setDefault(on.id, on.rowVersion);
        expect(made.isDefault).toBe(true);
        expect((await languages.list()).stats.defaultCode).toBe('de');
        expect(await events('platform.i18n.language_default_changed')).toBe(1);
        // the previous default is now an ordinary language and may be switched off
        const en = await lang('en');
        expect(en.isDefault).toBe(false);
        expect((await languages.toggle(en.id, en.rowVersion)).isActive).toBe(false);
      }));
  });

  describe('providers', () => {
    it('refuses to activate DeepL without its key, records the refusal, and activates with the key (WD-I18N-016)', () =>
      asOperator(async () => {
        const deepl = await provider('deepl');
        expect(deepl.isActive).toBe(false);
        expect(await rejects(providers.toggle(deepl.id, deepl.rowVersion))).toBe(
          ERROR_CODES.I18N_PROVIDER_CREDENTIALS_MISSING,
        );
        expect((await provider('deepl')).isActive).toBe(false);
        expect(await events('platform.i18n.translation_provider_toggle_blocked')).toBe(1);

        const saved = await providers.update(deepl.id, {
          rowVersion: deepl.rowVersion,
          credentials: { api_key: 'secret-key-123' },
        });
        // a secret is never echoed back, only the fact that it is set
        const field = saved.credentialFields.find((f) => f.key === 'api_key')!;
        expect(field.value).toBeNull();
        expect(field.hasValue).toBe(true);
        expect(JSON.stringify(saved)).not.toContain('secret-key-123');
        const stored = await owner.query(
          `SELECT credentials FROM translation_providers WHERE slug = 'deepl'`,
        );
        expect(stored.rows[0].credentials).not.toContain('secret-key-123');

        const on = await providers.toggle(saved.id, saved.rowVersion);
        expect(on.isActive).toBe(true);
        expect(await events('platform.i18n.translation_provider_activated')).toBe(1);
        const off = await providers.toggle(on.id, on.rowVersion);
        expect(off.isActive).toBe(false);
        expect(await events('platform.i18n.translation_provider_deactivated')).toBe(1);
      }));

    it('keeps exactly one default and refuses an inactive one (WD-I18N-017)', () =>
      asOperator(async () => {
        const libre = await provider('libretranslate');
        expect(await rejects(providers.setDefault(libre.id, libre.rowVersion))).toBe(
          ERROR_CODES.I18N_PROVIDER_INACTIVE,
        );
        const google = await provider('google_gtx');
        const made = await providers.setDefault(google.id, google.rowVersion);
        expect(made.isDefault).toBe(true);
        const defaults = (await providers.list()).data.filter((p) => p.isDefault);
        expect(defaults.map((p) => p.slug)).toEqual(['google_gtx']);
      }));

    it('only enables the lockdown when an official provider is usable, and keeps the last one on (WD-I18N-018)', () =>
      asOperator(async () => {
        expect(await rejects(providers.setLockdown(true))).toBe(
          ERROR_CODES.I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER,
        );

        let deepl = await provider('deepl');
        deepl = await providers.update(deepl.id, {
          rowVersion: deepl.rowVersion,
          credentials: { api_key: 'k' },
        });
        deepl = await providers.toggle(deepl.id, deepl.rowVersion);
        expect(deepl.isActive).toBe(true);

        const list = await providers.setLockdown(true);
        expect(list.lockdown.enabled).toBe(true);
        expect(list.data.find((p) => p.slug === 'mymemory')!.skippedByLockdown).toBe(true);
        expect(await events('platform.i18n.translation_lockdown_enabled')).toBe(1);

        expect(await rejects(providers.toggle(deepl.id, deepl.rowVersion))).toBe(
          ERROR_CODES.I18N_LOCKDOWN_NO_OFFICIAL_PROVIDER,
        );
        expect((await providers.setLockdown(false)).lockdown.enabled).toBe(false);
        expect((await providers.toggle(deepl.id, deepl.rowVersion)).isActive).toBe(false);
      }));

    it('refuses to strip a required credential from an active provider (WD-I18N-015)', () =>
      asOperator(async () => {
        let deepl = await provider('deepl');
        deepl = await providers.update(deepl.id, {
          rowVersion: deepl.rowVersion,
          credentials: { api_key: 'k2' },
        });
        deepl = await providers.toggle(deepl.id, deepl.rowVersion);
        expect(
          await rejects(
            providers.update(deepl.id, { rowVersion: deepl.rowVersion, clear: ['api_key'] }),
          ),
        ).toBe(ERROR_CODES.I18N_PROVIDER_CREDENTIALS_MISSING);
      }));
  });

  describe('workspace translation settings (WD-I18N-035)', () => {
    const asWorkspace = <T>(fn: () => Promise<T>) =>
      RequestContextStore.run(
        { requestId: 'req-ws', orgId, actorType: 'user', actorId: null, userId: null },
        fn,
      );

    it('refuses a change on a plan without translation, and writes nothing', () =>
      asWorkspace(async () => {
        planFeatures = {};
        const before = await workspace.get();
        expect(before.planAllows).toBe(false);
        expect(before.engineName).toBeNull();
        expect(
          await rejects(workspace.update({ rowVersion: before.rowVersion, enabled: false })),
        ).toBe(ERROR_CODES.PLAN_FEATURE_LOCKED);
        const rows = await owner.query(`SELECT 1 FROM workspace_settings WHERE org_id = $1`, [
          orgId,
        ]);
        expect(rows.rowCount).toBe(0);
      }));

    it('saves the settings with the audit row and the outbox event in the same commit, and guards the version', () =>
      asWorkspace(async () => {
        planFeatures = { translation: true };
        const before = await workspace.get();
        expect(before).toMatchObject({ planAllows: true, enabled: true, teamLanguage: 'en' });
        // the providers block above made Google (free) the default
        expect(before.engineName).toBe('Google (free)');

        const after = await workspace.update({
          rowVersion: before.rowVersion,
          teamLanguage: 'es',
          enabled: false,
        });
        expect(after).toMatchObject({ enabled: false, teamLanguage: 'es' });

        const audit = await owner.query(
          `SELECT action, delta FROM audit_log WHERE org_id = $1 AND module = 'translation_settings'`,
          [orgId],
        );
        expect(audit.rows).toHaveLength(1);
        expect(audit.rows[0].delta.teamLanguage).toEqual({ old: 'en', new: 'es' });
        const outbox = await owner.query(
          `SELECT event_type FROM event_outbox WHERE org_id = $1 AND aggregate_module = 'translation_settings'`,
          [orgId],
        );
        expect(outbox.rows.map((r) => r.event_type)).toEqual(['translation_settings.updated']);

        // the same stale version again loses
        expect(
          await rejects(workspace.update({ rowVersion: before.rowVersion, enabled: true })),
        ).toBe(ERROR_CODES.ROW_VERSION_CONFLICT);
        expect((await workspace.get()).enabled).toBe(false);
      }));
  });
});
