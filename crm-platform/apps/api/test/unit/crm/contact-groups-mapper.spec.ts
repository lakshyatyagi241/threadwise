import { describe, expect, it } from 'vitest';
import { contactGroupResponseSchema } from '@crm/contracts';
import { toContactGroupResponse } from '../../../src/modules/crm/contact-groups/contact-groups.mapper';
import type { ContactGroupRow } from '../../../src/modules/crm/contact-groups/contact-groups.repository';

const ASHA = '0f4f5c1e-7a1b-4c52-9d1e-2b8f1c3a4d01';
const RAVI = '5b7e2a90-3c4d-4e8f-8a6b-9c0d1e2f3a02';

const row = (over: Partial<ContactGroupRow> = {}): ContactGroupRow => ({
  id: 7,
  uuid: '6f1c2c9e-0c1a-4a57-9a55-3d1f7e8a9b10',
  name: 'VIP',
  note: 'Top accounts',
  color: '#7C3AED',
  memberCount: 3,
  rowVersion: 2,
  createdByUuid: ASHA,
  createdByName: 'Asha Rao',
  updatedByUuid: RAVI,
  updatedByName: 'Ravi Nair',
  createdAt: new Date('2026-10-01T09:00:00.000Z'),
  updatedAt: new Date('2026-10-02T10:30:00.000Z'),
  ...over,
});

describe('toContactGroupResponse: who created and who last changed a group', () => {
  it('returns the creator and the last editor as { id, name } and validates against the contract', () => {
    const out = toContactGroupResponse(row());

    expect(out.createdBy).toEqual({ id: ASHA, name: 'Asha Rao' });
    expect(out.updatedBy).toEqual({ id: RAVI, name: 'Ravi Nair' });
    expect(contactGroupResponseSchema.safeParse(out).success).toBe(true);
  });

  it('answers null for updatedBy until the group is first changed, without a placeholder name', () => {
    const out = toContactGroupResponse(row({ updatedByUuid: null, updatedByName: null }));

    expect(out.updatedBy).toBeNull();
    expect(out.createdBy).toEqual({ id: ASHA, name: 'Asha Rao' });
  });

  it('answers null for createdBy when the creator was removed from the workspace', () => {
    const out = toContactGroupResponse(row({ createdByUuid: null, createdByName: null }));

    expect(out.createdBy).toBeNull();
  });

  it('never leaks the internal id: the row id and the person ids are uuids on the wire', () => {
    const out = toContactGroupResponse(row());

    expect(out.id).toBe('6f1c2c9e-0c1a-4a57-9a55-3d1f7e8a9b10');
    expect(out).not.toHaveProperty('createdByUuid');
    expect(out).not.toHaveProperty('updatedByName');
    expect(JSON.stringify(out)).not.toContain('"id":7');
  });
});
