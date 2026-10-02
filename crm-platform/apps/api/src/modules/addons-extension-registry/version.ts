/**
 * Orders two dotted version strings ("1.7.0" < "1.10.0"), numeric part by numeric part, as PHP's version_compare
 * does for the plain cases a manifest uses. A pre-release suffix ("1.2.0-beta") sorts before the release.
 * Returns <0, 0 or >0.
 */
export function compareVersions(a: string, b: string): number {
  const split = (v: string) => {
    const [core = '', pre] = v.trim().replace(/^v/i, '').split(/[-+]/, 2);
    return { nums: core.split('.').map((p) => Number.parseInt(p, 10) || 0), pre: pre ?? '' };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] ?? 0) - (y.nums[i] ?? 0);
    if (d !== 0) return d;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}
