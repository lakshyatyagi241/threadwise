import { describe, expect, it } from 'vitest';
import { asTab, resolveInitialTab } from './tab-state';

describe('resolveInitialTab', () => {
  it('prefers the URL hash', () => expect(resolveInitialTab('#abuse', 'api')).toBe('abuse'));
  it('falls back to the remembered tab, then to Summary', () => {
    expect(resolveInitialTab('', 'devices')).toBe('devices');
    expect(resolveInitialTab('', null)).toBe('summary');
  });
  it('ignores unknown values', () => {
    expect(resolveInitialTab('#nope', 'also-nope')).toBe('summary');
    expect(resolveInitialTab('#nope', 'login')).toBe('login');
  });
  it('accepts the old name of the danger panel', () => {
    expect(asTab('#incidents')).toBe('danger');
    expect(asTab('danger')).toBe('danger');
  });
});
