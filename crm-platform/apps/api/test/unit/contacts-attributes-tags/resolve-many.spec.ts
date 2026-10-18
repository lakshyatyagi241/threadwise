import { describe, expect, it, vi } from 'vitest';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service';

/**
 * `resolveManyByIdentity` answers every phone number or email that already belongs to a contact from two queries for the whole list, and
 * sends only the unknown ones through the existing single `resolveOrCreateByIdentity` (QA task 43: the WhatsApp address-book sync and the
 * campaign audience used to run the full path, with a lock and four queries, for every number). The single call keeps locking, healing,
 * quota, stage defaults, audit and outbox, so those are not re-tested here; this checks what the batch adds: the query count, the order, and
 * that the shortcut answers exactly what the single call would.
 */
type Known = Record<string, { id: number; uuid: string }>; // key "kind|value"

function harness(known: Known) {
  const contactsByIdentities = vi.fn(async () => new Map(Object.entries(known)));
  const single = vi.fn(async (_tx: unknown, _org: number, input: { value: string }) => ({
    outcome: 'created' as const,
    contactId: 900 + Number(input.value.replace(/\D/g, '').slice(-2)),
    uuid: `new-${input.value}`,
  }));
  const fillBlankName = vi.fn(async () => undefined);
  const service = Object.create(ContactsService.prototype) as ContactsService;
  Object.assign(service, {
    repo: { contactsByIdentities },
    resolveOrCreateByIdentity: single,
    fillBlankName,
  });
  const run = (inputs: Array<Record<string, unknown>>) =>
    service.resolveManyByIdentity({} as never, 7, inputs as never);
  return { run, contactsByIdentities, single, fillBlankName };
}

const phone = (n: string, extra: Record<string, unknown> = {}) => ({
  kind: 'phone',
  value: n,
  ...extra,
});

describe('resolveManyByIdentity', () => {
  it('500 numbers that are all contacts already cost one identity read and no single resolves', async () => {
    const known: Known = {};
    const inputs = Array.from({ length: 500 }, (_, i) => {
      const n = `+91981000${String(i).padStart(4, '0')}`;
      known[`phone|${n}`] = { id: i + 1, uuid: `u${i}` };
      return phone(n);
    });
    const h = harness(known);
    const out = await h.run(inputs);
    expect(h.contactsByIdentities).toHaveBeenCalledTimes(1);
    expect(h.single).not.toHaveBeenCalled();
    expect(out).toHaveLength(500);
    expect(out[0]).toEqual({ outcome: 'found', contactId: 1, uuid: 'u0' });
    expect(out[499]).toEqual({ outcome: 'found', contactId: 500, uuid: 'u499' });
  });

  it('only the unknown numbers go through the full create path, and the answers keep the input order', async () => {
    const h = harness({ 'phone|+919810000001': { id: 11, uuid: 'known-1' } });
    const out = await h.run([
      phone('+919810000002'),
      phone('+919810000001'),
      phone('+919810000003'),
    ]);
    expect(h.single).toHaveBeenCalledTimes(2);
    expect(out.map((o) => (o as { uuid?: string }).uuid)).toEqual([
      'new-+919810000002',
      'known-1',
      'new-+919810000003',
    ]);
  });

  it('writes a number the same way the single call does, so a differently written number is still found', async () => {
    const h = harness({ 'phone|+919810000001': { id: 11, uuid: 'known-1' } });
    const out = await h.run([phone('+91 98100 00001')]);
    expect((out[0] as { uuid: string }).uuid).toBe('known-1');
    expect(h.single).not.toHaveBeenCalled();
  });

  it('an email is matched trimmed and lower-cased', async () => {
    const h = harness({ 'email|a@b.test': { id: 5, uuid: 'e5' } });
    const out = await h.run([{ kind: 'email', value: '  A@B.test ' }]);
    expect(out[0]).toEqual({ outcome: 'found', contactId: 5, uuid: 'e5' });
    expect(h.single).not.toHaveBeenCalled();
  });

  it('a quiet input with a name fills a blank name on the contact it found, as the single call does', async () => {
    const h = harness({ 'phone|+919810000001': { id: 11, uuid: 'k' } });
    await h.run([phone('+919810000001', { quiet: true, name: 'Asha' }), phone('+919810000001')]);
    expect(h.fillBlankName).toHaveBeenCalledTimes(1);
    expect(h.fillBlankName).toHaveBeenCalledWith({}, 7, 11, 'Asha');
  });

  it('an unusable number, a channel id and an unknown number are all left to the single call', async () => {
    const h = harness({});
    await h.run([
      phone('not a number'),
      { kind: 'channel_uid', value: 'tg-1', channel: 'telegram' },
      phone('+919810000009'),
    ]);
    expect(h.single).toHaveBeenCalledTimes(3);
  });

  it('a number repeated in one call reaches the single call both times, so the second finds the contact the first made', async () => {
    const h = harness({});
    await h.run([phone('+919810000007'), phone('+919810000007')]);
    expect(h.single).toHaveBeenCalledTimes(2);
  });

  it('an empty list returns an empty list', async () => {
    const h = harness({});
    expect(await h.run([])).toEqual([]);
    expect(h.single).not.toHaveBeenCalled();
  });
});
