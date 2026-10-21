import * as contracts from '@crm/contracts';
import { text, type Rng } from '../gen';
import { Violation, type Target } from '../engine';

/**
 * The pure helpers @crm/contracts exports that take a piece of user text (parsers, normalisers, link and path checks). They are named
 * here, not discovered, because most of the 465 exported functions take objects and would only prove that `undefined.x` throws. A name
 * that no longer exists is reported by the unit test of this file, so the list cannot rot silently.
 *
 * Invariant for all: a string in, no throw. For the link and path checks: what they accept, a browser resolves to the same site.
 */
export const TEXT_HELPERS: readonly string[] = [
  'isValidTimezone',
  'parseDateValue',
  'parseOtpSenderRef',
  'countryCodeDigits',
  'normalizeImportHeader',
  'parseImportBirthDate',
  'parseImportConsent',
  'normalizeMergeKey',
  'validatePositionalPlaceholders',
  'mediaExtension',
  'measureSms',
  'oneHeaderLine',
  'escapeEmailHtml',
  'templateVariablesIn',
  'isRealCalendarDate',
  'safeTimezone',
  'isValidLocale',
  'toLocalPath',
  'parseManifestText',
  'isHexColor',
  'isSafeLink',
  'isLegalSlug',
  'isSafeShortcutUrl',
  'firstName',
  'normalizeCurrencyInput',
  'normalizeGraphVersion',
  'normalizeWalletCategory',
  'normalizeWalletCountry',
  'isCalendarDay',
  'parseQty',
  'parsePercentBp',
  'parseMajor',

  'isValidTimeZone',
  'isIanaTimeZone',
  'phpInt',
  'trimLikeThreadwise',
  'trimLikePhp',
  'waString',
  'waTag',
  'parseWaGroupInviteCode',
  'normalizeShortcut',
  'canonicalVariableKey',
  'variablesIn',
  'parseTestRecipients',
  'placeholdersOf',
  'secretValuesIn',
  'isSafeFormPattern',
  'normaliseFormOrigin',
  'normaliseConsentText',
  'parseAgeAnswer',
  'parseIsoDay',
  'isZone',
  'canonicalZone',
  'isSafeNoun',
  'flbSlugify',
  'flbCleanVarName',
  'flbParseCoordinate',
  'flbIsMapsHost',
  'flbParseMapsInput',
  'flbFileExtensionOf',
  'flbCleanDateFormat',
  'flbCleanAskInputType',
  'bridgeHostAllowed',
  'isBookingPageAssetPath',
  'isChatVideoEmbed',
  'chatActionUrl',
  'chatVideoEmbedFrom',
  'launcherImageUrl',
  'isLauncherColour',
  'isMarketScope',
  'marketPackSlug',
  'isMarketEntitlementKey',
  'apiLibraryTokensOf',
  'apiLibraryIsSensitiveName',
  'majorToMicros',
  'percentToBps',
  'isMoney',
  'normaliseMoney',
  'moneyCents',
  'zonesOfPhone',
  'countryCodeOf',
  'canonicalizeLocalPhone',
  'normaliseConsentText',
  'isCmsPage',
  'isLayoutKey',
  'isPlanFeatureKey',
  'isPlanLimitKey',
  'isCustomSegmentField',
  'isCompanySegmentField',
  'customFieldKey',
  'companyFieldKey',
];

const BASE = 'https://app.example.com';

/** What a browser does with an href that starts with `/`: the origin must stay the site's own. */
function sameSite(href: string): boolean {
  try {
    return new URL(href, BASE).origin === BASE;
  } catch {
    return true; // not a URL at all: it goes nowhere
  }
}

const present = (name: string): ((...a: unknown[]) => unknown) | null => {
  const f = (contracts as Record<string, unknown>)[name];
  return typeof f === 'function' ? (f as (...a: unknown[]) => unknown) : null;
};

export function contractHelperTargets(): Target[] {
  const t: Target[] = [];
  for (const name of TEXT_HELPERS) {
    const fn = present(name);
    if (!fn) continue;
    t.push({
      name: `contracts:${name}`,
      group: 'contract-helpers',
      weight: 4,
      gen: (r: Rng) => {
        // Half the inputs start like a same-site path with something a browser reads as a second slash, which is what the link checks guard against.
        const lead = r.chance(0.5)
          ? `/${r.pick(['\\', '\t', '\n', '\r', '/', ' ', '%2f', '%5c'])}`
          : '';
        return [lead + text(r), text(r), text(r)];
      },
      run: (v) => {
        const [a, b, c] = v as [string, string, string];
        fn(a, b, c);
        if (
          name === 'isSafeLink' &&
          fn(a) === true &&
          /^(\/|#)/.test(a.trim()) &&
          !sameSite(a.trim())
        )
          throw new Violation(
            `isSafeLink accepts ${JSON.stringify(a)}, which a browser sends to ${new URL(a.trim(), BASE).origin}`,
          );
        if (name === 'isSafeShortcutUrl' && fn(a) === true && a.startsWith('/') && !sameSite(a))
          throw new Violation(
            `isSafeShortcutUrl accepts ${JSON.stringify(a)}, which a browser sends to ${new URL(a, BASE).origin}`,
          );
        if (name === 'toLocalPath') {
          const p = fn(a) as string | null;
          if (p !== null && !sameSite(p))
            throw new Violation(
              `toLocalPath returns ${JSON.stringify(p)}, which a browser sends off the site`,
            );
        }
      },
    });
  }
  return t;
}
