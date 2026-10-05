import { describe, expect, it, vi } from 'vitest';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../src/common/context/request-context';
import {
  blankFills,
  clean,
  ContactResolverService,
} from '../../../src/modules/crm/contacts/contact-resolver.service';

/** A transaction whose savepoint just runs the callback, and whose queries answer from a queue. */
function fakeTx(rows: unknown[][] = []) {
  const queue = [...rows];
  const tx = {
    transaction: vi.fn(async (fn: (sp: unknown) => Promise<unknown>) => fn(tx)),
    execute: vi.fn(async () => ({ rows: queue.shift() ?? [] })),
  };
  return tx as unknown as Tx & {
    transaction: ReturnType<typeof vi.fn>;
    execute: ReturnType<typeof vi.fn>;
  };
}

function build(opts: {
  resolved?: unknown;
  resolveThrows?: boolean;
  tag?: { id: number } | undefined;
  tagCap?: number;
  tagCount?: number;
  emailHolder?: number;
}) {
  const contacts = {
    resolveOrCreateByIdentity: opts.resolveThrows
      ? vi.fn().mockRejectedValue(new Error('boom'))
      : vi.fn().mockResolvedValue(opts.resolved),
  };
  const repo = {
    findByIdentity: vi.fn().mockResolvedValue(opts.emailHolder),
    addIdentity: vi.fn().mockResolvedValue(undefined),
    updateFieldsById: vi.fn().mockResolvedValue(true),
  };
  const tags = {
    findByName: vi.fn().mockResolvedValue(opts.tag),
    countAll: vi.fn().mockResolvedValue(opts.tagCount ?? 0),
    insertIfAbsent: vi.fn().mockResolvedValue({ id: 9, uuid: 'u' }),
    attach: vi.fn().mockResolvedValue([]),
  };
  const entitlements = { limit: vi.fn().mockResolvedValue(opts.tagCap ?? 0) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const outbox = { emit: vi.fn().mockResolvedValue(undefined) };
  const svc = new ContactResolverService(
    contacts as never,
    repo as never,
    tags as never,
    entitlements as never,
    audit as never,
    outbox as never,
  );
  return { svc, contacts, repo, tags, entitlements, audit, outbox };
}

describe('ContactResolverService.findOrCreateByPhone', () => {
  it('skips a missing or unusable phone without touching the database', async () => {
    const { svc, contacts } = build({});
    const tx = fakeTx();
    expect(await svc.findOrCreateByPhone(tx, 1, { phone: null, source: 'store' })).toEqual({
      outcome: 'skipped',
      reason: 'no_phone',
    });
    expect(await svc.findOrCreateByPhone(tx, 1, { phone: '   ', source: 'store' })).toEqual({
      outcome: 'skipped',
      reason: 'no_phone',
    });
    expect(await svc.findOrCreateByPhone(tx, 1, { phone: '12-34', source: 'store' })).toEqual({
      outcome: 'skipped',
      reason: 'unusable_phone',
    });
    expect(contacts.resolveOrCreateByIdentity).not.toHaveBeenCalled();
    expect(tx.transaction).not.toHaveBeenCalled();
  });

  it('returns the existing contact of the number (found) and creates nothing', async () => {
    const { svc, contacts, tags } = build({
      resolved: { outcome: 'found', contactId: 5, uuid: 'c-5' },
      tag: { id: 3 },
    });
    const r = await svc.findOrCreateByPhone(fakeTx(), 1, {
      phone: '919876543210',
      source: 'store',
      tag: 'Store customer',
    });
    expect(r).toEqual({ outcome: 'found', contactId: 5, contactUuid: 'c-5' });
    expect(contacts.resolveOrCreateByIdentity).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ kind: 'phone', value: '919876543210', source: 'store' }),
    );
    expect(tags.attach).toHaveBeenCalledWith(expect.anything(), 1, [5], [3], null);
    expect(tags.insertIfAbsent).not.toHaveBeenCalled();
  });

  it('creates the contact when the number is new, with the order buyer details', async () => {
    const { svc, contacts } = build({
      resolved: { outcome: 'created', contactId: 8, uuid: 'c-8' },
    });
    const r = await svc.findOrCreateByPhone(fakeTx(), 1, {
      phone: '+919876500000',
      name: '  Asha  ',
      source: 'store',
    });
    expect(r).toEqual({ outcome: 'created', contactId: 8, contactUuid: 'c-8' });
    expect(contacts.resolveOrCreateByIdentity).toHaveBeenCalledWith(
      expect.anything(),
      1,
      expect.objectContaining({ name: 'Asha', source: 'store' }),
    );
  });

  it('places the order anyway when the plan is out of contacts: skipped, no contact, no tag', async () => {
    const { svc, tags } = build({ resolved: { outcome: 'quota_reached' } });
    const r = await svc.findOrCreateByPhone(fakeTx(), 1, {
      phone: '919876543210',
      source: 'store',
      tag: 'Store customer',
    });
    expect(r).toEqual({ outcome: 'skipped', reason: 'plan_limit_reached' });
    expect(tags.attach).not.toHaveBeenCalled();
  });

  it('never throws: an error in the savepoint is a skipped link', async () => {
    const { svc } = build({ resolveThrows: true });
    expect(
      await svc.findOrCreateByPhone(fakeTx(), 1, { phone: '919876543210', source: 'store' }),
    ).toEqual({ outcome: 'skipped', reason: 'error' });
  });

  it('runs as the system actor of the order organization when the caller has no staff context', async () => {
    const { svc, contacts } = build({ resolved: { outcome: 'found', contactId: 1, uuid: 'c' } });
    let seen: unknown;
    contacts.resolveOrCreateByIdentity.mockImplementation(async () => {
      seen = RequestContextStore.peek();
      return { outcome: 'found', contactId: 1, uuid: 'c' };
    });
    await svc.findOrCreateByPhone(fakeTx(), 42, { phone: '919876543210', source: 'store' });
    expect(seen).toMatchObject({ orgId: 42, actorType: 'system', userId: null });
  });

  it('skips the label when the workspace is at its tag cap, and creates it otherwise', async () => {
    const capped = build({
      resolved: { outcome: 'found', contactId: 5, uuid: 'c' },
      tagCap: 3,
      tagCount: 3,
    });
    await capped.svc.findOrCreateByPhone(fakeTx(), 1, {
      phone: '919876543210',
      source: 'store',
      tag: 'Store customer',
    });
    expect(capped.tags.insertIfAbsent).not.toHaveBeenCalled();
    expect(capped.tags.attach).not.toHaveBeenCalled();

    const free = build({ resolved: { outcome: 'found', contactId: 5, uuid: 'c' }, tagCap: 0 });
    free.tags.findByName.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ id: 9 });
    await free.svc.findOrCreateByPhone(fakeTx(), 1, {
      phone: '919876543210',
      source: 'store',
      tag: 'Store customer',
    });
    expect(free.tags.insertIfAbsent).toHaveBeenCalled();
    expect(free.tags.attach).toHaveBeenCalledWith(expect.anything(), 1, [5], [9], null);
  });

  it('fills only the blanks of an existing contact and audits the change', async () => {
    const { svc, repo, audit, outbox } = build({
      resolved: { outcome: 'found', contactId: 5, uuid: 'c-5' },
    });
    // 1st query: the contact row (name set, email and address blank); 2nd: no other contact holds the email
    const tx = fakeTx([[{ name: 'Curated', email: null, address: null }], []]);
    await svc.findOrCreateByPhone(tx, 1, {
      phone: '919876543210',
      name: 'Order Name',
      email: ' Buyer@Example.com ',
      address: '12 Main St',
      source: 'store',
    });
    expect(repo.updateFieldsById).toHaveBeenCalledWith(expect.anything(), 1, 5, {
      email: 'buyer@example.com',
      address: '12 Main St',
      updatedBy: null,
    });
    expect(repo.addIdentity).toHaveBeenCalledWith(
      expect.anything(),
      1,
      5,
      'email',
      'buyer@example.com',
    );
    expect(audit.record).toHaveBeenCalled();
    expect(outbox.emit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ eventType: 'contact.updated' }),
    );
  });

  it('does not steal an email another contact holds', async () => {
    const { svc, repo } = build({
      resolved: { outcome: 'found', contactId: 5, uuid: 'c-5' },
      emailHolder: 99,
    });
    const tx = fakeTx([[{ name: 'X', email: null, address: 'a' }], []]);
    await svc.findOrCreateByPhone(tx, 1, {
      phone: '919876543210',
      email: 'taken@example.com',
      source: 'store',
    });
    expect(repo.updateFieldsById).not.toHaveBeenCalled();
    expect(repo.addIdentity).not.toHaveBeenCalled();
  });
});

describe('blankFills / clean', () => {
  it('fills a blank, never a curated value', () => {
    const row = { name: 'Kept', email: '', address: null };
    expect(blankFills(row, { name: 'New', email: 'a@b.c', address: 'Street' })).toEqual({
      email: 'a@b.c',
      address: 'Street',
    });
    expect(blankFills(row, { name: null, email: null, address: null })).toEqual({});
  });

  it('trims text and turns blanks into null', () => {
    expect(clean('  x ')).toBe('x');
    expect(clean('   ')).toBeNull();
    expect(clean(undefined)).toBeNull();
  });
});
