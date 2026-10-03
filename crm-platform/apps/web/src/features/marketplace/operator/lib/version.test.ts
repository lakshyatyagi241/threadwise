import { describe, expect, it } from 'vitest';
import { MARKET_SEMVER_RE, compareMarketVersions } from '@crm/contracts';
import { bumpPatch, highestVersion, isHigherThanAll, nextVersionNumber } from './version';

describe('bumpPatch', () => {
  it('raises the patch number', () => {
    expect(bumpPatch('1.0.0')).toBe('1.0.1');
    expect(bumpPatch('1.0.9')).toBe('1.0.10');
    expect(bumpPatch('0.1.0')).toBe('0.1.1');
  });

  it('turns a pre-release into its release, which is higher', () => {
    expect(bumpPatch('1.1.0-beta.2')).toBe('1.1.0');
    expect(compareMarketVersions('1.1.0', '1.1.0-beta.2')).toBeGreaterThan(0);
  });

  it('carries over a part at its four-digit limit and stays a valid version', () => {
    expect(bumpPatch('1.0.9999')).toBe('1.1.0');
    expect(bumpPatch('1.9999.9999')).toBe('2.0.0');
    expect(bumpPatch('9999.9999.9999')).toBeNull();
    expect(MARKET_SEMVER_RE.test(bumpPatch('1.0.9999')!)).toBe(true);
  });

  it('answers null for something that is not a version', () => {
    expect(bumpPatch('v1.0.0')).toBeNull();
    expect(bumpPatch('1.0')).toBeNull();
    expect(bumpPatch('')).toBeNull();
  });

  it('always gives a version higher than the one it started from', () => {
    for (const v of ['0.0.0', '1.2.3', '10.20.30', '1.0.0-alpha', '2.0.0-rc.1']) {
      const next = bumpPatch(v)!;
      expect(compareMarketVersions(next, v), v).toBeGreaterThan(0);
    }
  });
});

describe('highest and next version of a listing', () => {
  const versions = [{ version: '1.0.0' }, { version: '1.10.0' }, { version: '1.2.0' }];

  it('compares numbers, not text (1.10.0 is above 1.2.0)', () => {
    expect(highestVersion(versions)).toBe('1.10.0');
    expect(nextVersionNumber(versions)).toBe('1.10.1');
  });

  it('has none for a listing without versions', () => {
    expect(highestVersion([])).toBeNull();
    expect(nextVersionNumber([])).toBeNull();
  });

  it('isHigherThanAll needs a valid number above every earlier one', () => {
    expect(
      isHigherThanAll(
        '1.10.1',
        versions.map((v) => v.version),
      ),
    ).toBe(true);
    expect(
      isHigherThanAll(
        '1.10.0',
        versions.map((v) => v.version),
      ),
    ).toBe(false);
    expect(
      isHigherThanAll(
        '2.0',
        versions.map((v) => v.version),
      ),
    ).toBe(false);
    expect(isHigherThanAll('0.0.1', [])).toBe(true);
  });
});
