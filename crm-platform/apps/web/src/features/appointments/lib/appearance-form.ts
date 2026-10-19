import {
  BOOKING_PAGE_LIMITS,
  bookingPageAssetPath,
  type BookingPageAssetRef,
  type BookingPageBackground,
  type BookingPageCorner,
  type BookingPageFont,
  type BookingPageMode,
  type BookingPageSettingsResponse,
  type UpdateBookingPageThemeInput,
  type UpdateBookingTypePageThemeInput,
} from '@crm/contracts';
import { isHexColour } from '@/lib/brand-kit/colour';
import type { ThemeView } from './booking-theme';

/**
 * The booking page appearance form (BL-355..BL-357): one draft of strings and switches, validated here, turned into the API's body and
 * into the page the preview draws. Pure, so each rule has a test.
 *
 * A workspace draft holds concrete values (a font is `default`, not "empty"); a service draft holds only what it overrides and an empty
 * field means "same as the workspace".
 */

export type Scope = 'workspace' | 'type';

export interface Draft {
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  /** Empty: same as the workspace (a service) or the product's own (never empty for the workspace). */
  backgroundStyle: '' | BookingPageBackground;
  pageTitle: string;
  welcomeText: string;
  buttonLabel: string;
  font: BookingPageFont;
  cornerStyle: BookingPageCorner;
  colorMode: BookingPageMode;
  showPoweredBy: boolean;
  showLanguageSwitch: boolean;
  useWorkspaceBrand: boolean;
}

/** A picture chosen but not saved yet: the file, or `null` for "remove the one I have". */
export type StagedPicture = File | null;
export interface Staged {
  logo?: StagedPicture;
  cover?: StagedPicture;
}

export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;

export function draftFromResponse(r: BookingPageSettingsResponse): Draft {
  const t = r.theme;
  const workspace = r.scope === 'workspace';
  return {
    primaryColor: t.primaryColor ?? '',
    accentColor: t.accentColor ?? '',
    backgroundColor: t.backgroundColor ?? '',
    backgroundStyle: t.backgroundStyle ?? (workspace ? 'solid' : ''),
    pageTitle: t.pageTitle ?? '',
    welcomeText: t.welcomeText ?? '',
    buttonLabel: t.buttonLabel ?? '',
    font: t.font ?? 'default',
    cornerStyle: t.cornerStyle ?? 'rounded',
    colorMode: t.colorMode ?? 'auto',
    showPoweredBy: t.showPoweredBy ?? true,
    showLanguageSwitch: t.showLanguageSwitch ?? true,
    useWorkspaceBrand: t.useWorkspaceBrand,
  };
}

export type FieldKey =
  'primaryColor' | 'accentColor' | 'backgroundColor' | 'pageTitle' | 'welcomeText' | 'buttonLabel';
export type Problem = { code: 'colour' } | { code: 'tooLong'; max: number };

export function validate(d: Draft): Partial<Record<FieldKey, Problem>> {
  const out: Partial<Record<FieldKey, Problem>> = {};
  for (const key of ['primaryColor', 'accentColor', 'backgroundColor'] as const) {
    const v = d[key].trim();
    if (v !== '' && !isHexColour(v)) out[key] = { code: 'colour' };
  }
  const limits: Array<[FieldKey, number]> = [
    ['pageTitle', BOOKING_PAGE_LIMITS.pageTitle],
    ['welcomeText', BOOKING_PAGE_LIMITS.welcomeText],
    ['buttonLabel', BOOKING_PAGE_LIMITS.buttonLabel],
  ];
  for (const [key, max] of limits) {
    if ([...d[key].trim()].length > max) out[key] = { code: 'tooLong', max };
  }
  return out;
}

const hex = (v: string): string | null => (isHexColour(v.trim()) ? v.trim().toLowerCase() : null);
const text = (v: string): string | null => (v.trim() === '' ? null : v.trim());

export function workspaceInput(d: Draft, rowVersion: number | null): UpdateBookingPageThemeInput {
  return {
    primaryColor: hex(d.primaryColor),
    accentColor: hex(d.accentColor),
    backgroundColor: hex(d.backgroundColor),
    backgroundStyle: d.backgroundStyle === '' ? null : d.backgroundStyle,
    pageTitle: text(d.pageTitle),
    welcomeText: text(d.welcomeText),
    buttonLabel: text(d.buttonLabel),
    font: d.font,
    cornerStyle: d.cornerStyle,
    colorMode: d.colorMode,
    showPoweredBy: d.showPoweredBy,
    showLanguageSwitch: d.showLanguageSwitch,
    useWorkspaceBrand: d.useWorkspaceBrand,
    rowVersion,
  };
}

export function typeInput(d: Draft, rowVersion: number | null): UpdateBookingTypePageThemeInput {
  return {
    primaryColor: hex(d.primaryColor),
    accentColor: hex(d.accentColor),
    backgroundStyle: d.backgroundStyle === '' ? null : d.backgroundStyle,
    welcomeText: text(d.welcomeText),
    buttonLabel: text(d.buttonLabel),
    rowVersion,
  };
}

export const isDirty = (initial: Draft, draft: Draft, staged: Staged): boolean =>
  JSON.stringify(initial) !== JSON.stringify(draft) ||
  staged.logo !== undefined ||
  staged.cover !== undefined;

/**
 * Whether a file the person picked can be uploaded, checked in the browser before anything is sent (the server checks again, from the
 * bytes): a PNG, JPG, WebP or GIF within the limit for its slot.
 */
export function pictureProblem(
  file: { type: string; size: number },
  slot: 'logo' | 'cover',
): 'type' | 'size' | null {
  if (!(LOGO_TYPES as readonly string[]).includes(file.type)) return 'type';
  const max = slot === 'logo' ? BOOKING_PAGE_LIMITS.logoBytes : BOOKING_PAGE_LIMITS.coverBytes;
  return file.size > max ? 'size' : null;
}

// --- the page the preview draws ---------------------------------------------------------------------------------------------

const pictureUrl = (slug: string, ref: BookingPageAssetRef | null): string | null =>
  ref ? bookingPageAssetPath(slug, ref) : null;

/**
 * What a visitor would see if the draft were saved now: each field is the draft's, else what it inherits. Pictures: a file just chosen
 * (`blobs`), else the saved one, else the inherited one; "remove" falls back to the inherited one.
 */
export function previewView(
  r: BookingPageSettingsResponse,
  d: Draft,
  staged: Staged,
  blobs: { logo?: string; cover?: string },
): ThemeView {
  const inh = r.inherited;
  const type = r.scope === 'type';
  const logoUrl =
    staged.logo === null
      ? pictureUrl(r.workspaceSlug, inh.logo)
      : staged.logo !== undefined
        ? (blobs.logo ?? null)
        : (pictureUrl(r.workspaceSlug, r.theme.logo) ?? pictureUrl(r.workspaceSlug, inh.logo));
  const coverUrl =
    staged.cover === null
      ? pictureUrl(r.workspaceSlug, inh.cover)
      : staged.cover !== undefined
        ? (blobs.cover ?? null)
        : (pictureUrl(r.workspaceSlug, r.theme.cover) ?? pictureUrl(r.workspaceSlug, inh.cover));
  const style: BookingPageBackground =
    d.backgroundStyle === '' ? inh.backgroundStyle : d.backgroundStyle;
  return {
    primaryColor: hex(d.primaryColor) ?? inh.primaryColor,
    accentColor: hex(d.accentColor) ?? inh.accentColor,
    // A service has no colour of its own behind the page: it keeps the workspace's.
    backgroundColor: type ? inh.backgroundColor : (hex(d.backgroundColor) ?? inh.backgroundColor),
    backgroundStyle: style === 'image' && !coverUrl ? 'solid' : style,
    pageTitle: type ? inh.pageTitle : (text(d.pageTitle) ?? inh.pageTitle),
    welcomeText: text(d.welcomeText) ?? inh.welcomeText,
    buttonLabel: text(d.buttonLabel) ?? inh.buttonLabel,
    font: type ? inh.font : d.font,
    cornerStyle: type ? inh.cornerStyle : d.cornerStyle,
    colorMode: type ? inh.colorMode : d.colorMode,
    showPoweredBy: type ? inh.showPoweredBy : r.canRemovePoweredBy ? d.showPoweredBy : true,
    showLanguageSwitch: type ? inh.showLanguageSwitch : d.showLanguageSwitch,
    logoUrl,
    coverUrl,
  };
}
