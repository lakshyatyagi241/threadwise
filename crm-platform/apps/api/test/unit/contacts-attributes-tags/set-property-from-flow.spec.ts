import { describe, expect, it, vi } from 'vitest';
import { ContactsService } from '../../../src/modules/crm/contacts/contacts.service';

/**
 * "Also save the answer on the contact property" (ask, list, buttons, file nodes) goes through `setPropertyFromFlow`. A built-in
 * contact column such as `email` used to match no active custom field and was refused, so the answer was never written. It is now
 * written by the same path as the "Update contact field" step (`setFieldFromFlow`); a custom property still goes through its own
 * active-field check. The write paths themselves are covered by the e2e suites; this checks the routing.
 */
function harness(fieldResult: { stored: string } | null) {
  const setFieldFromFlow = vi.fn(async () => fieldResult);
  const txAs = vi.fn(async () => false);
  const service = Object.create(ContactsService.prototype) as ContactsService;
  Object.assign(service, { db: { txAs }, setFieldFromFlow });
  return { service, setFieldFromFlow, txAs };
}

describe('setPropertyFromFlow routing', () => {
  it('writes a built-in contact column through setFieldFromFlow and reports success', async () => {
    const { service, setFieldFromFlow, txAs } = harness({ stored: 'a@b.co' });
    const done = await service.setPropertyFromFlow(7, 42, ' email ', 'a@b.co');
    expect(done).toBe(true);
    expect(setFieldFromFlow).toHaveBeenCalledWith(7, 42, 'email', 'a@b.co');
    expect(txAs).not.toHaveBeenCalled();
  });

  it('reports failure when the contact column write returns nothing (no such contact)', async () => {
    const { service } = harness(null);
    expect(await service.setPropertyFromFlow(7, 42, 'name', 'Asha')).toBe(false);
  });

  it('keeps a custom property on its own active-field path', async () => {
    const { service, setFieldFromFlow, txAs } = harness({ stored: 'x' });
    expect(await service.setPropertyFromFlow(7, 42, 'plan', 'gold')).toBe(false);
    expect(setFieldFromFlow).not.toHaveBeenCalled();
    expect(txAs).toHaveBeenCalledTimes(1);
  });

  it('does not treat an inherited object key as a contact column', async () => {
    const { service, setFieldFromFlow, txAs } = harness({ stored: 'x' });
    await service.setPropertyFromFlow(7, 42, 'constructor', 'x');
    expect(setFieldFromFlow).not.toHaveBeenCalled();
    expect(txAs).toHaveBeenCalledTimes(1);
  });

  it('refuses an empty key without touching the database', async () => {
    const { service, setFieldFromFlow, txAs } = harness({ stored: 'x' });
    expect(await service.setPropertyFromFlow(7, 42, '   ', 'x')).toBe(false);
    expect(setFieldFromFlow).not.toHaveBeenCalled();
    expect(txAs).not.toHaveBeenCalled();
  });
});
