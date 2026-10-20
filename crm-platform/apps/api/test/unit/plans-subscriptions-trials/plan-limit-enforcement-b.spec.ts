/**
 * Plan LIMIT enforcement, group B (booking, catalog, invoicing, segments, fields, team chat, broadcasts, widgets): each creating
 * service asks PlanUsageService before it writes. The guard is mocked; what is proved is the order (guard first, nothing inserted
 * when it refuses) and the key + organization (or audience size) the service passes.
 */
import { GATE_ON } from '../../support/unofficial-gate';
import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, WIDGET_BUILDER_DEFAULTS, createWidgetSchema } from '@crm/contracts';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { BookingTypesService } from '../../../src/modules/appointments-booking/booking-types.service';
import { BroadcastsService } from '../../../src/modules/broadcasts/broadcasts.service';
import { ProductsService } from '../../../src/modules/catalog-products/products.service';
import { WidgetsService } from '../../../src/modules/chatbot-widget/widgets.service';
import { AttributesService } from '../../../src/modules/crm/attributes/attributes.service';
import { FieldsService } from '../../../src/modules/crm/fields/fields.service';
import { InvoicesService } from '../../../src/modules/crm/invoicing/invoices.service';
import { RecurringInvoicesService } from '../../../src/modules/crm/invoicing/recurring-invoices.service';
import { SegmentsService } from '../../../src/modules/crm/segments/segments.service';
import { ChannelsService } from '../../../src/modules/team-chat/channels.service';

const ORG = 41;
const REACHED = new AppError(
  ERROR_CODES.PLAN_LIMIT_REACHED,
  'cap',
  HttpStatus.UNPROCESSABLE_ENTITY,
  [{ path: 'limit', message: 'x' }],
);
const NEXT = new Error('reached the step after the guard');

// The creators now take the lock and count through `assertCanAddIn(tx, org, key)`; the rig's fake answers it like `assertCanAdd(org, key)`.
const as = <T>(v: unknown) => {
  const o = v as { assertCanAdd?: (org: number, key: string) => unknown; assertCanAddIn?: unknown };
  if (o && typeof o.assertCanAdd === 'function' && !o.assertCanAddIn) {
    const guard = o.assertCanAdd;
    o.assertCanAddIn = (_tx: unknown, org: number, key: string) => guard(org, key);
  }
  return v as T;
};
const none = {} as never;
const db = () => ({ tx: vi.fn(async (fn: (tx: unknown) => unknown) => fn({})) });
const inCtx = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'r', orgId: ORG, actorType: 'user', actorId: 1, userId: 1, grants: [] } as never,
    fn,
  );

type Rig = {
  run: () => Promise<unknown>;
  /** The first step after the guard: rejects with NEXT. */
  after: ReturnType<typeof vi.fn>;
  /** The write itself. */
  inserted: ReturnType<typeof vi.fn>;
};

/** Runs the rig twice: guard refusing (the 422 surfaces, nothing after it runs) and guard passing (the next step is reached). */
async function proves(key: string, make: (assertCanAdd: ReturnType<typeof vi.fn>) => Rig) {
  const refuse = vi.fn().mockRejectedValue(REACHED);
  const a = make(refuse);
  await expect(a.run()).rejects.toMatchObject({
    code: ERROR_CODES.PLAN_LIMIT_REACHED,
    status: HttpStatus.UNPROCESSABLE_ENTITY,
  });
  expect(a.after).not.toHaveBeenCalled();
  expect(a.inserted).not.toHaveBeenCalled();
  expect(refuse).toHaveBeenCalledWith(ORG, key);

  const allow = vi.fn().mockResolvedValue(undefined);
  const b = make(allow);
  await expect(b.run()).rejects.toBe(NEXT);
  expect(b.after).toHaveBeenCalled();
  expect(allow).toHaveBeenCalledWith(ORG, key);
}

const widgetsService = (repo: object, assertCanAdd: ReturnType<typeof vi.fn>) =>
  new WidgetsService(
    as(db()),
    as(repo),
    none,
    none,
    as({ get: vi.fn() }),
    none,
    as({ isEnabled: vi.fn().mockResolvedValue(true) }),
    as({ assertCanAdd }),
    as({ assertFeature: vi.fn() }),
    none,
  );

describe('plan limits, group B: guard before insert', () => {
  it('catalog_products: ProductsService.create', async () => {
    await proves('catalog_products', (assertCanAdd) => {
      const repo = { slugsLike: vi.fn().mockRejectedValue(NEXT), insert: vi.fn() };
      const svc = new ProductsService(
        as(db()),
        as(repo),
        none,
        none,
        none,
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
      );
      return {
        run: () => inCtx(() => svc.create(as({ name: 'Shirt' }))),
        after: repo.slugsLike,
        inserted: repo.insert,
      };
    });
  });

  it('chatbot_widgets: WidgetsService.create', async () => {
    await proves('chatbot_widgets', (assertCanAdd) => {
      const repo = { lockSlugs: vi.fn().mockRejectedValue(NEXT), insert: vi.fn() };
      const svc = widgetsService(repo, assertCanAdd);
      vi.spyOn(svc as never, 'resolveAssistant' as never).mockResolvedValue(null as never);
      const body = createWidgetSchema.parse({ ...WIDGET_BUILDER_DEFAULTS, name: 'Site chat' });
      return {
        run: () => inCtx(() => svc.create(body)),
        after: repo.lockSlugs,
        inserted: repo.insert,
      };
    });
  });

  it('chatbot_widgets: WidgetsService.duplicate', async () => {
    await proves('chatbot_widgets', (assertCanAdd) => {
      const repo = {
        findByUuid: vi.fn().mockResolvedValue({ uuid: 'u', slug: 's', name: 'w' }),
        // The write is also the step after the guard: the refusal case proves it never ran.
        insert: vi.fn().mockRejectedValue(NEXT),
      };
      const svc = widgetsService(repo, assertCanAdd);
      return {
        run: () => inCtx(() => svc.duplicate('u')),
        after: repo.insert,
        inserted: vi.fn(),
      };
    });
  });

  it('invoices_monthly: InvoicesService.createDraftIn (manual, duplicate, conversion, recurring runner)', async () => {
    await proves('invoices_monthly', (assertCanAdd) => {
      const settings = { load: vi.fn().mockRejectedValue(NEXT) };
      const repo = { insert: vi.fn() };
      const svc = new InvoicesService(
        as(db()),
        as(repo),
        none,
        as(settings),
        none,
        none,
        none,
        none,
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
      );
      return {
        run: () => svc.createDraftIn(as({}), ORG, 1, as({})),
        after: settings.load,
        inserted: repo.insert,
      };
    });
  });

  it('recurring_invoices: RecurringInvoicesService.create', async () => {
    await proves('recurring_invoices', (assertCanAdd) => {
      const settings = { load: vi.fn().mockRejectedValue(NEXT) };
      const repo = { insert: vi.fn() };
      const svc = new RecurringInvoicesService(
        as(db()),
        as(repo),
        none,
        none,
        as(settings),
        none,
        none,
        as({ assertCanAdd }),
      );
      return {
        run: () => inCtx(() => svc.create(as({}), as({}))),
        after: settings.load,
        inserted: repo.insert,
      };
    });
  });

  it('booking_types: BookingTypesService.create', async () => {
    await proves('booking_types', (assertCanAdd) => {
      const repo = { insert: vi.fn() };
      const svc = new BookingTypesService(
        as(db()),
        as(repo),
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
        none,
        none,
        as({ get: () => 'http://web.test' }),
      );
      const after = vi.fn().mockRejectedValue(NEXT);
      vi.spyOn(svc as never, 'resolveHost' as never).mockImplementation(after as never);
      return {
        run: () => inCtx(() => svc.create(as({ name: 'Intro call' }))),
        after,
        inserted: repo.insert,
      };
    });
  });

  it('segments: SegmentsService.create', async () => {
    await proves('segments', (assertCanAdd) => {
      const repo = { insertIfAbsent: vi.fn() };
      const svc = new SegmentsService(
        as(db()),
        as(repo),
        none,
        none,
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
      );
      const after = vi.fn().mockRejectedValue(NEXT);
      vi.spyOn(svc as never, 'assertRulesValid' as never).mockImplementation(after as never);
      return {
        run: () => inCtx(() => svc.create(as({ name: 'VIP', rules: {} }))),
        after,
        inserted: repo.insertIfAbsent,
      };
    });
  });

  it('custom_fields: FieldsService.create', async () => {
    await proves('custom_fields', (assertCanAdd) => {
      const repo = { resolveSectionId: vi.fn().mockRejectedValue(NEXT), insert: vi.fn() };
      const svc = new FieldsService(
        as(db()),
        as(repo),
        none,
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
      );
      vi.spyOn(svc as never, 'requireModulePermission' as never).mockImplementation(
        (() => undefined) as never,
      );
      return {
        run: () => inCtx(() => svc.create(as({ moduleKey: 'deals', key: 'region' }))),
        after: repo.resolveSectionId,
        inserted: repo.insert,
      };
    });
  });

  it('custom_fields: AttributesService.create', async () => {
    await proves('custom_fields', (assertCanAdd) => {
      const repo = { keyTaken: vi.fn().mockRejectedValue(NEXT), insert: vi.fn() };
      const svc = new AttributesService(
        as(db()),
        as(repo),
        none,
        none,
        none,
        none,
        as({ assertCanAdd }),
      );
      vi.spyOn(svc as never, 'require' as never).mockImplementation((() => undefined) as never);
      return {
        run: () => inCtx(() => svc.create(as({ key: 'region', name: 'Region', type: 'text' }))),
        after: repo.keyTaken,
        inserted: repo.insert,
      };
    });
  });

  it('team_chat_channels: ChannelsService.create', async () => {
    await proves('team_chat_channels', (assertCanAdd) => {
      const repo = { insertChannel: vi.fn().mockRejectedValue(NEXT) };
      const svc = new ChannelsService(
        as(db()),
        as(repo),
        as({ actor: () => ({ orgId: ORG, userId: 1 }) }),
        none,
        none,
        as({ assertCanAdd }),
      );
      return {
        run: () => svc.create(as({ name: 'Sales', type: 'public' })),
        after: repo.insertChannel,
        inserted: vi.fn(),
      };
    });
  });

  it('broadcast_recipients: BroadcastsService.create passes the resolved, de-duplicated audience size', async () => {
    const make = (assertAudienceWithin: ReturnType<typeof vi.fn>) => {
      const repo = {
        count: vi.fn().mockResolvedValue(0),
        contactIdsByUuid: vi.fn().mockResolvedValue([1, 2, 3]),
        groupMemberIds: vi.fn().mockResolvedValue([3, 4]),
        tagMemberIds: vi.fn().mockResolvedValue([]),
        sendableIds: vi.fn().mockResolvedValue(new Set([1, 2, 3, 4])),
        insert: vi.fn(),
      };
      const sendPolicy = { screenBulk: vi.fn().mockRejectedValue(NEXT) };
      const svc = new BroadcastsService(
        as(db()),
        as(repo),
        as({ assertWithinLimit: vi.fn(), lockLimit: vi.fn() }),
        as(sendPolicy),
        none,
        none,
        none,
        as({ resolve: vi.fn().mockResolvedValue([]) }),
        none,
        none,
        none,
        as({ assertEnabled: vi.fn() }),
        as({ assertAudienceWithin }),
        GATE_ON,
        as({ memberIdsIn: vi.fn().mockResolvedValue([]) }),
      );
      const body = {
        name: 'Promo',
        templateId: '00000000-0000-4000-8000-000000000001',
        contactIds: ['00000000-0000-4000-8000-000000000002'],
        scheduleType: 'now',
      };
      return { run: () => inCtx(() => svc.create(body)), sendPolicy, repo };
    };

    const refuse = vi.fn().mockRejectedValue(REACHED);
    const a = make(refuse);
    await expect(a.run()).rejects.toMatchObject({ code: ERROR_CODES.PLAN_LIMIT_REACHED });
    expect(refuse).toHaveBeenCalledWith(ORG, 4);
    expect(a.sendPolicy.screenBulk).not.toHaveBeenCalled();
    expect(a.repo.insert).not.toHaveBeenCalled();

    const allow = vi.fn().mockResolvedValue(undefined);
    const b = make(allow);
    await expect(b.run()).rejects.toBe(NEXT);
    expect(allow).toHaveBeenCalledWith(ORG, 4);
  });
});
