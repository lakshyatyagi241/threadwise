import { describe, expect, it } from 'vitest';
import { changedFlowKeys } from '../../../src/modules/crm/contacts/contact-changed-keys';

const existing = {
  name: 'Asha Rao',
  firstName: 'Asha',
  lastName: 'Rao',
  email: 'asha@example.com',
  data: { city: 'Pune', order_id: '1234' },
};

describe('which contact properties a write changed, as a flow names them', () => {
  it('lists a core property by its flow key, only when its value really changed', () => {
    expect(changedFlowKeys(existing, { firstName: 'Ashok', lastName: 'Rao' })).toEqual([
      'first_name',
    ]);
    expect(changedFlowKeys(existing, { email: ' asha@example.com ' })).toEqual([]);
  });

  it('lists a custom property when its value changed, and not one that was written unchanged', () => {
    expect(
      changedFlowKeys(existing, { customFields: { city: 'Delhi', order_id: '1234' } }),
    ).toEqual(['city']);
    expect(changedFlowKeys(existing, { customFields: { new_key: 'x' } })).toEqual(['new_key']);
  });

  it('lists a custom property that was emptied, and nothing for an empty write', () => {
    expect(changedFlowKeys(existing, { customFields: { city: '' } })).toEqual(['city']);
    expect(changedFlowKeys(existing, {})).toEqual([]);
    expect(changedFlowKeys({ name: 'x' }, { customFields: { a: '1' } })).toEqual(['a']);
  });
});
