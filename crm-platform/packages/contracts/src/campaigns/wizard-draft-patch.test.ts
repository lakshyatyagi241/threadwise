import { describe, expect, it } from 'vitest';
import { saveWizardDraftSchema, updateWizardDraftSchema } from './broadcast-wizard';

const TEMPLATE = 'f456cd6b-1fe9-4030-bf91-e5e0177dd388';

describe('wizard draft patch', () => {
  // The server spreads the parsed patch over the saved draft, so a key the patch did not send must stay out of it. A default
  // hidden behind a transform put `name: ''` in every patch and wiped the campaign name on the first autosave after Step 1.
  it('leaves out the name when the patch does not send it', () => {
    expect(saveWizardDraftSchema.parse({ templateId: TEMPLATE })).toEqual({ templateId: TEMPLATE });
    expect(updateWizardDraftSchema.parse({ templateId: TEMPLATE, rowVersion: 2 })).toEqual({
      templateId: TEMPLATE,
      rowVersion: 2,
    });
  });

  it('still trims and caps a name that is sent', () => {
    expect(saveWizardDraftSchema.parse({ name: '  Diwali offer  ' }).name).toBe('Diwali offer');
    expect(saveWizardDraftSchema.parse({ name: 'x'.repeat(300) }).name).toHaveLength(100);
  });
});
