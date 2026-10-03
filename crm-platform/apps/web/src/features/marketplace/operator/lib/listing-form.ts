import {
  marketLinkSchema,
  type MarketListing,
  type MarketOperatorApp,
  type UpdateMarketAppInput,
} from '@crm/contracts';

/**
 * The listing fields of the create form and of the listing's edit form: tagline, logo, long description, highlights, screenshots, the
 * data-processing disclosure, first-party, featured, the plan feature and the sort order. Text boxes hold strings; this module turns
 * them into the contract's shapes and checks them against the contract's limits (a test proves the limits equal the schemas').
 */

export const LISTING_LIMITS = {
  taglineMin: 5,
  taglineMax: 140,
  longDescriptionMax: 8000,
  highlightsMax: 8,
  highlightMax: 120,
  screenshotsMax: 8,
  captionMax: 120,
  summaryMax: 1000,
  regionsMax: 10,
  regionMax: 40,
  deletionMax: 500,
  sortOrderMax: 10_000,
  changelogMax: 2000,
} as const;

export interface ScreenshotDraft {
  url: string;
  caption: string;
}

export interface ListingDraft {
  tagline: string;
  logo: string;
  longDescription: string;
  /** One highlight per line. */
  highlights: string;
  screenshots: ScreenshotDraft[];
  dataSummary: string;
  /** Comma separated. */
  dataRegions: string;
  dataDeletion: string;
  firstParty: boolean;
  featured: boolean;
  /** A plan feature key, or empty for every plan. */
  planFeature: string;
  sortOrder: string;
}

export const emptyListingDraft = (): ListingDraft => ({
  tagline: '',
  logo: '',
  longDescription: '',
  highlights: '',
  screenshots: [],
  dataSummary: '',
  dataRegions: '',
  dataDeletion: '',
  firstParty: false,
  featured: false,
  planFeature: '',
  sortOrder: '100',
});

type ListingSource = Pick<
  MarketOperatorApp,
  'tagline' | 'firstParty' | 'featured' | 'planFeature' | 'sortOrder'
> & { listing: MarketListing };

export function draftFromListing(app: ListingSource): ListingDraft {
  const l = app.listing;
  return {
    tagline: app.tagline,
    logo: l.logo ?? '',
    longDescription: l.longDescription,
    highlights: l.highlights.join('\n'),
    screenshots: l.screenshots.map((s) => ({ url: s.url, caption: s.caption ?? '' })),
    dataSummary: l.dataProcessing.summary,
    dataRegions: l.dataProcessing.regions.join(', '),
    dataDeletion: l.dataProcessing.deletion,
    firstParty: app.firstParty,
    featured: app.featured,
    planFeature: app.planFeature ?? '',
    sortOrder: String(app.sortOrder),
  };
}

const lines = (text: string): string[] =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
const commaList = (text: string): string[] =>
  text
    .split(',')
    .map((l) => l.trim())
    .filter(Boolean);

/** The contract's listing object from the form (blank entries dropped, text trimmed). */
export function listingFromDraft(d: ListingDraft): MarketListing {
  return {
    logo: d.logo.trim() === '' ? null : d.logo.trim(),
    longDescription: d.longDescription.trim(),
    highlights: lines(d.highlights),
    screenshots: d.screenshots
      .filter((s) => s.url.trim() !== '' || s.caption.trim() !== '')
      .map((s) => {
        const caption = s.caption.trim();
        return caption ? { url: s.url.trim(), caption } : { url: s.url.trim() };
      }),
    dataProcessing: {
      summary: d.dataSummary.trim(),
      regions: commaList(d.dataRegions),
      deletion: d.dataDeletion.trim(),
    },
  };
}

// --- checks ----------------------------------------------------------------------------------------------------------------------------

export type FieldCode =
  | 'required'
  | 'tooShort'
  | 'tooLong'
  | 'https'
  | 'tooMany'
  | 'number'
  | 'unknownFeature'
  | 'slug'
  | 'icon';

export interface FieldProblem {
  code: FieldCode;
  values?: Record<string, string | number>;
}

/** Problems by form key: `tagline`, `logo`, `highlights`, `screenshots.2.url`, `sortOrder`, `changelog`... */
export type FieldProblems = Record<string, FieldProblem>;

const L = LISTING_LIMITS;

function maxLen(out: FieldProblems, key: string, text: string, max: number) {
  if (text.trim().length > max) out[key] = { code: 'tooLong', values: { max } };
}

export function listingProblems(d: ListingDraft): FieldProblems {
  const out: FieldProblems = {};
  const tagline = d.tagline.trim().length;
  if (tagline === 0) out.tagline = { code: 'required' };
  else if (tagline < L.taglineMin)
    out.tagline = { code: 'tooShort', values: { min: L.taglineMin } };
  else if (tagline > L.taglineMax) out.tagline = { code: 'tooLong', values: { max: L.taglineMax } };

  if (d.logo.trim() !== '' && !marketLinkSchema.safeParse(d.logo).success)
    out.logo = { code: 'https' };
  maxLen(out, 'longDescription', d.longDescription, L.longDescriptionMax);

  const highlights = lines(d.highlights);
  if (highlights.length > L.highlightsMax)
    out.highlights = { code: 'tooMany', values: { max: L.highlightsMax } };
  else if (highlights.some((h) => h.length > L.highlightMax))
    out.highlights = { code: 'tooLong', values: { max: L.highlightMax } };

  const shots = d.screenshots.filter((s) => s.url.trim() !== '' || s.caption.trim() !== '');
  if (shots.length > L.screenshotsMax)
    out.screenshots = { code: 'tooMany', values: { max: L.screenshotsMax } };
  d.screenshots.forEach((s, i) => {
    if (s.url.trim() === '' && s.caption.trim() === '') return;
    if (s.url.trim() === '') out[`screenshots.${i}.url`] = { code: 'required' };
    else if (!marketLinkSchema.safeParse(s.url).success)
      out[`screenshots.${i}.url`] = { code: 'https' };
    if (s.caption.trim().length > L.captionMax)
      out[`screenshots.${i}.caption`] = { code: 'tooLong', values: { max: L.captionMax } };
  });

  maxLen(out, 'dataSummary', d.dataSummary, L.summaryMax);
  const regions = commaList(d.dataRegions);
  if (regions.length > L.regionsMax)
    out.dataRegions = { code: 'tooMany', values: { max: L.regionsMax } };
  else if (regions.some((r) => r.length > L.regionMax))
    out.dataRegions = { code: 'tooLong', values: { max: L.regionMax } };
  maxLen(out, 'dataDeletion', d.dataDeletion, L.deletionMax);

  // The API takes any key of this shape (a plan feature newer than this build is still saved as it is).
  if (d.planFeature !== '' && !/^[a-z][a-z0-9_]{0,63}$/.test(d.planFeature))
    out.planFeature = { code: 'unknownFeature' };
  const so = d.sortOrder.trim();
  if (!/^\d+$/.test(so) || Number(so) > L.sortOrderMax)
    out.sortOrder = { code: 'number', values: { max: L.sortOrderMax } };
  return out;
}

/** The changelog of a new listing (optional, the API defaults it) or of a new version (required). */
export function changelogProblem(text: string, required: boolean): FieldProblem | null {
  const n = text.trim().length;
  if (n === 0) return required ? { code: 'required' } : null;
  if (n > L.changelogMax) return { code: 'tooLong', values: { max: L.changelogMax } };
  return null;
}

/** Which form key a server path belongs to (`listing.highlights.2` is the highlights box), or null when it is not a listing field. */
export function serverFieldKey(path: string): string | null {
  if (
    path === 'tagline' ||
    path === 'planFeature' ||
    path === 'sortOrder' ||
    path === 'changelog' ||
    path === 'firstParty' ||
    path === 'featured'
  )
    return path;
  if (!path.startsWith('listing')) return null;
  const rest = path.replace(/^listing\.?/, '');
  if (rest === 'logo') return 'logo';
  if (rest === 'longDescription') return 'longDescription';
  if (rest.startsWith('highlights')) return 'highlights';
  if (rest.startsWith('screenshots')) {
    const m = /^screenshots\.(\d+)\.(url|caption)$/.exec(rest);
    return m ? `screenshots.${m[1]}.${m[2]}` : 'screenshots';
  }
  if (rest === 'dataProcessing.summary') return 'dataSummary';
  if (rest.startsWith('dataProcessing.regions')) return 'dataRegions';
  if (rest === 'dataProcessing.deletion') return 'dataDeletion';
  return null;
}

// --- payloads --------------------------------------------------------------------------------------------------------------------------

export const parseSortOrder = (text: string): number => Number(text.trim() || '0');

/** The fields the create form sends besides the two documents. */
export function createFields(d: ListingDraft, changelog: string) {
  return {
    tagline: d.tagline.trim(),
    listing: listingFromDraft(d),
    firstParty: d.firstParty,
    featured: d.featured,
    planFeature: d.planFeature === '' ? null : d.planFeature,
    sortOrder: parseSortOrder(d.sortOrder),
    changelog: changelog.trim() === '' ? undefined : changelog.trim(),
  };
}

const sameList = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PATCH body for an edit, without `rowVersion`: only what changed, so the audit row of the call names only what the operator
 * touched. The listing content goes whole when any part of it changed (the API replaces it).
 */
export function updatePatch(
  initial: ListingDraft,
  draft: ListingDraft,
): Omit<UpdateMarketAppInput, 'rowVersion'> {
  const patch: Omit<UpdateMarketAppInput, 'rowVersion'> = {};
  if (draft.tagline.trim() !== initial.tagline.trim()) patch.tagline = draft.tagline.trim();
  if (!sameList(listingFromDraft(draft), listingFromDraft(initial)))
    patch.listing = listingFromDraft(draft);
  if (draft.firstParty !== initial.firstParty) patch.firstParty = draft.firstParty;
  if (draft.featured !== initial.featured) patch.featured = draft.featured;
  if (draft.planFeature !== initial.planFeature)
    patch.planFeature = draft.planFeature === '' ? null : draft.planFeature;
  if (parseSortOrder(draft.sortOrder) !== parseSortOrder(initial.sortOrder))
    patch.sortOrder = parseSortOrder(draft.sortOrder);
  return patch;
}

export const isDirty = (initial: ListingDraft, draft: ListingDraft): boolean =>
  Object.keys(updatePatch(initial, draft)).length > 0;
