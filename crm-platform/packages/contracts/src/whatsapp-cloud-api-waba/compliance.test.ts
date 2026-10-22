import { describe, expect, it } from 'vitest';
import { updateComplianceInfoInputSchema, WABA_LOGO_TYPES } from './connections';

const contact = { email: '', mobile: '', landline: '' };
const base = {
  entityName: 'Acme Pvt Ltd',
  entityType: 'PRIVATE_COMPANY',
  customerCare: { ...contact, email: 'care@acme.example' },
  grievanceOfficer: { ...contact, name: 'Asha Rao', mobile: '+919876543210' },
} as const;

const issuesOf = (input: unknown) => {
  const r = updateComplianceInfoInputSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('updateComplianceInfoInputSchema', () => {
  it('takes a company with one customer-care and one grievance contact', () => {
    expect(updateComplianceInfoInputSchema.safeParse(base).success).toBe(true);
  });

  it('asks for the custom type only when the type is Other', () => {
    expect(issuesOf({ ...base, entityType: 'OTHER', isRegistered: true })).toContain(
      'entityTypeCustom: Enter the business type',
    );
    expect(
      updateComplianceInfoInputSchema.safeParse({
        ...base,
        entityType: 'OTHER',
        entityTypeCustom: 'Trust',
        isRegistered: false,
      }).success,
    ).toBe(true);
  });

  it('asks whether the business is registered only for partnerships and Other', () => {
    expect(issuesOf({ ...base, entityType: 'PARTNERSHIP' })).toContain(
      'isRegistered: Say whether the business is registered',
    );
    expect(issuesOf({ ...base, entityType: 'SOLE_PROPRIETORSHIP', isRegistered: true })).toContain(
      'isRegistered: Only asked for partnerships and other types',
    );
    expect(
      updateComplianceInfoInputSchema.safeParse({
        ...base,
        entityType: 'PARTNERSHIP',
        isRegistered: true,
      }).success,
    ).toBe(true);
  });

  it('needs one way to reach each side, email, mobile or landline', () => {
    const noCare = { ...base, customerCare: contact };
    expect(issuesOf(noCare)).toContain(
      'customerCare: Enter an email, a mobile or a landline for customer care',
    );
    const noOfficer = { ...base, grievanceOfficer: { ...contact, name: 'Asha Rao' } };
    expect(issuesOf(noOfficer)).toContain(
      'grievanceOfficer: Enter an email, a mobile or a landline for the grievance officer',
    );
  });

  it('needs the legal name and the grievance officer name', () => {
    expect(issuesOf({ ...base, entityName: '  ' })).toContain(
      'entityName: Enter the legal name of the business',
    );
    expect(
      issuesOf({ ...base, grievanceOfficer: { ...base.grievanceOfficer, name: '' } }),
    ).toContain('grievanceOfficer.name: Enter the grievance officer name');
  });

  it('takes phone numbers only with a country code that Meta would accept', () => {
    const withMobile = (mobile: string) => ({
      ...base,
      customerCare: { ...base.customerCare, mobile },
    });
    expect(issuesOf(withMobile('98765 43210'))).toContain(
      'customerCare.mobile: Enter the number with its country code, starting with +',
    );
    expect(issuesOf(withMobile('+91 1'))).toContain(
      'customerCare.mobile: Enter a valid number with its country code',
    );
    expect(issuesOf(withMobile('+919876543210'))).toEqual([]);
  });

  it('checks the email shape and rejects an unknown entity type', () => {
    expect(issuesOf({ ...base, customerCare: { ...contact, email: 'care@acme' } })).toContain(
      'customerCare.email: Enter a complete email address',
    );
    expect(issuesOf({ ...base, entityType: 'TRUST' })).not.toEqual([]);
  });
});

describe('profile picture limits', () => {
  it('takes only the JPG and PNG types Meta takes for a profile picture', () => {
    expect([...WABA_LOGO_TYPES]).toEqual(['image/jpeg', 'image/png']);
  });
});
