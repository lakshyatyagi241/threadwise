import { describe, expect, it } from 'vitest';
import {
  customKeyOf,
  initialSwitches,
  isFullOrder,
  nameKeyOf,
  slugOf,
  unsupportedSwitches,
} from '../../../src/modules/crm/activity-types/activity-type-rules';

describe('activity type rules', () => {
  it('makes a stable key from a name', () => {
    expect(slugOf('Send proposal')).toBe('send_proposal');
    expect(slugOf('  Café -- visit!  ')).toBe('cafe_visit');
    expect(slugOf('मुलाकात')).toBe('item');
    expect(slugOf('x'.repeat(80)).length).toBe(50);
    expect(customKeyOf('Site visit')).toBe('custom_site_visit');
    expect(customKeyOf('Site visit', 1)).toBe('custom_site_visit_2');
  });

  it('compares names without case or extra spaces', () => {
    expect(nameKeyOf('  Site   VISIT ')).toBe(nameKeyOf('site visit'));
  });

  it('starts a custom activity with its behaviour defaults', () => {
    expect(initialSwitches('task')).toMatchObject({
      showInCalendar: true,
      allowComplete: true,
      mobileCheckIn: false,
      outcomesEnabled: true,
    });
    expect(initialSwitches('phone')).toMatchObject({
      showInCalendar: false,
      allowComplete: false,
      outcomesEnabled: true,
    });
  });

  it('refuses to turn on a switch the behaviour does not offer, but allows turning it off', () => {
    expect(unsupportedSwitches('task', { mobileCheckIn: true })).toEqual(['mobileCheckIn']);
    expect(unsupportedSwitches('meeting', { mobileCheckIn: true, allowComplete: true })).toEqual(
      [],
    );
    expect(unsupportedSwitches('phone', { allowComplete: true, showInCalendar: true })).toEqual([
      'showInCalendar',
      'allowComplete',
    ]);
    expect(unsupportedSwitches('other', { outcomesEnabled: false, allowComplete: false })).toEqual(
      [],
    );
  });

  it('accepts a reorder only when it names the whole list once', () => {
    expect(isFullOrder(['a', 'b', 'c'], ['c', 'a', 'b'])).toBe(true);
    expect(isFullOrder(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isFullOrder(['a', 'b'], ['a', 'a'])).toBe(false);
    expect(isFullOrder(['a', 'b'], ['a', 'x'])).toBe(false);
  });
});
