import { z } from 'zod';

/**
 * What a workspace's one Google account can be used for (the `/google-account` page, the flow builder's Google nodes, the appointments
 * calendar). Reference asked for every scope in one consent (calendar, spreadsheets, documents, full drive, forms) and failed later,
 * quietly, when one was missing. Here each capability is its own consent step: the connection starts with what the admin ticks and a
 * later "Add permission" asks Google only for the new scopes (`include_granted_scopes`), so the account holds the union.
 *
 * `restricted` marks Google's RESTRICTED scopes: a platform that stores restricted-scope data must pass Google's app verification and a
 * security assessment before it can go past 100 users (docs/runbooks/google-workspace-setup.md). Everything else is sensitive.
 */
export const GOOGLE_CAPABILITIES = [
  'calendar',
  'sheets',
  'docs',
  'forms',
  'drive_listing',
] as const;
export const googleCapabilitySchema = z.enum(GOOGLE_CAPABILITIES);
export type GoogleCapability = z.infer<typeof googleCapabilitySchema>;

/** `openid` and `email` ride along with every consent: they are how the page shows which account is connected. */
export const GOOGLE_IDENTITY_SCOPES = ['openid', 'email'] as const;

const AUTH = 'https://www.googleapis.com/auth';

/**
 * The scopes each capability needs, and nothing broader:
 *  - `calendar`: write booking and Meet events, read busy time, list the account's calendars (not the full `calendar` scope).
 *  - `sheets`: the Google Sheets nodes read and append rows of a sheet the flow author names.
 *  - `docs`: copy a template document, fill its placeholders, share the copy. The copy of a user-owned template needs full `drive`.
 *  - `forms`: the Google Form node reads a form's public responder link.
 *  - `drive_listing`: only the node pickers (list the account's sheets, documents and forms by name); without it the author pastes the link.
 */
export const GOOGLE_CAPABILITY_SCOPES: Record<GoogleCapability, readonly string[]> = {
  calendar: [
    `${AUTH}/calendar.events`,
    `${AUTH}/calendar.freebusy`,
    `${AUTH}/calendar.calendarlist.readonly`,
  ],
  sheets: [`${AUTH}/spreadsheets`],
  docs: [`${AUTH}/documents`, `${AUTH}/drive`],
  forms: [`${AUTH}/forms.body.readonly`],
  drive_listing: [`${AUTH}/drive.metadata.readonly`],
};

/** Scopes Google classes as restricted (verification plus a security assessment). */
export const GOOGLE_RESTRICTED_SCOPES: readonly string[] = [
  `${AUTH}/drive`,
  `${AUTH}/drive.metadata.readonly`,
];

export const googleCapabilityRestricted = (cap: GoogleCapability): boolean =>
  GOOGLE_CAPABILITY_SCOPES[cap].some((s) => GOOGLE_RESTRICTED_SCOPES.includes(s));

/** The consent scope list for a set of capabilities, identity first, no repeats. */
export function googleScopesFor(capabilities: readonly GoogleCapability[]): string[] {
  const out = new Set<string>(GOOGLE_IDENTITY_SCOPES);
  for (const cap of capabilities) for (const s of GOOGLE_CAPABILITY_SCOPES[cap]) out.add(s);
  return [...out];
}

/** The capabilities a space-separated scope string (what Google reports as granted) fully covers. Google may report a broader scope. */
export function googleCapabilitiesOf(scopeString: string | null | undefined): GoogleCapability[] {
  const granted = new Set((scopeString ?? '').split(/\s+/).filter(Boolean));
  // Full `drive` also lists files, so it covers the picker; the `spreadsheets` scope is not implied by anything else.
  const covers = (scope: string) =>
    granted.has(scope) ||
    (scope === `${AUTH}/drive.metadata.readonly` && granted.has(`${AUTH}/drive`));
  return GOOGLE_CAPABILITIES.filter((cap) => GOOGLE_CAPABILITY_SCOPES[cap].every(covers));
}

/** Scopes of the requested capabilities that the grant does not cover. */
export function googleMissingScopes(
  scopeString: string | null | undefined,
  capabilities: readonly GoogleCapability[],
): string[] {
  const have = new Set(googleCapabilitiesOf(scopeString));
  const granted = new Set((scopeString ?? '').split(/\s+/).filter(Boolean));
  const missing: string[] = [];
  for (const cap of capabilities) {
    if (have.has(cap)) continue;
    for (const s of GOOGLE_CAPABILITY_SCOPES[cap]) if (!granted.has(s)) missing.push(s);
  }
  return [...new Set(missing)];
}
