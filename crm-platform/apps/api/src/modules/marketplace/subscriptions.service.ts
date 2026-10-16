import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  marketPackSlug,
  marketCheckoutPath,
  type MarketSubscribeResult,
  type MarketSubscription,
  type MarketSubscriptionStateAnswer,
  type MarketWorkspaceSubscriptionList,
  type SubscribeAppInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { cardPricing, PricingAccess } from './pricing-access.service';
import {
  APP_PRICING_COLUMNS,
  SUBSCRIPTION_COLUMNS,
  readAppPricing,
  readSubscription,
  toSubscriptionView,
  type AppPricingRow,
  type SubscriptionRow,
} from './pricing-model';
import { parseAppRef, type AppRef } from './marketplace-rules';
import { MarketSubscriptionLifecycle } from './subscription-lifecycle.service';
import { iso } from './sql-helpers';

type Raw = Record<string, unknown>;

interface AppFacts {
  id: number;
  uuid: string;
  slug: string;
  status: string;
  installed: boolean;
  pricing: AppPricingRow;
  sub: SubscriptionRow | null;
}

/**
 * A workspace's side of a paid app: subscribe (go and pay, or start the free trial), cancel (the period already paid for runs to its end),
 * take a cancellation back, and read its own subscriptions. Payment itself is never here: Subscribe answers with the existing checkout
 * page of the app's add-on, and the add-on's purchase (which entitles the workspace) writes the subscription in checkout's transaction.
 *
 * Everything runs in the workspace's tenant transaction. A workspace cannot write `marketplace_subscriptions` or `workspace_addons`; the two
 * things it may do, start a trial and ask not to renew, go through two narrow SECURITY DEFINER functions.
 */
@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly access: PricingAccess,
    private readonly lifecycle: MarketSubscriptionLifecycle,
  ) {}

  // --- reads --------------------------------------------------------------------------------------------------------------------------

  /** The workspace's own subscriptions, newest first. */
  async list(): Promise<MarketWorkspaceSubscriptionList> {
    const { orgId } = RequestContextStore.require();
    const rows = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        SELECT a.uuid AS app_uuid, a.slug AS app_slug, a.name AS app_name, a.kind AS app_kind, a.status AS app_status,
               a.listing ->> 'logo' AS app_logo, i.uuid AS installation_uuid, ${APP_PRICING_COLUMNS}, ${SUBSCRIPTION_COLUMNS}
        FROM marketplace_subscriptions s
        JOIN marketplace_apps a ON a.id = s.app_id
        LEFT JOIN workspace_app_installations i ON i.org_id = s.org_id AND i.app_id = s.app_id
        WHERE s.org_id = ${orgId}
        ORDER BY s.started_at DESC, s.id DESC`);
      return res.rows as Raw[];
    });
    const now = new Date();
    return {
      data: rows.map((r) => ({
        ...toSubscriptionView(readSubscription(r)!, readAppPricing(r), r.app_status as string, now),
        app: {
          id: r.app_uuid as string,
          slug: r.app_slug as string,
          name: r.app_name as string,
          kind: r.app_kind as 'mini_app' | 'integration',
          logo: (r.app_logo as string | null) ?? null,
        },
        installationId: (r.installation_uuid as string | null) ?? null,
      })),
    };
  }

  // --- subscribe ----------------------------------------------------------------------------------------------------------------------

  /**
   * What happens when the admin presses Subscribe. Free and included apps need nothing; a workspace that already holds a subscription is
   * sent to renew only when the period is nearly over; with `startTrial` the free trial begins at once; otherwise the answer is where to
   * pay. A paid app that the platform has stopped selling to newcomers is a 409.
   */
  async subscribe(appRef: string, input: SubscribeAppInput): Promise<MarketSubscribeResult> {
    const ctx = RequestContextStore.require();
    const result = await this.db.tx(async (tx) => {
      const app = await this.facts(tx, ctx.orgId, appRef);
      if (app.pricing.pricingModel === 'free')
        return { outcome: 'free' as const, checkout: null, subscription: null };
      if (app.status !== 'published' && !(app.status === 'hidden' && (app.installed || app.sub)))
        throw this.unavailable();

      const ev = await (
        await this.access.evaluator(ctx.orgId)
      )({
        appId: app.id,
        slug: app.slug,
        uuid: app.uuid,
        pricing: app.pricing,
        sub: app.sub,
        installed: app.installed,
      });
      // The plan does not show this paid app and the workspace has nothing of it: it does not exist for it (404), so a direct call
      // cannot reach the checkout or start a trial of an app its plan keeps out of view.
      if (ev.availability === 'not_visible') throw this.notFound();
      const now = new Date();
      const view = app.sub ? toSubscriptionView(app.sub, app.pricing, app.status, now) : null;
      const checkout = {
        packSlug: marketPackSlug(app.uuid),
        path: marketCheckoutPath(marketPackSlug(app.uuid)),
      };

      if (input.startTrial) {
        const offered = cardPricing(
          { appId: app.id, slug: app.slug, uuid: app.uuid, pricing: app.pricing, sub: app.sub },
          ev,
        ).trialAvailable;
        if (!offered) throw this.trialUnavailable();
        const started = await tx.execute(
          sql`SELECT marketplace_start_trial(${app.id}::bigint) AS id`,
        );
        if ((started.rows[0] as { id: string | null }).id === null) throw this.trialUnavailable();
        const sub = await this.subOf(tx, ctx.orgId, app.id);
        await this.lifecycle.note(
          tx,
          ctx.orgId,
          sub!.id,
          sub!.uuid,
          app.slug,
          'started',
          { by: 'workspace', userId: ctx.userId },
          {
            source: 'trial',
            trialDays: app.pricing.trialDays,
            periodEnd: iso(sub!.currentPeriodEnd),
          },
        );
        return {
          outcome: 'trial_started' as const,
          checkout: null,
          subscription: toSubscriptionView(sub!, app.pricing, app.status, now),
        };
      }

      if (ev.access === 'included')
        return { outcome: 'included' as const, checkout: null, subscription: view };
      if (ev.access === 'entitled') {
        // Entitled: nothing to buy until the period is nearly over (and never for a comp or an entitlement with no subscription row).
        const renewable = view?.actions.canRenew === true;
        return renewable
          ? { outcome: 'checkout' as const, checkout, subscription: view }
          : { outcome: 'already_entitled' as const, checkout: null, subscription: view };
      }
      if (ev.access === 'not_for_sale') throw this.notForSale();
      return { outcome: 'checkout' as const, checkout, subscription: view };
    });
    return result;
  }

  // --- cancel and resume --------------------------------------------------------------------------------------------------------------

  /** Stops renewal. The period already paid for runs to its end; then the installation is paused and its data kept. */
  async cancel(appRef: string): Promise<MarketSubscriptionStateAnswer> {
    const ctx = RequestContextStore.require();
    // A subscription the card renews is stopped at the payment provider FIRST (at the end of the period already paid for): the person is
    // told the card will not be charged again, so that must be true before the ledger says it. When the provider cannot confirm, nothing
    // changes and the person is told to try again.
    const live = await this.db.tx(async (tx) => {
      const app = await this.facts(tx, ctx.orgId, appRef);
      const sub = app.sub;
      return sub && sub.source === 'purchase' && sub.status === 'active' && sub.autorenew
        ? { packId: sub.packId }
        : null;
    });
    if (live)
      await this.lifecycle.stopCardRenewal(ctx.orgId, live.packId, {
        atCycleEnd: true,
        reason: 'user',
        actor: { id: ctx.actorId ?? ctx.userId, type: ctx.actorType },
      });
    return this.change(appRef, async (tx, app, view) => {
      if (view.status === 'ended') throw this.state('This subscription has already ended.');
      if (app.sub!.source === 'comp')
        throw this.state(
          'This app was granted to your workspace by the platform; it cannot be cancelled here.',
        );
      if (view.status === 'canceling') return false; // already asked: nothing more to do
      const changed = await this.setCancel(tx, app.id, true);
      if (changed)
        await this.lifecycle.note(
          tx,
          ctx.orgId,
          app.sub!.id,
          app.sub!.uuid,
          app.slug,
          'canceled',
          { by: 'workspace', userId: ctx.userId },
          { reason: 'requested', periodEnd: iso(app.sub!.currentPeriodEnd) },
        );
      return changed;
    });
  }

  /** Takes a cancellation back while the period is still running. */
  async resume(appRef: string): Promise<MarketSubscriptionStateAnswer> {
    const ctx = RequestContextStore.require();
    return this.change(appRef, async (tx, app, view) => {
      if (view.status !== 'canceling') throw this.state('There is no cancellation to take back.');
      if (app.sub!.autorenewStoppedAt !== null)
        throw this.state(
          'The automatic renewal was stopped at the payment provider and cannot be restarted. Subscribe again to keep the app.',
        );
      const changed = await this.setCancel(tx, app.id, false);
      if (changed)
        await this.lifecycle.note(
          tx,
          ctx.orgId,
          app.sub!.id,
          app.sub!.uuid,
          app.slug,
          'resumed',
          { by: 'workspace', userId: ctx.userId },
          { periodEnd: iso(app.sub!.currentPeriodEnd) },
        );
      return changed;
    });
  }

  /**
   * Uninstalling a paid app cancels its renewal (the admin was warned): the period already paid for stays, so reinstalling inside it needs
   * no new payment. In the uninstall's own transaction. Returns whether a renewal was cancelled.
   */
  async cancelOnUninstall(
    tx: Tx,
    orgId: number,
    userId: number | null,
    appId: number,
    slug: string,
  ): Promise<{ changed: boolean; cardPackId: number | null }> {
    const sub = await this.subOf(tx, orgId, appId);
    if (!sub || sub.status !== 'active' || sub.source === 'comp' || sub.cancelAtPeriodEnd)
      return { changed: false, cardPackId: null };
    const changed = await this.setCancel(tx, appId, true);
    if (changed)
      await this.lifecycle.note(
        tx,
        orgId,
        sub.id,
        sub.uuid,
        slug,
        'canceled',
        { by: 'workspace', userId },
        { reason: 'uninstalled', periodEnd: iso(sub.currentPeriodEnd) },
      );
    // The caller ends the provider subscription after the commit (a provider call must not hold this transaction).
    return { changed, cardPackId: changed && sub.autorenew ? sub.packId : null };
  }

  /** After an uninstall committed: the card renewal of the app it cancelled is ended at the provider, at the end of the paid period. */
  async stopCardRenewalAfterUninstall(
    orgId: number,
    userId: number | null,
    packId: number,
  ): Promise<void> {
    await this.lifecycle.stopCardRenewal(orgId, packId, {
      atCycleEnd: true,
      reason: 'user',
      actor: { id: userId, type: 'user' },
    });
  }

  // --- internals ----------------------------------------------------------------------------------------------------------------------

  private async change(
    appRef: string,
    act: (tx: Tx, app: AppFacts, view: MarketSubscription) => Promise<boolean>,
  ): Promise<MarketSubscriptionStateAnswer> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const app = await this.facts(tx, orgId, appRef);
      if (!app.sub)
        throw new AppError(
          ERROR_CODES.MKT_SUBSCRIPTION_NOT_FOUND,
          'You have no subscription to this app.',
          HttpStatus.NOT_FOUND,
        );
      const view = toSubscriptionView(app.sub, app.pricing, app.status, new Date());
      const changed = await act(tx, app, view);
      const fresh = changed ? ((await this.subOf(tx, orgId, app.id)) ?? app.sub) : app.sub;
      return { subscription: toSubscriptionView(fresh, app.pricing, app.status, new Date()) };
    });
  }

  private async setCancel(tx: Tx, appId: number, cancel: boolean): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT marketplace_subscription_set_cancel(${appId}::bigint, ${cancel}::boolean) AS changed`,
    );
    return (res.rows[0] as { changed: boolean }).changed === true;
  }

  private async facts(tx: Tx, orgId: number, appRef: string): Promise<AppFacts> {
    const ref: AppRef | null = parseAppRef(appRef);
    if (!ref) throw this.notFound();
    const res = await tx.execute(sql`
      SELECT a.id, a.uuid, a.slug, a.status, (i.id IS NOT NULL) AS installed, ${APP_PRICING_COLUMNS}, ${SUBSCRIPTION_COLUMNS}
      FROM marketplace_apps a
      LEFT JOIN marketplace_subscriptions s ON s.app_id = a.id AND s.org_id = ${orgId}
      LEFT JOIN workspace_app_installations i ON i.app_id = a.id AND i.org_id = ${orgId}
      WHERE ${ref.by === 'uuid' ? sql`a.uuid = ${ref.value}::uuid` : sql`a.slug = ${ref.value}`}`);
    const r = res.rows[0] as Raw | undefined;
    if (!r) throw this.notFound();
    return {
      id: Number(r.id),
      uuid: r.uuid as string,
      slug: r.slug as string,
      status: r.status as string,
      installed: r.installed === true,
      pricing: readAppPricing(r),
      sub: readSubscription(r),
    };
  }

  private async subOf(tx: Tx, orgId: number, appId: number): Promise<SubscriptionRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SUBSCRIPTION_COLUMNS} FROM marketplace_subscriptions s WHERE s.org_id = ${orgId} AND s.app_id = ${appId}`);
    const r = res.rows[0] as Raw | undefined;
    return r ? readSubscription(r) : null;
  }

  private notFound(): AppError {
    return new AppError(ERROR_CODES.MKT_APP_NOT_FOUND, 'App not found', HttpStatus.NOT_FOUND);
  }
  private unavailable(): AppError {
    return new AppError(
      ERROR_CODES.MKT_APP_UNAVAILABLE,
      'This app is not available for subscription.',
      HttpStatus.CONFLICT,
    );
  }
  private notForSale(): AppError {
    return new AppError(
      ERROR_CODES.MKT_NOT_FOR_SALE,
      'This app is not being sold to new subscribers.',
      HttpStatus.CONFLICT,
    );
  }
  private trialUnavailable(): AppError {
    return new AppError(
      ERROR_CODES.MKT_TRIAL_UNAVAILABLE,
      'The free trial is not available for this app.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
  private state(message: string): AppError {
    return new AppError(ERROR_CODES.MKT_SUBSCRIPTION_STATE, message, HttpStatus.CONFLICT);
  }
}
