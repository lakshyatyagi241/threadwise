import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { AppError } from '../../../src/common/errors/app-error';
import { FieldSectionsService } from '../../../src/modules/crm/field-sections/field-sections.service';
import { FieldsService } from '../../../src/modules/crm/fields/fields.service';
import { StatusOptionsService } from '../../../src/modules/crm/status-options/status-options.service';

/**
 * The three drag-to-reorder endpoints used to run one SELECT per id in the ordered list. Each now reads the whole list with one
 * `findByUuids` and then checks every row exactly as before (it must exist, and belong to the module or field the caller declared).
 * The services are built without their dependencies; only what `reorder` touches is stubbed.
 */
const tx = {};
const db = { tx: async <T>(fn: (t: unknown) => Promise<T>) => fn(tx) };
const allow = { can: () => ({ allowed: true }) };
const inContext = <T>(fn: () => Promise<T>) =>
  RequestContextStore.run(
    { requestId: 'r', orgId: 7, actorType: 'user', actorId: 1, userId: 1, grants: {} as never },
    fn,
  );

function make<T extends object>(proto: object, deps: Record<string, unknown>): T {
  return Object.assign(Object.create(proto), deps) as T;
}

describe('status option reorder', () => {
  const build = (known: Map<string, { id: number; moduleKey: string }>) => {
    const findByUuids = vi.fn(async () => known);
    const findByUuid = vi.fn();
    const reorder = vi.fn(async () => undefined);
    const service = make<StatusOptionsService>(StatusOptionsService.prototype, {
      db,
      rbac: allow,
      repo: { findByUuids, findByUuid, reorder },
    });
    return { service, findByUuids, findByUuid, reorder };
  };

  it('reads the list once and reorders by the resolved ids, in the order given', async () => {
    const uuids = Array.from({ length: 50 }, () => randomUUID());
    const known = new Map(uuids.map((u, i) => [u, { id: i + 1, moduleKey: 'contacts' }]));
    const { service, findByUuids, findByUuid, reorder } = build(known);
    const ordered = [...uuids].reverse();
    await inContext(() => service.reorder({ moduleKey: 'contacts', orderedIds: ordered } as never));
    expect(findByUuids).toHaveBeenCalledTimes(1);
    expect(findByUuid).not.toHaveBeenCalled();
    expect(reorder).toHaveBeenCalledWith(
      tx,
      7,
      ordered.map((u) => known.get(u)!.id),
    );
  });

  it('refuses an unknown id and an id from another module without reordering', async () => {
    const mine = randomUUID();
    const other = randomUUID();
    const missing = randomUUID();
    const known = new Map([
      [mine, { id: 1, moduleKey: 'contacts' }],
      [other, { id: 2, moduleKey: 'deals' }],
    ]);
    for (const bad of [missing, other]) {
      const { service, reorder } = build(known);
      const err = await inContext(() =>
        service.reorder({ moduleKey: 'contacts', orderedIds: [mine, bad] } as never),
      ).catch((e) => e);
      expect(err).toBeInstanceOf(AppError);
      expect(reorder).not.toHaveBeenCalled();
    }
  });
});

describe('field section reorder', () => {
  it('reads the list once and refuses a section of another module', async () => {
    const a = randomUUID();
    const b = randomUUID();
    const known = new Map([
      [a, { id: 1, moduleKey: 'contacts' }],
      [b, { id: 2, moduleKey: 'deals' }],
    ]);
    const findByUuids = vi.fn(async () => known);
    const reorder = vi.fn(async () => undefined);
    const service = make<FieldSectionsService>(FieldSectionsService.prototype, {
      db,
      rbac: allow,
      repo: { findByUuids, findByUuid: vi.fn(), reorder },
    });
    await inContext(() => service.reorder({ moduleKey: 'contacts', orderedIds: [a] } as never));
    expect(reorder).toHaveBeenCalledWith(tx, 7, [1]);
    const err = await inContext(() =>
      service.reorder({ moduleKey: 'contacts', orderedIds: [a, b] } as never),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(findByUuids).toHaveBeenCalledTimes(2);
  });
});

describe('field option reorder', () => {
  it('reads the list once and refuses an option that belongs to another field', async () => {
    const mine = randomUUID();
    const foreign = randomUUID();
    const known = new Map([
      [mine, { id: 1, fieldId: 10 }],
      [foreign, { id: 2, fieldId: 99 }],
    ]);
    const findByUuids = vi.fn(async () => known);
    const reorder = vi.fn(async () => undefined);
    const service = make<FieldsService>(FieldsService.prototype, {
      db,
      rbac: allow,
      optionsRepo: { findByUuids, findByUuid: vi.fn(), reorder },
      requireField: async () => ({ id: 10, moduleKey: 'contacts' }),
    });
    await inContext(() => service.reorderOptions('f', { orderedIds: [mine] } as never));
    expect(reorder).toHaveBeenCalledWith(tx, 7, [1]);
    const err = await inContext(() =>
      service.reorderOptions('f', { orderedIds: [mine, foreign] } as never),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(findByUuids).toHaveBeenCalledTimes(2);
  });
});
