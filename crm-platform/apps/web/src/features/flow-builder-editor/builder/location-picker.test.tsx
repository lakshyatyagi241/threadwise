import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LocationPicker, locationMode } from './location-picker';

// Messages are not loaded here: the key is the text.
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const html = (data: Record<string, unknown>) =>
  renderToStaticMarkup(<LocationPicker data={data} patch={() => undefined} idPrefix="loc-t" />);

describe('locationMode', () => {
  it('uses the saved choice, else coordinates for a step that already has some, else the link', () => {
    expect(locationMode({ locMode: 'coords' })).toBe('coords');
    expect(locationMode({ locMode: 'link', lat: '1' })).toBe('link');
    expect(locationMode({ lat: '18.5', lng: '73.8' })).toBe('coords');
    expect(locationMode({ lat: '', lng: '' })).toBe('link');
    expect(locationMode({})).toBe('link');
  });
});

describe('LocationPicker', () => {
  it('a new step asks for a link first, with the optional name and address below', () => {
    const out = html({ locMode: 'link', mapsUrl: '', lat: '', lng: '' });
    expect(out).toContain('linkLabel');
    expect(out).toContain('linkHint');
    expect(out).toContain('placeName');
    expect(out).toContain('optional');
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain('openInMaps');
  });

  it('shows the found coordinates and an Open in Google Maps link for a good link', () => {
    const out = html({
      locMode: 'link',
      mapsUrl: 'https://maps.google.com/?q=18.5204,73.8567',
      lat: '18.5204',
      lng: '73.8567',
    });
    expect(out).toContain('found');
    expect(out).toContain('18.5204, 73.8567');
    expect(out).toContain('href="https://www.google.com/maps?q=18.5204,73.8567"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('says what is wrong with a link that is not a Google Maps one', () => {
    const out = html({ locMode: 'link', mapsUrl: 'https://example.com/x', lat: '', lng: '' });
    expect(out).toContain('role="alert"');
    expect(out).toContain('problem.not_maps');
    expect(out).toContain('aria-invalid="true"');
    expect(out).not.toContain('openInMaps');
  });

  it('shows one inline error per bad coordinate box, and none while they are fine', () => {
    const bad = html({ locMode: 'coords', lat: '95', lng: '73.8' });
    expect(bad).toContain('problem.lat_range');
    expect(bad).not.toContain('problem.lng_range');
    expect(html({ locMode: 'coords', lat: '10', lng: '200' })).toContain('problem.lng_range');
    expect(html({ locMode: 'coords', lat: 'abc', lng: '10' })).toContain('problem.lat_nan');
    expect(html({ locMode: 'coords', lat: '0', lng: '0' })).toContain('problem.zero');
    const ok = html({ locMode: 'coords', lat: '18.5204', lng: '73.8567' });
    expect(ok).not.toContain('role="alert"');
    expect(ok).toContain('openInMaps');
  });

  it('opens a step saved before the modes existed on its coordinates, name and address intact', () => {
    const out = html({ lat: '12.97', lng: '77.59', title: 'HQ', address: '1 Main St' });
    expect(out).toContain('value="12.97"');
    expect(out).toContain('value="HQ"');
    expect(out).toContain('value="1 Main St"');
  });
});
