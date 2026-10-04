import { describe, expect, it } from 'vitest';
import {
  corsIsClosedInProduction,
  corsOriginFor,
} from '../../../src/modules/platform-infrastructure';

describe('corsOriginFor', () => {
  it.each(['production', 'development', 'test'])('uses the configured list in %s', (env) => {
    expect(corsOriginFor(['https://desk.example', 'https://app.example'], env)).toEqual([
      'https://desk.example',
      'https://app.example',
    ]);
  });

  it('allows any origin with no list in development and test, for local work', () => {
    expect(corsOriginFor([], 'development')).toBe(true);
    expect(corsOriginFor([], 'test')).toBe(true);
  });

  it('allows no origin with no list in production: a missing variable must not open credentialed CORS', () => {
    expect(corsOriginFor([], 'production')).toBe(false);
  });

  it('returns a copy, so the caller cannot mutate the parsed configuration', () => {
    const list = ['https://a.example'];
    expect(corsOriginFor(list, 'production')).not.toBe(list);
  });
});

describe('corsIsClosedInProduction', () => {
  it('flags only the empty-list production case', () => {
    expect(corsIsClosedInProduction([], 'production')).toBe(true);
    expect(corsIsClosedInProduction(['https://a.example'], 'production')).toBe(false);
    expect(corsIsClosedInProduction([], 'development')).toBe(false);
  });
});
