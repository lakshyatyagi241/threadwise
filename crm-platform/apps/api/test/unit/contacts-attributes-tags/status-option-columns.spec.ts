import { describe, expect, it } from 'vitest';
import { contactColumnFor } from '../../../src/modules/crm/status-options/status-option-columns';

describe('contactColumnFor', () => {
  it('maps the contact option groups to the column that stores them', () => {
    expect(contactColumnFor('contacts', 'lifecycle_stage')).toBe('lifecycleStage');
    expect(contactColumnFor('contacts', 'status')).toBe('status');
    expect(contactColumnFor('contacts', 'contact_status')).toBe('status');
    expect(contactColumnFor('contacts', 'lost_reason')).toBe('lostReason');
  });

  it('has no column for groups no contact stores (deal and subscription statuses)', () => {
    expect(contactColumnFor('contacts', 'deal_status')).toBeNull();
    expect(contactColumnFor('contacts', 'whatsapp_subscription_status')).toBeNull();
  });

  it('never maps another module onto the contacts table', () => {
    expect(contactColumnFor('companies', 'lifecycle_stage')).toBeNull();
  });
});
