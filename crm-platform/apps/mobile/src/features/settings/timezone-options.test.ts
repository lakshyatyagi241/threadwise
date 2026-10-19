import { timezoneOptions } from './timezone-options';

describe('timezoneOptions', () => {
  it('lists the zones sorted, UTC included, each with its id as the label', () => {
    const options = timezoneOptions('Asia/Kolkata');
    const values = options.map((o) => o.value);
    expect(values).toContain('UTC');
    expect(values).toContain('Asia/Kolkata');
    expect(values).toEqual([...values].sort((a, b) => a.localeCompare(b)));
    expect(options.every((o) => o.value === o.label)).toBe(true);
  });

  it('always includes the saved zone, even one the phone does not list', () => {
    expect(timezoneOptions('Mars/Olympus').map((o) => o.value)).toContain('Mars/Olympus');
  });

  it('falls back to the common zones on an engine without a zone list', () => {
    const intl = Intl as { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = undefined;
    try {
      const values = timezoneOptions('').map((o) => o.value);
      expect(values).toContain('Europe/Berlin');
      expect(values.length).toBeLessThan(30);
    } finally {
      intl.supportedValuesOf = original;
    }
  });

  it('shows the modern name of a zone an engine lists under its old one', () => {
    const intl = Intl as { supportedValuesOf?: unknown };
    const original = intl.supportedValuesOf;
    intl.supportedValuesOf = () => ['Asia/Calcutta', 'Europe/London'];
    try {
      const values = timezoneOptions('').map((o) => o.value);
      expect(values).toContain('Asia/Kolkata');
      expect(values).not.toContain('Asia/Calcutta');
    } finally {
      intl.supportedValuesOf = original;
    }
  });
});
