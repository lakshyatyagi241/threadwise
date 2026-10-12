import 'reflect-metadata';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  PlanEntitlementService,
  REQUIRE_PLAN_FEATURE_KEY,
} from '../../../src/modules/plans-subscriptions-trials';
import { PlanFeatureGuard } from '../../../src/modules/plans-subscriptions-trials/plan-feature.guard';
import { ApiKeyAccessService } from '../../../src/modules/public-api/api-key-access.service';
import { PublicApiController } from '../../../src/modules/public-api/public-api.controller';
import { TeamChatController } from '../../../src/modules/team-chat/team-chat.controller';
import { StoreController } from '../../../src/modules/storefront-builder/shops/store.controller';
import { PublicStoreController } from '../../../src/modules/storefront-builder/public/public-store.controller';
import { PaymentWebhookController } from '../../../src/modules/storefront-builder/payments/payment-webhook.controller';
import { BotsController } from '../../../src/modules/channel-telegram/bots.controller';
import { TgBroadcastsController } from '../../../src/modules/channel-telegram/tg-broadcasts.controller';
import { WebhookController as TelegramWebhookController } from '../../../src/modules/channel-telegram/webhook.controller';
import { FbBroadcastsController } from '../../../src/modules/channel-facebook/fb-broadcasts.controller';
import { InsightsController } from '../../../src/modules/channel-facebook/insights.controller';
import { PagesController } from '../../../src/modules/channel-facebook/pages.controller';
import { PostsController } from '../../../src/modules/channel-facebook/posts.controller';
import { SetupController } from '../../../src/modules/channel-facebook/setup.controller';
import { FacebookPublicController } from '../../../src/modules/channel-facebook/webhook.controller';
import { AccountsController } from '../../../src/modules/channel-instagram/accounts.controller';
import { BroadcastsController } from '../../../src/modules/channel-instagram/broadcasts.controller';
import { FlowsController } from '../../../src/modules/channel-instagram/flows.controller';
import { InstaflowPublicController } from '../../../src/modules/channel-instagram/inbound.controller';
import { CreditNotesController } from '../../../src/modules/crm/invoicing/credit-notes.controller';
import { InvoiceGatewayWebhookController } from '../../../src/modules/crm/invoicing/invoice-gateway-webhook.controller';
import { InvoicePublicController } from '../../../src/modules/crm/invoicing/invoice-public.controller';
import { InvoiceSettingsController } from '../../../src/modules/crm/invoicing/invoice-settings.controller';
import {
  ContactInvoicesController,
  DealInvoicesController,
  InvoicesController,
} from '../../../src/modules/crm/invoicing/invoices.controller';
import { PaymentsController } from '../../../src/modules/crm/invoicing/payments.controller';
import { RecurringInvoicesController } from '../../../src/modules/crm/invoicing/recurring-invoices.controller';
import { SalesOrdersController } from '../../../src/modules/crm/invoicing/sales-orders.controller';
import { TaxRatesController } from '../../../src/modules/crm/invoicing/tax-rates.controller';

type Ctor = { prototype: object };
const WRITE_VERBS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// Nest's @Get/@Post store the verb as a number in `method` metadata: 0 GET, 1 POST, 2 PUT, 3 DELETE, 4 PATCH.
const VERB = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];

const classKeys = (c: Ctor) =>
  Reflect.getMetadata(REQUIRE_PLAN_FEATURE_KEY, c) as string[] | undefined;

/** Every route handler of a controller with its HTTP verb and the keys declared on the handler itself. */
function handlers(c: Ctor) {
  return Object.getOwnPropertyNames(c.prototype)
    .filter((n) => n !== 'constructor')
    .map((n) => {
      const fn = (c.prototype as Record<string, unknown>)[n] as object;
      const m = Reflect.getMetadata('method', fn) as number | undefined;
      return {
        name: n,
        verb: m === undefined ? null : VERB[m],
        keys: Reflect.getMetadata(REQUIRE_PLAN_FEATURE_KEY, fn) as string[] | undefined,
      };
    })
    .filter((h) => h.verb !== null);
}

describe('whole-controller plan features', () => {
  const whole: Array<[string, Ctor, string]> = [
    ['team chat', TeamChatController, 'team_chat'],
    ['public api', PublicApiController, 'public_api'],
    ['telegram bots', BotsController, 'extra_channels'],
    ['telegram broadcasts', TgBroadcastsController, 'extra_channels'],
    ['facebook broadcasts', FbBroadcastsController, 'extra_channels'],
    ['facebook insights', InsightsController, 'extra_channels'],
    ['facebook pages', PagesController, 'extra_channels'],
    ['facebook posts', PostsController, 'extra_channels'],
    ['facebook setup', SetupController, 'extra_channels'],
    ['instagram accounts', AccountsController, 'extra_channels'],
    ['instagram broadcasts', BroadcastsController, 'extra_channels'],
    ['instagram flows', FlowsController, 'extra_channels'],
  ];
  it.each(whole)('%s needs %s on the controller', (_n, ctrl, key) => {
    expect(classKeys(ctrl)).toEqual([key]);
  });
});

describe('write-route plan features', () => {
  const writeOnly: Array<[string, Ctor, string]> = [
    ['invoices', InvoicesController, 'invoicing'],
    ['credit notes', CreditNotesController, 'invoicing'],
    ['invoice settings', InvoiceSettingsController, 'invoicing'],
    ['payments', PaymentsController, 'invoicing'],
    ['recurring invoices', RecurringInvoicesController, 'invoicing'],
    ['sales orders', SalesOrdersController, 'invoicing'],
    ['tax rates', TaxRatesController, 'invoicing'],
    ['storefront admin', StoreController, 'storefront_builder'],
  ];
  it.each(writeOnly)('%s: every write route needs %s, no read route does', (_n, ctrl, key) => {
    expect(classKeys(ctrl)).toBeUndefined();
    const hs = handlers(ctrl);
    expect(hs.some((h) => WRITE_VERBS.has(h.verb!))).toBe(true);
    for (const h of hs) {
      if (WRITE_VERBS.has(h.verb!)) expect(h.keys, `${h.verb} ${h.name}`).toEqual([key]);
      else expect(h.keys, `${h.verb} ${h.name}`).toBeUndefined();
    }
  });
});

describe('routes that must stay open (third parties, visitors, paywall rendering)', () => {
  const open: Array<[string, Ctor]> = [
    ['telegram inbound webhook', TelegramWebhookController],
    ['facebook webhook', FacebookPublicController],
    ['instagram inbound', InstaflowPublicController],
    ['public storefront', PublicStoreController],
    ['storefront payment webhook', PaymentWebhookController],
    ['public invoice pages', InvoicePublicController],
    ['invoice gateway webhook', InvoiceGatewayWebhookController],
    ['contact invoices (read)', ContactInvoicesController],
    ['deal invoices (read)', DealInvoicesController],
  ];
  it.each(open)('%s carries no plan feature', (_n, ctrl) => {
    expect(classKeys(ctrl)).toBeUndefined();
    for (const h of handlers(ctrl)) expect(h.keys, h.name).toBeUndefined();
  });
});

function stubEntitlements(enabled: boolean): PlanEntitlementService {
  const stub = {
    featureEnabled: async () => enabled,
    forOrg: async () => null,
  } as unknown as PlanEntitlementService;
  (stub as { assertFeature: unknown }).assertFeature =
    PlanEntitlementService.prototype.assertFeature.bind(stub);
  return stub;
}

describe('PlanFeatureGuard', () => {
  class Locked {}
  Reflect.defineMetadata(REQUIRE_PLAN_FEATURE_KEY, ['team_chat'], Locked);

  const exec = (cls: object): ExecutionContext =>
    ({ getType: () => 'http', getHandler: () => () => undefined, getClass: () => cls }) as never;
  const ctx = (actorType: 'user' | 'api_key' | 'platform_operator') => ({
    requestId: 'r',
    orgId: 7,
    actorType,
    actorId: 1,
    userId: 1,
  });

  it('answers 422 PLAN_FEATURE_LOCKED with the feature for a workspace whose plan lacks it', async () => {
    const guard = new PlanFeatureGuard(new Reflector(), stubEntitlements(false));
    await RequestContextStore.run(ctx('user'), async () => {
      await expect(guard.canActivate(exec(Locked))).rejects.toMatchObject({
        code: 'PLAN_FEATURE_LOCKED',
        status: 422,
      });
    });
  });

  it('lets the request through when the plan has the feature, and for platform operators', async () => {
    await RequestContextStore.run(ctx('user'), async () => {
      const guard = new PlanFeatureGuard(new Reflector(), stubEntitlements(true));
      expect(await guard.canActivate(exec(Locked))).toBe(true);
    });
    await RequestContextStore.run(ctx('platform_operator'), async () => {
      const guard = new PlanFeatureGuard(new Reflector(), stubEntitlements(false));
      expect(await guard.canActivate(exec(Locked))).toBe(true);
    });
  });
});

describe('API-key plan feature enforcement (ApiKeyAccessService, shared by both key guards)', () => {
  const run = (enabled: boolean, cls: object) => {
    const guard = Object.create(ApiKeyAccessService.prototype) as Record<string, unknown>;
    guard.entitlements = stubEntitlements(enabled);
    guard.reflector = new Reflector();
    const context = { getHandler: () => () => undefined, getClass: () => cls };
    return (
      guard as unknown as { assertPlanFeatures: (c: unknown, o: number) => Promise<void> }
    ).assertPlanFeatures(context, 7);
  };

  it('refuses a key whose workspace plan lacks public_api (the app-wide guard cannot see the workspace yet)', async () => {
    await expect(run(false, PublicApiController)).rejects.toMatchObject({
      code: 'PLAN_FEATURE_LOCKED',
      status: 422,
    });
    await expect(run(true, PublicApiController)).resolves.toBeUndefined();
  });

  it('does not gate a key-authenticated controller that declares no feature', async () => {
    class Plain {}
    await expect(run(false, Plain)).resolves.toBeUndefined();
  });
});
