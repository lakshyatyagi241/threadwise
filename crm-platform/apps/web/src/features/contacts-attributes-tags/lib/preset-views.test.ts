import { describe, expect, it } from 'vitest';
import { segmentRulesSchema } from '@crm/contracts';
import { DEFAULT_FILTERS } from '../api/contacts';
import {
  activePreset,
  availablePresets,
  parsePresetFavorites,
  presetFilters,
  PRESET_VIEWS,
  QUICK_PRESETS,
  togglePresetFavorite,
} from './preset-views';

const ME = '11111111-1111-4111-8111-111111111111';

describe('built-in contact views', () => {
  it('every rule they write is one the API accepts', () => {
    for (const p of PRESET_VIEWS) {
      const { rules } = presetFilters(p, ME);
      if (rules) expect(segmentRulesSchema.safeParse(JSON.parse(rules)).success, p).toBe(true);
    }
  });

  it('each one is recognised again from its filters, and none from another', () => {
    for (const p of PRESET_VIEWS) {
      const f = { ...DEFAULT_FILTERS, ...presetFilters(p, ME), page: 3, limit: 50 as const };
      expect(activePreset(f, ME), p).toBe(p);
    }
    expect(activePreset(DEFAULT_FILTERS, ME)).toBeNull();
    expect(activePreset({ ...DEFAULT_FILTERS, q: 'meera' }, ME)).toBeNull();
  });

  it('they mean what their name says', () => {
    expect(presetFilters('myContacts', ME).owner).toBe(ME);
    expect(presetFilters('unsubscribed', ME).consent).toBe('unsubscribed');
    expect(presetFilters('recentlyImported', ME).imported).toBe(true);
    expect(JSON.parse(presetFilters('neverContacted', ME).rules!).children[0]).toMatchObject({
      field: 'lastActivityAt',
      operator: 'is_empty',
    });
  });

  it('Unassigned and Hot leads are plain filters: the owner filter, and a lead score in the hot band', () => {
    expect(presetFilters('unassigned', ME).owner).toBe('none');
    expect(JSON.parse(presetFilters('hotLeads', ME).rules!).children[0]).toMatchObject({
      field: 'leadScore',
      operator: 'gte',
      value: 67,
    });
  });

  it('the quick chips are six built-in views, in the order a small business reaches for them', () => {
    expect([...QUICK_PRESETS]).toEqual([
      'myContacts',
      'unassigned',
      'uncontacted',
      'newThisWeek',
      'needsFollowUp',
      'hotLeads',
    ]);
    for (const p of QUICK_PRESETS) expect(PRESET_VIEWS).toContain(p);
  });

  it('favourites are added, removed and read back, ignoring unknown names', () => {
    const one = togglePresetFavorite(null, 'active');
    expect(parsePresetFavorites(one)).toEqual(['active']);
    const two = togglePresetFavorite(one, 'inactive');
    expect(parsePresetFavorites(two)).toEqual(['active', 'inactive']);
    expect(parsePresetFavorites(togglePresetFavorite(two, 'active'))).toEqual(['inactive']);
    expect(parsePresetFavorites('active,bogus,active')).toEqual(['active']);
    expect(parsePresetFavorites(null)).toEqual([]);
  });
});

describe('built-in views while lead scoring is off', () => {
  it('drops Hot leads from the quick chips and from the picker, and nothing else', () => {
    expect(availablePresets(QUICK_PRESETS, false)).toEqual([
      'myContacts',
      'unassigned',
      'uncontacted',
      'newThisWeek',
      'needsFollowUp',
    ]);
    expect(availablePresets(PRESET_VIEWS, false)).not.toContain('hotLeads');
    expect(availablePresets(PRESET_VIEWS, false)).toHaveLength(PRESET_VIEWS.length - 1);
  });

  it('keeps them all while it is on', () => {
    expect(availablePresets(QUICK_PRESETS, true)).toEqual([...QUICK_PRESETS]);
    expect(availablePresets(PRESET_VIEWS, true)).toEqual([...PRESET_VIEWS]);
  });
});

describe('the Uncontacted view (BL-290)', () => {
  it('filters on the uncontacted marker with the rule the condition builder writes', () => {
    expect(JSON.parse(presetFilters('uncontacted', ME).rules!).children[0]).toMatchObject({
      field: 'uncontacted',
      operator: 'is_true',
    });
  });

  it('is offered only while some contact carries the marker, so an unused feature adds no chip', () => {
    expect(availablePresets(QUICK_PRESETS, true, false)).not.toContain('uncontacted');
    expect(availablePresets(PRESET_VIEWS, true, false)).not.toContain('uncontacted');
    expect(availablePresets(PRESET_VIEWS, true, false)).toHaveLength(PRESET_VIEWS.length - 1);
    expect(availablePresets(PRESET_VIEWS, true, true)).toContain('uncontacted');
  });
});
