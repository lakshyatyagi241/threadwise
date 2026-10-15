import { describe, expect, it } from 'vitest';
import { validateMarketRecipe, type MarketRecipe } from '@crm/contracts';
import { mapDelivery } from '../../../src/infra/providers/marketplace';
import { pushRecipe } from './fixtures';

/** A recipe may map the portal's proof of consent (BL-168). A lead without a yes carries no consent object at all. */
const recipe = (consent?: Record<string, unknown>): MarketRecipe => {
  const base = pushRecipe() as unknown as { mapping: Record<string, unknown> };
  const v = validateMarketRecipe(
    pushRecipe({ mapping: { ...base.mapping, ...(consent ? { consent } : {}) } }),
  );
  if (!v.ok) throw new Error(JSON.stringify(v.problems));
  return v.recipe;
};

const rule = {
  given: { from: 'query.agreed' },
  text: { from: 'query.agree_text' },
  version: { const: 'portal-v1' },
  at: { from: 'query.agreed_at', format: 'iso' },
  formId: { from: 'query.form' },
  adId: { from: 'query.ad' },
  channels: ['whatsapp', 'sms'],
};
const item = (over: Record<string, unknown>) => ({
  queries: [{ query: { id: 'q-1', sender_name: 'Ravi', sender_mobile: '98765 43210', ...over } }],
});

describe('recipe consent mapping', () => {
  it('maps a yes with its evidence', () => {
    const out = mapDelivery(
      recipe(rule),
      item({
        agreed: 'Yes',
        agree_text: 'I agree to be contacted.',
        agreed_at: '2026-10-01T10:00:00Z',
        form: 'F-9',
        ad: 'AD-9',
      }),
    );
    expect(out.leads[0]!.consent).toEqual({
      given: true,
      text: 'I agree to be contacted.',
      version: 'portal-v1',
      at: '2026-10-01T10:00:00.000Z',
      formId: 'F-9',
      adId: 'AD-9',
      channels: ['whatsapp', 'sms'],
    });
  });

  it('a no, a blank, an unknown word or a missing value carries no consent at all', () => {
    for (const agreed of ['no', '', 'perhaps', undefined]) {
      const out = mapDelivery(recipe(rule), item({ agreed, agree_text: 'T' }));
      expect(out.leads[0]!.consent, String(agreed)).toBeUndefined();
    }
  });

  it('a recipe without a consent mapping never produces one, whatever the portal sends', () => {
    const out = mapDelivery(recipe(), item({ agreed: 'yes', agree_text: 'T' }));
    expect(out.leads[0]!.consent).toBeUndefined();
  });

  it('keeps the whole wording up to 2000 characters, not the 200 of a campaign name', () => {
    const out = mapDelivery(recipe(rule), item({ agreed: true, agree_text: 'w'.repeat(3000) }));
    expect(out.leads[0]!.consent!.text).toHaveLength(2000);
  });

  it('refuses an unknown key in the consent block', () => {
    const base = pushRecipe() as unknown as { mapping: Record<string, unknown> };
    const v = validateMarketRecipe(
      pushRecipe({ mapping: { ...base.mapping, consent: { ...rule, grantAlways: true } } }),
    );
    expect(v.ok).toBe(false);
  });
});
