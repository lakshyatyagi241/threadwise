import { describe, expect, it } from 'vitest';
import { createMarketAppSchema, marketListingSchema, updateMarketAppSchema } from '@crm/contracts';
import { detail, manifest } from '../test-fixtures';
import {
  LISTING_LIMITS,
  changelogProblem,
  createFields,
  draftFromListing,
  emptyListingDraft,
  isDirty,
  listingFromDraft,
  listingProblems,
  serverFieldKey,
  updatePatch,
  type ListingDraft,
} from './listing-form';

const valid = (over: Partial<ListingDraft> = {}): ListingDraft => ({
  ...emptyListingDraft(),
  tagline: 'Bring leads in',
  ...over,
});

describe('limits equal the contract', () => {
  const create = (tagline: string, over: Record<string, unknown> = {}) =>
    createMarketAppSchema.safeParse({ manifest: {}, tagline, ...over }).success;

  it('tagline 5 to 140', () => {
    expect(create('x'.repeat(LISTING_LIMITS.taglineMin - 1))).toBe(false);
    expect(create('x'.repeat(LISTING_LIMITS.taglineMin))).toBe(true);
    expect(create('x'.repeat(LISTING_LIMITS.taglineMax))).toBe(true);
    expect(create('x'.repeat(LISTING_LIMITS.taglineMax + 1))).toBe(false);
  });

  it('listing text limits', () => {
    const ok = (listing: Record<string, unknown>) => marketListingSchema.safeParse(listing).success;
    expect(ok({ longDescription: 'x'.repeat(LISTING_LIMITS.longDescriptionMax) })).toBe(true);
    expect(ok({ longDescription: 'x'.repeat(LISTING_LIMITS.longDescriptionMax + 1) })).toBe(false);
    expect(ok({ highlights: Array(LISTING_LIMITS.highlightsMax).fill('x') })).toBe(true);
    expect(ok({ highlights: Array(LISTING_LIMITS.highlightsMax + 1).fill('x') })).toBe(false);
    expect(ok({ highlights: ['x'.repeat(LISTING_LIMITS.highlightMax + 1)] })).toBe(false);
    const shot = { url: 'https://example.com/a.png' };
    expect(ok({ screenshots: Array(LISTING_LIMITS.screenshotsMax).fill(shot) })).toBe(true);
    expect(ok({ screenshots: Array(LISTING_LIMITS.screenshotsMax + 1).fill(shot) })).toBe(false);
    expect(
      ok({ screenshots: [{ ...shot, caption: 'x'.repeat(LISTING_LIMITS.captionMax + 1) }] }),
    ).toBe(false);
    expect(ok({ dataProcessing: { summary: 'x'.repeat(LISTING_LIMITS.summaryMax + 1) } })).toBe(
      false,
    );
    expect(
      ok({ dataProcessing: { regions: Array(LISTING_LIMITS.regionsMax + 1).fill('x') } }),
    ).toBe(false);
    expect(ok({ dataProcessing: { regions: ['x'.repeat(LISTING_LIMITS.regionMax + 1)] } })).toBe(
      false,
    );
    expect(ok({ dataProcessing: { deletion: 'x'.repeat(LISTING_LIMITS.deletionMax + 1) } })).toBe(
      false,
    );
  });

  it('sort order 0 to 10000 and changelog up to 2000', () => {
    expect(create('Valid tagline', { sortOrder: LISTING_LIMITS.sortOrderMax })).toBe(true);
    expect(create('Valid tagline', { sortOrder: LISTING_LIMITS.sortOrderMax + 1 })).toBe(false);
    expect(create('Valid tagline', { changelog: 'x'.repeat(LISTING_LIMITS.changelogMax) })).toBe(
      true,
    );
    expect(
      create('Valid tagline', { changelog: 'x'.repeat(LISTING_LIMITS.changelogMax + 1) }),
    ).toBe(false);
  });
});

describe('listingProblems', () => {
  it('a filled tagline and nothing else is fine', () => {
    expect(listingProblems(valid())).toEqual({});
  });

  it('the tagline is required, at least 5 and at most 140 characters', () => {
    expect(listingProblems(valid({ tagline: '' })).tagline).toEqual({ code: 'required' });
    expect(listingProblems(valid({ tagline: ' abc ' })).tagline).toMatchObject({
      code: 'tooShort',
    });
    expect(listingProblems(valid({ tagline: 'x'.repeat(141) })).tagline).toMatchObject({
      code: 'tooLong',
    });
  });

  it('the logo and every screenshot are https links', () => {
    expect(listingProblems(valid({ logo: 'http://example.com/a.png' })).logo).toEqual({
      code: 'https',
    });
    expect(listingProblems(valid({ logo: 'https://example.com/a.png' })).logo).toBeUndefined();
    const p = listingProblems(
      valid({
        screenshots: [
          { url: '', caption: 'no address' },
          { url: 'ftp://x/y.png', caption: '' },
          { url: 'https://example.com/ok.png', caption: 'x'.repeat(121) },
          { url: '', caption: '' },
        ],
      }),
    );
    expect(p['screenshots.0.url']).toEqual({ code: 'required' });
    expect(p['screenshots.1.url']).toEqual({ code: 'https' });
    expect(p['screenshots.2.caption']).toMatchObject({ code: 'tooLong' });
    expect(p['screenshots.3.url']).toBeUndefined();
  });

  it('counts only non-blank highlights and screenshots against the maximum of eight', () => {
    expect(listingProblems(valid({ highlights: 'a\n\n\nb\n' })).highlights).toBeUndefined();
    expect(
      listingProblems(valid({ highlights: Array(9).fill('x').join('\n') })).highlights,
    ).toMatchObject({ code: 'tooMany' });
    expect(listingProblems(valid({ highlights: 'x'.repeat(121) })).highlights).toMatchObject({
      code: 'tooLong',
    });
    const shots = Array.from({ length: 9 }, () => ({
      url: 'https://example.com/a.png',
      caption: '',
    }));
    expect(listingProblems(valid({ screenshots: shots })).screenshots).toMatchObject({
      code: 'tooMany',
    });
  });

  it('regions: up to ten, each up to 40 characters', () => {
    expect(listingProblems(valid({ dataRegions: 'India, EU' })).dataRegions).toBeUndefined();
    expect(
      listingProblems(valid({ dataRegions: Array(11).fill('x').join(',') })).dataRegions,
    ).toMatchObject({ code: 'tooMany' });
    expect(listingProblems(valid({ dataRegions: 'x'.repeat(41) })).dataRegions).toMatchObject({
      code: 'tooLong',
    });
  });

  it('sort order is a whole number from 0 to 10000', () => {
    for (const bad of ['', '-1', '1.5', 'abc', '10001']) {
      expect(listingProblems(valid({ sortOrder: bad })).sortOrder, bad).toMatchObject({
        code: 'number',
      });
    }
    for (const good of ['0', '100', '10000'])
      expect(listingProblems(valid({ sortOrder: good })).sortOrder).toBeUndefined();
  });

  it('the plan feature is empty (every plan) or a key of the right shape', () => {
    expect(listingProblems(valid({ planFeature: 'analytics' })).planFeature).toBeUndefined();
    expect(listingProblems(valid({ planFeature: 'Not A Key' })).planFeature).toEqual({
      code: 'unknownFeature',
    });
  });

  it('the changelog is required for a version and optional for a new listing', () => {
    expect(changelogProblem('', true)).toEqual({ code: 'required' });
    expect(changelogProblem('  ', false)).toBeNull();
    expect(changelogProblem('x'.repeat(2001), false)).toMatchObject({ code: 'tooLong' });
    expect(changelogProblem('Fixed the mapping', true)).toBeNull();
  });
});

describe('the draft and the contract objects', () => {
  it('round-trips the listing of a stored app', () => {
    const d = detail();
    const draft = draftFromListing(d);
    expect(draft.tagline).toBe(d.tagline);
    expect(draft.highlights).toBe('Fast\nSafe');
    expect(draft.dataRegions).toBe('India');
    expect(listingFromDraft(draft)).toEqual(d.listing);
    expect(isDirty(draft, draft)).toBe(false);
  });

  it('builds a listing the contract accepts, dropping blank entries and trimming', () => {
    const listing = listingFromDraft(
      valid({
        logo: '  https://example.com/logo.png ',
        highlights: ' one \n\n two ',
        screenshots: [
          { url: ' https://example.com/a.png ', caption: ' First ' },
          { url: '', caption: '' },
        ],
        dataSummary: ' stores leads ',
        dataRegions: 'India, ,EU',
      }),
    );
    expect(listing).toEqual({
      logo: 'https://example.com/logo.png',
      longDescription: '',
      highlights: ['one', 'two'],
      screenshots: [{ url: 'https://example.com/a.png', caption: 'First' }],
      dataProcessing: { summary: 'stores leads', regions: ['India', 'EU'], deletion: '' },
    });
    expect(marketListingSchema.safeParse(listing).success).toBe(true);
  });

  it('createFields makes a body createMarketAppSchema accepts', () => {
    const fields = createFields(
      valid({ planFeature: 'analytics', featured: true, sortOrder: '30' }),
      'First cut',
    );
    const parsed = createMarketAppSchema.safeParse({ manifest: manifest(), ...fields });
    expect(parsed.success).toBe(true);
    expect(fields).toMatchObject({
      planFeature: 'analytics',
      featured: true,
      sortOrder: 30,
      changelog: 'First cut',
    });
    expect(createFields(valid(), '  ').changelog).toBeUndefined();
    expect(createFields(valid(), '').planFeature).toBeNull();
  });
});

describe('updatePatch: only what changed', () => {
  const base = draftFromListing(detail());

  it('is empty when nothing changed', () => {
    expect(updatePatch(base, { ...base })).toEqual({});
    expect(isDirty(base, { ...base })).toBe(false);
  });

  it('sends the one field that changed', () => {
    expect(updatePatch(base, { ...base, featured: true })).toEqual({ featured: true });
    expect(updatePatch(base, { ...base, tagline: 'A new tagline here' })).toEqual({
      tagline: 'A new tagline here',
    });
    expect(updatePatch(base, { ...base, sortOrder: '5' })).toEqual({ sortOrder: 5 });
  });

  it('clears the plan feature with null', () => {
    const withFeature = { ...base, planFeature: 'analytics' };
    expect(updatePatch(withFeature, { ...withFeature, planFeature: '' })).toEqual({
      planFeature: null,
    });
    expect(updatePatch(base, { ...base, planFeature: 'analytics' })).toEqual({
      planFeature: 'analytics',
    });
  });

  it('sends the whole listing content when any part of it changed', () => {
    const patch = updatePatch(base, { ...base, highlights: 'Fast\nSafe\nNew' });
    expect(Object.keys(patch)).toEqual(['listing']);
    expect(patch.listing?.highlights).toEqual(['Fast', 'Safe', 'New']);
    expect(updateMarketAppSchema.safeParse({ rowVersion: 1, ...patch }).success).toBe(true);
  });

  it('ignores whitespace-only edits', () => {
    expect(updatePatch(base, { ...base, tagline: ` ${base.tagline} ` })).toEqual({});
  });
});

describe('serverFieldKey: which form field a server path belongs to', () => {
  it('maps the API paths onto the form keys', () => {
    expect(serverFieldKey('tagline')).toBe('tagline');
    expect(serverFieldKey('planFeature')).toBe('planFeature');
    expect(serverFieldKey('sortOrder')).toBe('sortOrder');
    expect(serverFieldKey('changelog')).toBe('changelog');
    expect(serverFieldKey('listing.logo')).toBe('logo');
    expect(serverFieldKey('listing.longDescription')).toBe('longDescription');
    expect(serverFieldKey('listing.highlights.2')).toBe('highlights');
    expect(serverFieldKey('listing.screenshots.1.url')).toBe('screenshots.1.url');
    expect(serverFieldKey('listing.screenshots.1.caption')).toBe('screenshots.1.caption');
    expect(serverFieldKey('listing.screenshots')).toBe('screenshots');
    expect(serverFieldKey('listing.dataProcessing.summary')).toBe('dataSummary');
    expect(serverFieldKey('listing.dataProcessing.regions.0')).toBe('dataRegions');
    expect(serverFieldKey('listing.dataProcessing.deletion')).toBe('dataDeletion');
  });

  it('answers null for a path that is not a listing field', () => {
    expect(serverFieldKey('manifest.id')).toBeNull();
    expect(serverFieldKey('rowVersion')).toBeNull();
    expect(serverFieldKey('listing')).toBeNull();
  });
});
