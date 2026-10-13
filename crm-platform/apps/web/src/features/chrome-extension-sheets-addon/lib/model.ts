import {
  ERROR_CODES,
  EXT_SHEETS_APP_SLUG,
  EXT_SHEETS_FILE_NAMES,
  EXT_SHEETS_KEY_PREFIX,
  type ExtSheetsFile,
  type ExtSheetsKeyStatus,
  type ExtSheetsOverview,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/** The pure half of the Google Sheets add-on page (TW-EXT-001 to 006): which state to draw, error kinds, labels and formatting. */

/** Where the install lives in our own Marketplace. */
export const MARKETPLACE_APP_PATH = `/marketplace/app/${EXT_SHEETS_APP_SLUG}`;
export const SETTINGS_PATH = '/settings/integrations';
/** The overview refreshes when the window is focused; "last used" moves on its own. */
export const COPIED_MS = 1800;
/** The sheet columns the add-on reads, shown in the guide. */
export const PRODUCT_COLUMNS = [
  'name',
  'category',
  'description',
  'image url',
  'price',
  'sku',
  'stock',
  'active',
] as const;
export const CONTACT_COLUMNS = [
  'email',
  'phone',
  'name',
  'first name',
  'last name',
  'source',
] as const;

export type ViewState = 'noPermission' | 'loading' | 'error' | 'notInstalled' | 'ready';

/** What the page draws, in the order the checks must run: a role without the permission never loads anything. */
export function viewState(input: {
  canUse: boolean;
  isPending: boolean;
  isError: boolean;
  overview: ExtSheetsOverview | undefined;
}): ViewState {
  if (!input.canUse) return 'noPermission';
  if (input.isPending) return 'loading';
  if (input.isError || !input.overview) return 'error';
  if (!input.overview.installed || input.overview.blockers.includes('not_installed')) {
    return 'notInstalled';
  }
  return 'ready';
}

export type ErrorKind =
  | 'notInstalled'
  | 'forbidden'
  | 'planLocked'
  | 'suspended'
  | 'rateLimited'
  | 'network'
  | 'unexpected';

/** Which message a failed call gets. Branches on the stable `code` (then the status), never on the wording. */
export function errorKind(error: unknown): ErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  if (error.code === ERROR_CODES.EXT_APP_NOT_INSTALLED) return 'notInstalled';
  if (error.code === ERROR_CODES.PLAN_FEATURE_LOCKED) return 'planLocked';
  if (error.code === ERROR_CODES.WSP_ORG_SUSPENDED || error.code === 'AUTH_ACCOUNT_SUSPENDED') {
    return 'suspended';
  }
  if (error.code === ERROR_CODES.FORBIDDEN || error.status === 403) return 'forbidden';
  if (error.status === 429 || error.code === ERROR_CODES.RATE_LIMITED) return 'rateLimited';
  return 'unexpected';
}

/** `wsn_live_••••••••89abcdef`: the server's mask, or one built from the suffix, or null without a key. */
export function displayMask(status: ExtSheetsKeyStatus): string | null {
  if (!status.active) return null;
  if (status.masked) return status.masked;
  return status.suffix ? `${EXT_SHEETS_KEY_PREFIX}${'•'.repeat(8)}${status.suffix}` : null;
}

/** "Oct 7, 2026, 9:41 AM", or null when the date is missing or unreadable. */
export function formatWhen(iso: string | null, locale: string, timeZone?: string): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone });
}

/** A price with its currency ("INR 499" in the locale's style); the plain text when the currency code is not one Intl knows. */
export function formatPrice(priceMajor: string, currencyCode: string, locale: string): string {
  const amount = Number(priceMajor);
  if (!Number.isFinite(amount)) return `${priceMajor} ${currencyCode}`.trim();
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(
      amount,
    );
  } catch {
    return `${currencyCode} ${priceMajor}`.trim();
  }
}

export const CAPABILITIES = [
  { id: 'readContacts', needs: 'readContacts' },
  { id: 'writeContacts', needs: 'writeContacts' },
  { id: 'readCatalog', needs: 'readCatalog' },
  { id: 'writeCatalog', needs: 'writeCatalog' },
] as const;
export type CapabilityId = (typeof CAPABILITIES)[number]['id'];

/** The four things the key may do, each with whether this member's role allows it. */
export function capabilityList(
  can: ExtSheetsOverview['can'],
): Array<{ id: CapabilityId; allowed: boolean }> {
  return CAPABILITIES.map((c) => ({ id: c.id, allowed: can[c.needs] }));
}

/** The six files in the fixed order the server returns them; a file the server did not list is shown as not available. */
export function orderedFiles(files: readonly ExtSheetsFile[]): ExtSheetsFile[] {
  return EXT_SHEETS_FILE_NAMES.map(
    (name) =>
      files.find((f) => f.name === name) ?? {
        name,
        description: '',
        available: false,
        sizeBytes: 0,
        contentType: 'text/plain',
      },
  );
}

/** "18 KB" for a size in bytes (never "0 KB" for a real file). */
export function sizeLabel(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The one-time secret. It lives only in the screen's memory: a reload or a navigation ends it, and nothing stores it. */
export interface OneTimeKey {
  secret: string;
  rotated: boolean;
}

/** A revoke or a newer key makes the shown secret useless: the screen forgets it. */
export function afterRevoke(): OneTimeKey | null {
  return null;
}

/** Keeps only the shops that can be drawn (a shop with no name falls back to its address). */
export function shopTitle(shop: { shopName: string | null; slug: string }): string {
  return shop.shopName?.trim() || shop.slug;
}
