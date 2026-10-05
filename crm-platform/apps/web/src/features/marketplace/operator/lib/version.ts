import { MARKET_SEMVER_RE, compareMarketVersions } from '@crm/contracts';

const MAX_PART = 9999;

interface Parts {
  major: number;
  minor: number;
  patch: number;
  pre: string;
}

function parts(version: string): Parts | null {
  if (!MARKET_SEMVER_RE.test(version)) return null;
  const [main = '', pre = ''] = version.split('-', 2);
  const [major = 0, minor = 0, patch = 0] = main.split('.').map(Number);
  return { major, minor, patch, pre };
}

/**
 * The next version after `version`: the patch number plus one (`1.0.9` becomes `1.0.10`). A pre-release (`1.1.0-beta.2`) becomes its
 * release (`1.1.0`), which sorts higher. A part already at its four-digit limit carries into the next one. Null when `version` is not
 * `MAJOR.MINOR.PATCH` (the editor then leaves the number as it is).
 */
export function bumpPatch(version: string): string | null {
  const p = parts(version);
  if (!p) return null;
  if (p.pre) return `${p.major}.${p.minor}.${p.patch}`;
  if (p.patch < MAX_PART) return `${p.major}.${p.minor}.${p.patch + 1}`;
  if (p.minor < MAX_PART) return `${p.major}.${p.minor + 1}.0`;
  if (p.major < MAX_PART) return `${p.major + 1}.0.0`;
  return null;
}

/** The highest of the listing's version numbers (by `compareMarketVersions`), or null for none. */
export function highestVersion(versions: ReadonlyArray<{ version: string }>): string | null {
  return versions.reduce<string | null>(
    (top, v) => (top === null || compareMarketVersions(v.version, top) > 0 ? v.version : top),
    null,
  );
}

/** What a new version starts at: one above the highest existing one. */
export function nextVersionNumber(versions: ReadonlyArray<{ version: string }>): string | null {
  const top = highestVersion(versions);
  return top === null ? null : bumpPatch(top);
}

/** True when `candidate` is a valid version number higher than every number in `existing`. */
export function isHigherThanAll(candidate: string, existing: ReadonlyArray<string>): boolean {
  return (
    MARKET_SEMVER_RE.test(candidate) &&
    existing.every((v) => compareMarketVersions(candidate, v) > 0)
  );
}
