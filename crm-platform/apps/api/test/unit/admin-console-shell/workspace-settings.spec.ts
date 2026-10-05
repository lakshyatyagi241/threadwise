import { describe, expect, it } from 'vitest';
import {
  csvCell,
  csvRow,
  defaultCategoryFlags,
  defaultEventFlags,
  effectiveEventFlags,
  normalizeFlags,
} from '@crm/contracts';
import {
  isKnownTimeZone,
  ownerMay,
  sameName,
} from '../../../src/modules/admin-console-shell/workspace-settings-rules';

describe('workspace settings rules (TW-ASHELL-033, 038, 043, 044)', () => {
  it('knows IANA zones and rejects made-up ones', () => {
    expect(isKnownTimeZone('Asia/Kolkata')).toBe(true);
    expect(isKnownTimeZone('UTC')).toBe(true);
    expect(isKnownTimeZone('Mars/Base')).toBe(false);
  });

  it('lets the owner manage, and an administrator only when the workspace records no owner', () => {
    expect(ownerMay({ is_owner: true, has_owner: true, is_admin: false })).toBe(true);
    expect(ownerMay({ is_owner: false, has_owner: true, is_admin: true })).toBe(false);
    expect(ownerMay({ is_owner: false, has_owner: false, is_admin: true })).toBe(true);
    expect(ownerMay({ is_owner: false, has_owner: false, is_admin: false })).toBe(false);
  });

  it('compares the typed workspace name exactly, trimming spaces but not case', () => {
    expect(sameName('  Acme Co ', 'Acme Co')).toBe(true);
    expect(sameName('acme co', 'Acme Co')).toBe(false);
  });

  it('defaults to a quiet email and a lit bell for critical events, in-app only for categories', () => {
    expect(defaultEventFlags('sla_breached')).toEqual({ inapp: true, email: true, slack: true });
    expect(defaultEventFlags('flow_started')).toEqual({ inapp: true, email: false, slack: false });
    expect(defaultEventFlags('weekly_summary')).toEqual({
      inapp: false,
      email: true,
      slack: false,
    });
    expect(defaultCategoryFlags()).toEqual({ inapp: true, email: false, slack: false });
  });

  it('uses the stored choice over the default, and treats a missing channel as off', () => {
    const stored = {
      events: { payment_failed: { inapp: true, email: false, slack: false } },
      categories: {},
    };
    expect(effectiveEventFlags(stored, 'payment_failed').email).toBe(false);
    expect(effectiveEventFlags(stored, 'device_disconnected').email).toBe(true);
    expect(effectiveEventFlags(undefined, 'device_disconnected').email).toBe(true);
    expect(normalizeFlags({ email: true })).toEqual({ inapp: false, email: true, slack: false });
  });

  it('writes CSV cells that survive commas, quotes, line breaks and spreadsheet formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell(null)).toBe('');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1 555')).toBe("'+1 555");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@cmd')).toBe("'@cmd");
    expect(csvCell(42)).toBe('42');
    expect(csvRow(['a', null, 'b,c'])).toBe('a,,"b,c"\n');
  });
});
