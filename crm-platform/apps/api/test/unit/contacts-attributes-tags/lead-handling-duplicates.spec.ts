import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_DEFAULTS,
  mergeDuplicateSettings,
  updateDuplicateSettingsSchema,
} from '@crm/contracts';

describe('duplicate leads settings (BL-292)', () => {
  it('the defaults are the behaviour from before the setting existed: merge, no note', () => {
    expect(DUPLICATE_DEFAULTS).toEqual({ mode: 'merge', noteOnMerge: false });
    expect(mergeDuplicateSettings(undefined)).toEqual(DUPLICATE_DEFAULTS);
    expect(mergeDuplicateSettings(null)).toEqual(DUPLICATE_DEFAULTS);
  });

  it('a stored document is merged field by field over the defaults, and junk falls back', () => {
    expect(mergeDuplicateSettings({ mode: 'create_new' })).toEqual({
      mode: 'create_new',
      noteOnMerge: false,
    });
    expect(mergeDuplicateSettings({ noteOnMerge: true })).toEqual({
      mode: 'merge',
      noteOnMerge: true,
    });
    expect(mergeDuplicateSettings({ mode: 'overwrite', noteOnMerge: 'yes' })).toEqual(
      DUPLICATE_DEFAULTS,
    );
  });

  it('the update document needs both fields and refuses an unknown mode', () => {
    expect(
      updateDuplicateSettingsSchema.safeParse({ mode: 'merge', noteOnMerge: true }).success,
    ).toBe(true);
    expect(updateDuplicateSettingsSchema.safeParse({ mode: 'merge' }).success).toBe(false);
    expect(
      updateDuplicateSettingsSchema.safeParse({ mode: 'overwrite', noteOnMerge: false }).success,
    ).toBe(false);
    expect(
      updateDuplicateSettingsSchema.safeParse({ mode: 'merge', noteOnMerge: false, rowVersion: 0 })
        .success,
    ).toBe(false);
  });
});
