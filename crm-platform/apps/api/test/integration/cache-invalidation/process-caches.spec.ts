import { Logger } from '@nestjs/common';
import { CONSENT_SETTINGS_DEFAULTS } from '@crm/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CpnStore } from '../../../src/modules/coupons-credits-referral-currency/cpn-store';
import { CurrencyAdminService } from '../../../src/modules/coupons-credits-referral-currency/currency-admin.service';
import { ConsentRepository } from '../../../src/modules/contact-consent/consent.repository';
import { ConsentSettingsService } from '../../../src/modules/contact-consent/consent-settings.service';
import { PlatformStore } from '../../../src/modules/auth/platform/platform-store';
import { BookingPageThemesCache } from '../../../src/modules/appointments-booking/booking-page-themes.cache';
import { MemberDirectory } from '../../../src/realtime/audience/member-directory.service';
import { CurrencyService } from '../../../src/modules/platform-settings-branding-storage/currency.service';
import { PlatformRatesService } from '../../../src/modules/wallet-message-billing/platform-rates.service';
import { MetaRateCardService } from '../../../src/modules/wallet-message-billing/meta-rate-card.service';
import { WebhookTargetsRepository } from '../../../src/modules/webhook-fanout/webhook-targets.repository';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { buildInstance, secondsUntil, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * The in-process and small Redis caches of the register (item #66, P0 and P1): price cards, currency table, consent settings, realtime
 * audience, webhook targets, booking page theme. The READER is the real class; the writer is the real service where its constructor is
 * affordable, else the same SQL the writer runs. "Another process" here is a second instance of the class in this process: an in-process
 * cache cannot tell the difference (the two-OS-process proof is in platform-state, access-control and races specs).
 */
Logger.overrideLogger(false);
const stub = (o: object) => o as never;

describe('process caches follow their source of truth', () => {
  let env: Env;
  let a: Instance;
  let n = 0;
  const asOperator = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run(
      { requestId: 'op', orgId: 0, actorType: 'platform_operator', actorId: 1, userId: null },
      fn,
    );

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
  }, 240_000);
  afterAll(async () => {
    await a?.close();
    await env?.stop();
  });

  describe('M18 Meta rate cards (30 s)', () => {
    const card = (cost: number) =>
      ({
        currency: 'USD',
        effectiveOn: '2026-10-01',
        problems: [],
        rows: [{ market: 'India', category: 'marketing', costMicros: cost }],
      }) as never;

    it('an operator imports a new card (PlatformRatesService.importMetaCard): a lookup that ran before the commit must not keep the old price for 30 s (defect D7)', async () => {
      const store = new PlatformStore(a.db);
      const cards = new MetaRateCardService(store, stub({}));
      let incoming = card(10_000);
      cards.parse = () => incoming; // the xlsx parser is not what is under test
      let reached!: () => void;
      const inside = new Promise<void>((ok) => (reached = ok));
      let resume!: () => void;
      const gate = new Promise<void>((ok) => (resume = ok));
      let hold = false;
      const log = stub({
        platform: async () => {
          if (!hold) return;
          reached(); // the card is replaced and invalidated, the transaction is still open
          await gate;
        },
      });
      const imports = new PlatformRatesService(
        store,
        stub({}),
        stub({}),
        stub({ currency: async () => 'EUR' }),
        stub({}),
        log,
        cards,
      );
      const read = () => store.tx(async (tx) => (await cards.lookup(tx, 'USD'))('IN', 'marketing'));
      await imports.importMetaCard(
        { file: '', dryRun: false, fileName: 'old.xlsx' } as never,
        { id: 1, label: 'op' } as never,
      );
      expect(await read()).toBe(10_000);
      incoming = card(20_000);
      hold = true;
      const importing = imports.importMetaCard(
        { file: '', dryRun: false, fileName: 'new.xlsx' } as never,
        { id: 1, label: 'op' } as never,
      );
      await inside;
      expect(await read()).toBe(10_000); // a request in the middle of the import re-caches the committed (old) row
      resume();
      await importing;
      expect(await read()).toBe(20_000); // the commit is done: the next lookup must see it
    });
  });

  describe('M19 currency table (60 s)', () => {
    it('a currency edited by an operator (CurrencyAdminService.update) is converted at the new rate at once on this instance; another instance within 60 s', async () => {
      const store = new PlatformStore(a.db);
      const settings = stub({ values: async () => ({ defaultCurrency: 'USD' }) });
      const display = new CurrencyService(store, settings);
      const other = new CurrencyService(store, settings);
      const admin = new CurrencyAdminService(
        new CpnStore(store),
        stub({ record: async () => undefined, recordStandalone: async () => undefined }),
        settings,
        display,
        stub({ name: 'test' }),
      );
      const row = (
        await env.pg.owner.query(
          `SELECT uuid, code, row_version FROM currencies WHERE code <> 'USD' AND is_active ORDER BY code LIMIT 1`,
        )
      ).rows[0];
      expect(row).toBeDefined();
      const before = await display.convert('100', 'USD', row.code);
      expect(await other.convert('100', 'USD', row.code)).toBe(before);
      await asOperator(() =>
        admin.update(row.uuid, {
          exchangeRate: '777',
          rowVersion: Number(row.row_version),
        } as never),
      );
      expect(await display.convert('100', 'USD', row.code)).not.toBe(before);
      const s = await secondsUntil(
        async () => (await other.convert('100', 'USD', row.code)) !== before,
        true,
        70,
        500,
      );
      expect(s).toBeLessThanOrEqual(60.5);
      record('M19 currency table, other instance', {
        measuredStaleSeconds: s,
        documentedSeconds: 60,
      });
    }, 90_000);
  });

  describe('M08 consent settings (60 s)', () => {
    it('saved by staff (ConsentSettingsService.update): this instance is fresh at once; another instance within 60 s', async () => {
      const tag = `${Date.now().toString(36)}${n++}`;
      const orgId = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id`,
            [`cs-${tag}`],
          )
        ).rows[0].id,
      );
      const userId = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO users (org_id,email,full_name) VALUES ($1,$2,'U') RETURNING id`,
            [orgId, `u-${tag}@x.test`],
          )
        ).rows[0].id,
      );
      const mk = () =>
        new ConsentSettingsService(
          a.db,
          new ConsentRepository(),
          stub({ record: async () => undefined }),
          stub({ emit: async () => undefined }),
        );
      const svc = mk();
      const other = mk();
      const before = (await svc.effective(orgId)).footerText;
      expect((await other.effective(orgId)).footerText).toBe(before);
      await RequestContextStore.run(
        { requestId: 'c', orgId, actorType: 'user', actorId: userId, userId },
        () =>
          svc.update({
            ...CONSENT_SETTINGS_DEFAULTS,
            footerText: { en: 'new footer text' },
          } as never),
      );
      expect((await svc.effective(orgId)).footerText.en).toBe('new footer text');
      const s = await secondsUntil(
        async () => (await other.effective(orgId)).footerText.en,
        'new footer text',
        70,
        500,
      );
      expect(s).toBeLessThanOrEqual(60.5);
      record('M08 consent settings, other instance', {
        measuredStaleSeconds: s,
        documentedSeconds: 60,
      });
    }, 90_000);
  });

  describe('M01 realtime audience (30 s)', () => {
    it('a role removed from a member: the audience list drops them within 30 s (measured); invalidate() makes it immediate', async () => {
      const tag = `${Date.now().toString(36)}${n++}`;
      const orgId = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id`,
            [`au-${tag}`],
          )
        ).rows[0].id,
      );
      const perm = String(
        (await env.pg.owner.query(`SELECT key FROM permission_defs ORDER BY key LIMIT 1`)).rows[0]
          .key,
      );
      const userId = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO users (org_id,email,full_name) VALUES ($1,$2,'U') RETURNING id`,
            [orgId, `u-${tag}@x.test`],
          )
        ).rows[0].id,
      );
      const roleId = Number(
        (
          await env.pg.owner.query(`INSERT INTO roles (org_id,name) VALUES ($1,'R') RETURNING id`, [
            orgId,
          ])
        ).rows[0].id,
      );
      await env.pg.owner.query(
        `INSERT INTO role_grants (org_id,role_id,permission_key,effect,record_scope) VALUES ($1,$2,$3,'allow','all')`,
        [orgId, roleId, perm],
      );
      await env.pg.owner.query(`INSERT INTO user_roles VALUES ($1,$2,$3)`, [orgId, userId, roleId]);
      const dir = new MemberDirectory(a.db, a.rbac);
      const scope = async () =>
        (await dir.viewers(orgId, perm)).find((v) => v.userId === userId)?.scope ?? null;
      expect(await scope()).toBe('all');
      await env.pg.owner.query(`DELETE FROM role_grants WHERE org_id=$1 AND role_id=$2`, [
        orgId,
        roleId,
      ]);
      await a.rbac.bumpRolesVersion(orgId);
      expect(await scope()).toBe('all'); // the directory's own 30 s copy
      dir.invalidate(orgId);
      expect(await scope()).toBeNull();
      // and without invalidate(): a second directory that cached before the change
      const tag2 = `${Date.now().toString(36)}${n++}`;
      const org2 = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO organizations (slug,name) VALUES ($1,$1) RETURNING id`,
            [`au-${tag2}`],
          )
        ).rows[0].id,
      );
      const u2 = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO users (org_id,email,full_name) VALUES ($1,$2,'U') RETURNING id`,
            [org2, `u-${tag2}@x.test`],
          )
        ).rows[0].id,
      );
      const r2 = Number(
        (
          await env.pg.owner.query(`INSERT INTO roles (org_id,name) VALUES ($1,'R') RETURNING id`, [
            org2,
          ])
        ).rows[0].id,
      );
      await env.pg.owner.query(
        `INSERT INTO role_grants (org_id,role_id,permission_key,effect,record_scope) VALUES ($1,$2,$3,'allow','all')`,
        [org2, r2, perm],
      );
      await env.pg.owner.query(`INSERT INTO user_roles VALUES ($1,$2,$3)`, [org2, u2, r2]);
      const dir2 = new MemberDirectory(a.db, a.rbac);
      const scope2 = async () =>
        (await dir2.viewers(org2, perm)).find((v) => v.userId === u2)?.scope ?? null;
      expect(await scope2()).toBe('all');
      await env.pg.owner.query(`DELETE FROM role_grants WHERE org_id=$1 AND role_id=$2`, [
        org2,
        r2,
      ]);
      await a.rbac.bumpRolesVersion(org2);
      const s = await secondsUntil(scope2, null, 40, 500);
      expect(s).toBeLessThanOrEqual(30.5);
      record('M01 realtime audience, no invalidate()', {
        measuredStaleSeconds: s,
        documentedSeconds: 30,
      });
    }, 90_000);
  });

  describe('M16 webhook-forward target (10 s)', () => {
    it('a target switched off: the delivery path stops within 10 s (measured); forget() is immediate', async () => {
      const crypto = new CryptoService(
        stub({
          get: (k: string) =>
            k === 'CREDENTIALS_ENCRYPTION_KEY' ? Buffer.alloc(32, 7).toString('base64') : undefined,
        }),
      );
      const repo = new WebhookTargetsRepository(new PlatformStore(a.db), crypto);
      const id = Number(
        (
          await env.pg.owner.query(
            `INSERT INTO webhook_forward_targets (name, url) VALUES ('t','https://example.test/h') RETURNING id`,
          )
        ).rows[0].id,
      );
      expect(await repo.deliveryTarget(id)).not.toBeNull();
      await env.pg.owner.query(`UPDATE webhook_forward_targets SET is_active = false WHERE id=$1`, [
        id,
      ]);
      const s = await secondsUntil(
        async () => (await repo.deliveryTarget(id)) === null,
        true,
        14,
        250,
      );
      expect(s).toBeLessThanOrEqual(10.5);
      record('M16 webhook-forward target, no forget()', {
        measuredStaleSeconds: s,
        documentedSeconds: 10,
      });
      await env.pg.owner.query(`UPDATE webhook_forward_targets SET is_active = true WHERE id=$1`, [
        id,
      ]);
      repo.forget(id);
      expect(await repo.deliveryTarget(id)).not.toBeNull();
    }, 40_000);
  });

  describe('R17 booking page theme (Redis, 120 s)', () => {
    it('dropped by the saving staff member: the next visitor reads fresh on every process (shared Redis); a lost drop dies with the 120 s TTL', async () => {
      const cache = new BookingPageThemesCache(a.redis);
      const orgId = 424242;
      await cache.set(orgId, { v: 1 });
      expect(await new BookingPageThemesCache(a.redis).get(orgId)).toEqual({ v: 1 });
      await cache.drop(orgId);
      expect(await new BookingPageThemesCache(a.redis).get(orgId)).toBeNull();
      await cache.set(orgId, { v: 2 });
      const ttl = await env.admin.ttl(`appt:page-theme:v1:${orgId}`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(120);
      record('R17 booking page theme, drop lost', {
        boundSeconds: ttl,
        how: 'TTL read from Redis',
      });
      await cache.drop(orgId);
    });
  });
});
