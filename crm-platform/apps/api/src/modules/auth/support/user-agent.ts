export type BrowserFamily = 'edge' | 'chrome' | 'firefox' | 'safari' | 'opera' | 'other';
export type OsFamily = 'android' | 'iphone' | 'ipad' | 'windows' | 'mac' | 'linux' | 'other';

export interface ParsedAgent {
  browser: BrowserFamily;
  os: OsFamily;
  kind: 'desktop' | 'mobile' | 'unknown';
}

/**
 * Order matters: Edge and Opera ship "Chrome" in their UA, and Chrome ships
 * "Safari". Test the specific token first.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedAgent {
  if (!ua) return { browser: 'other', os: 'other', kind: 'unknown' };
  const s = ua.toLowerCase();

  const browser: BrowserFamily =
    s.includes('edg/') || s.includes('edge/')
      ? 'edge'
      : s.includes('opr/') || s.includes('opera')
        ? 'opera'
        : s.includes('firefox/')
          ? 'firefox'
          : s.includes('chrome/') || s.includes('crios/')
            ? 'chrome'
            : s.includes('safari/')
              ? 'safari'
              : 'other';

  const os: OsFamily = s.includes('android')
    ? 'android'
    : s.includes('iphone')
      ? 'iphone'
      : s.includes('ipad')
        ? 'ipad'
        : s.includes('windows')
          ? 'windows'
          : s.includes('mac os') || s.includes('macintosh')
            ? 'mac'
            : s.includes('linux')
              ? 'linux'
              : 'other';

  const kind: ParsedAgent['kind'] =
    os === 'android' || os === 'iphone' || os === 'ipad'
      ? 'mobile'
      : os === 'other'
        ? 'unknown'
        : 'desktop';

  return { browser, os, kind };
}

const BROWSER_LABEL: Record<BrowserFamily, string> = {
  edge: 'Edge',
  chrome: 'Chrome',
  firefox: 'Firefox',
  safari: 'Safari',
  opera: 'Opera',
  other: 'Browser',
};
const OS_LABEL: Record<OsFamily, string> = {
  android: 'Android',
  iphone: 'iPhone',
  ipad: 'iPad',
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
  other: 'unknown OS',
};

export function describeAgent(ua: string | null | undefined): {
  label: string;
  kind: ParsedAgent['kind'];
} {
  const p = parseUserAgent(ua);
  return { label: `${BROWSER_LABEL[p.browser]} on ${OS_LABEL[p.os]}`, kind: p.kind };
}

/** Browser + OS, the unit the new-device alert compares. */
export const fingerprint = (ua: string | null | undefined): string => {
  const p = parseUserAgent(ua);
  return `${p.browser}/${p.os}`;
};
