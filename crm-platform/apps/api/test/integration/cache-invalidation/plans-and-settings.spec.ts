import { Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { BillingSettingsService } from '../../../src/modules/platform-payment-gateways/billing-settings.service';
import { PaygwStore } from '../../../src/modules/platform-payment-gateways/paygw.store';
import { SubscriptionLifecycleService } from '../../../src/modules/platform-payment-gateways/subscription-lifecycle.service';
import { TrialGateGuard } from '../../../src/modules/plans-subscriptions-trials/trial-gate.guard';
import { WorkspacePlanAdminService } from '../../../src/modules/plans-subscriptions-trials/workspace-plan-admin.service';
import { NotificationPrefsResolver } from '../../../src/modules/notifications/notification-prefs.resolver';
import { spawnInstance, type RemoteInstance } from './cross-process';
import { buildInstance, secondsUntil, sleep, startEnv, type Env, type Instance } from './harness';
import { record } from './results';

/**
 * Plans, entitlements, trial gate, grace days and settings (item #66): the facts that decide what a workspace may use. Entitlements
 * are read live from Postgres (no cache), the trial gate keeps a "not expired" verdict for 5 s, the grace days 30 s, the notification
 * toggles 5 s. Each is changed through the real writer class, then read here (A) and in a second OS process (B).
 */
Logger.overrideLogger(false);
const stub = (o: object) => o as never;
const FEATURE = 'automation';

describe('plans, entitlements and settings follow their source of truth', () => {
  let env: Env;
  let a: Instance;
  let b: RemoteInstance;
  let admin: WorkspacePlanAdminService;
  let lifecycle: SubscriptionLifecycleService;
  let n = 0;

  const asOperator = <T>(fn: () => Promise<T>) =>
    RequestContextStore.run({ requestId: 'op', orgId: 0, actorType: 'platform_operator', actorId: 1, userId: null }, fn);

  async function org(plan: string, state?: { trial?: string; planEnds?: string }) {
    const tag = `${Date.now().toString(36)}${n++}`;
    const r = (await env.pg.owner.query(`INSERT INTO organizations (slug,name,plan) VALUES ($1,$1,$2) RETURNING id, uuid`, [`pl-${tag}`, plan])).rows[0];
    if (state)
      await env.pg.owner.query(
        `INSERT INTO org_plan_state (org_id, trial_ends_at, plan_ends_at, billing_cycle) VALUES ($1, $2, $3, 'monthly')`,
        [r.id, state.trial ?? null, state.planEnds ?? null],
      );
    return { id: Number(r.id), uuid: String(r.uuid) };
  }
  const rowVersion = async (id: number) =>
    Number((await env.pg.owner.query(`SELECT row_version FROM org_plan_state WHERE org_id=$1`, [id])).rows[0]?.row_version ?? 1);
  const attach = async (o: { id: number; uuid: string }, planSlug: string, extra: object = {}) =>
    asOperator(async () => admin.attach(o.uuid, { planSlug, rowVersion: await rowVersion(o.id), ...extra } as never));
  const featureA = (o: { id: number }) => a.entitlements.featureEnabled(o.id, FEATURE as never);
  const featureB = (o: { id: number }) => b.call<boolean>('plan.feature', o.id, FEATURE);

  beforeAll(async () => {
    env = await startEnv();
    a = buildInstance(env, 'A');
    b = await spawnInstance(env, 'B');
    await env.pg.owner.query(
      `INSERT INTO plans (slug,name,amount,is_free,is_default,limits,features,sort_order) VALUES
         ('ci_free','Free',0,true,true,'{}'::jsonb,'{"${FEATURE}":false}'::jsonb,1),
         ('ci_pro','Pro',10,false,false,'{}'::jsonb,'{"${FEATURE}":true}'::jsonb,2)`,
    );
    admin = new WorkspacePlanAdminService(
      a.planStore,
      stub({ record: async () => undefined }),
      stub({ emit: async () => undefined }),
    );
    lifecycle = new SubscriptionLifecycleService(
      new PaygwStore(a.db),
      stub({}),
      stub({}),
      stub({ emit: async () => undefined }),
      stub({}),
    );
  }, 240_000);
  afterAll(async () => {
    b?.kill();
    await a?.close();
    await env?.stop();
  });

  describe('plan entitlements (read live: stale window 0 s on every process)', () => {
    it('plan changed by the operator (WorkspacePlanAdminService.attach): upgrade and downgrade are seen at once on both processes', async () => {
      const o = await org('ci_free');
      expect(await featureA(o)).toBe(false);
      expect(await featureB(o)).toBe(false);
      await attach(o, 'ci_pro');
      expect(await featureA(o)).toBe(true);
      expect(await featureB(o)).toBe(true);
      await attach(o, 'ci_free');
      expect(await featureA(o)).toBe(false);
      expect(await featureB(o)).toBe(false);
    });

    it('a per-workspace feature override (the feature flag the operator sets) is seen at once on both processes', async () => {
      const o = await org('ci_free');
      expect(await featureB(o)).toBe(false);
      await attach(o, 'ci_free', { overrides: { limits: {}, features: { [FEATURE]: true }, dataRetentionDays: null } });
      expect(await featureA(o)).toBe(true);
      expect(await featureB(o)).toBe(true);
    });

    it('subscription cancelled by the reconciler (SubscriptionLifecycleService.markEnded) while the paid window is over: the grace period ends at once', async () => {
      const o = await org('ci_pro', { planEnds: new Date(Date.now() - 86_400_000).toISOString() });
      await env.pg.owner.query(
        `INSERT INTO subscriptions (org_id, gateway, gateway_subscription_id, status, kind, plan_id, billing_cycle, amount, currency)
         VALUES ($1,'stripe',$2,'active','plan','ci_pro','monthly',10,'USD')`,
        [o.id, `sub_${o.id}`],
      );
      expect(await featureA(o)).toBe(true); // paid window over, live autopay, inside the 7 day grace
      expect(await featureB(o)).toBe(true);
      const row = (await env.pg.owner.query(`SELECT * FROM subscriptions WHERE org_id=$1`, [o.id])).rows[0];
      await lifecycle.markEnded({ ...row, orgId: o.id, status: 'active', planSlug: 'ci_pro' } as never, 'canceled');
      expect(await featureA(o)).toBe(false);
      expect(await featureB(o)).toBe(false);
    });

    it('plan expiry on a moving clock: the feature goes off within one second of plan_ends_at, with no invalidation by anyone', async () => {
      const ends = new Date(Date.now() + 3_000);
      const o = await org('ci_pro', { planEnds: ends.toISOString() });
      expect(await featureA(o)).toBe(true);
      expect(await featureB(o)).toBe(true);
      const s = await secondsUntil(() => featureA(o), false, 8, 50);
      const late = (Date.now() - ends.getTime()) / 1000;
      expect(late).toBeLessThan(1);
      expect(await featureB(o)).toBe(false);
      record('plan expiry (entitlements)', { secondsAfterPlanEndsAt: Number(late.toFixed(3)), polledForSeconds: Number(s.toFixed(2)), documentedSeconds: 0 });
    });
  });

  describe('trial gate (M06): a "not expired" verdict is kept 5 s; an "expired" one never', () => {
    const guard = () => new TrialGateGuard(new Reflector(), a.entitlements);
    const call = (g: TrialGateGuard, orgId: number) =>
      RequestContextStore.run({ requestId: 'g', orgId, actorType: 'user', actorId: 1, userId: 1 }, () =>
        g.canActivate(
          stub({
            getType: () => 'http',
            getHandler: () => function handler() {},
            getClass: () => class Controller {},
            switchToHttp: () => ({ getRequest: () => ({ url: '/v2/contacts' }) }),
          }),
        ),
      );
    const blocked = async (g: TrialGateGuard, orgId: number) => call(g, orgId).then(() => false, () => true);

    it('a trial that ends is noticed within 5 s (measured); paying lets the workspace through on the very next request', async () => {
      const ends = new Date(Date.now() + 2_000);
      const o = await org('ci_free', { trial: ends.toISOString() });
      const g = guard();
      expect(await blocked(g, o.id)).toBe(false); // trial running: verdict "open" is cached for 5 s
      await sleep(2_100); // the trial is over in Postgres now
      const t0 = ends.getTime();
      await secondsUntil(() => blocked(g, o.id), true, 8, 100);
      const s = (Date.now() - t0) / 1000;
      expect(s).toBeLessThanOrEqual(5.5);
      record('M06 trial gate', { measuredStaleSecondsAfterTrialEnd: Number(s.toFixed(2)), documentedSeconds: 5 });
      await attach(o, 'ci_pro'); // the operator (or a payment) gives a plan
      expect(await blocked(g, o.id)).toBe(false); // an "expired" verdict was never cached
    }, 30_000);
  });

  describe('billing grace days (M04, kept 30 s)', () => {
    it('saved on the billing screen (BillingSettingsService.save): this process uses the new number at once (defect D5: it kept the old one for 30 s); the other process within 30 s', async () => {
      expect(await a.planStore.graceDays()).toBe(7);
      expect(await b.call<number>('plan.grace')).toBe(7);
      const svc = new BillingSettingsService(a.settings, stub({ record: async () => undefined }), a.entitlements);
      const current = await asOperator(() => svc.read());
      await asOperator(() => svc.save({ ...current, graceDays: 20 } as never));
      expect(await a.planStore.graceDays()).toBe(20);
      const s = await secondsUntil(() => b.call<number>('plan.grace'), 20, 40, 250);
      expect(s).toBeLessThanOrEqual(30.5);
      record('M04 grace days, other process', { measuredStaleSeconds: s, documentedSeconds: 30 });
    }, 80_000);
  });

  describe('notification preferences', () => {
    it('the workspace toggles saved by the owner: the producers see them within 5 s (measured); a screen read (forget) sees them at once', async () => {
      const o = await org('ci_free');
      const resolver = new NotificationPrefsResolver(a.db);
      expect(await resolver.stored(o.id)).toBeUndefined();
      await env.pg.owner.query(
        `UPDATE organizations SET settings = settings || jsonb_build_object('notificationPrefs', '{"events":{}}'::jsonb) WHERE id=$1`,
        [o.id],
      ); // what WorkspaceSettingsService.saveNotifications writes
      const s = await secondsUntil(async () => (await resolver.stored(o.id)) !== undefined, true, 8, 100);
      expect(s).toBeLessThanOrEqual(5.5);
      record('M10 notification preferences, no forget()', { measuredStaleSeconds: s, documentedSeconds: 5 });
      const o2 = await org('ci_free');
      expect(await resolver.stored(o2.id)).toBeUndefined();
      await env.pg.owner.query(`UPDATE organizations SET settings = settings || '{"notificationPrefs":{"events":{}}}'::jsonb WHERE id=$1`, [o2.id]);
      resolver.forget(o2.id);
      expect(await resolver.stored(o2.id)).toBeDefined();
    }, 30_000);
  });
});
