import { describe, expect, it } from 'vitest';
import {
  flbCoordinateProblem,
  flbFormatCoordinate,
  flbParseCoordinate,
  flbParseMapsInput,
  flbReadLocation,
} from './location';
import { flbValidateGraph } from './validation';

const coords = (input: string) => {
  const r = flbParseMapsInput(input);
  return r.kind === 'coords' ? [r.lat, r.lng] : r;
};

describe('flbParseCoordinate', () => {
  it('reads plain decimals, a decimal comma and a typographic minus', () => {
    expect(flbParseCoordinate('18.5204')).toBe(18.5204);
    expect(flbParseCoordinate(' -122.084801 ')).toBe(-122.084801);
    expect(flbParseCoordinate('18,5204')).toBe(18.5204);
    expect(flbParseCoordinate('−12.5')).toBe(-12.5);
    expect(flbParseCoordinate(12)).toBe(12);
  });
  it('refuses everything that is not a plain number', () => {
    for (const v of [
      '',
      ' ',
      'abc',
      '1e3',
      '12abc',
      '1.2.3',
      '--5',
      '0x10',
      'NaN',
      'Infinity',
      '1,2,3',
      null,
      undefined,
      {},
      NaN,
    ])
      expect(flbParseCoordinate(v), String(v)).toBeNull();
  });
});

describe('flbCoordinateProblem', () => {
  it('accepts real coordinates, including the bounds', () => {
    expect(flbCoordinateProblem('18.5204', '73.8567')).toBeNull();
    expect(flbCoordinateProblem(90, 180)).toBeNull();
    expect(flbCoordinateProblem(-90, -180)).toBeNull();
    expect(flbCoordinateProblem(0, 73.8)).toBeNull(); // the equator is a place; only 0,0 is the placeholder
    expect(flbCoordinateProblem(12.9, 0)).toBeNull();
  });
  it('names the first problem', () => {
    expect(flbCoordinateProblem('', '')).toBe('empty');
    expect(flbCoordinateProblem(undefined, null)).toBe('empty');
    expect(flbCoordinateProblem('', '5')).toBe('lat_missing');
    expect(flbCoordinateProblem('5', ' ')).toBe('lng_missing');
    expect(flbCoordinateProblem('abc', '5')).toBe('lat_nan');
    expect(flbCoordinateProblem('5', 'x')).toBe('lng_nan');
    expect(flbCoordinateProblem('90.0001', '5')).toBe('lat_range');
    expect(flbCoordinateProblem('-91', '5')).toBe('lat_range');
    expect(flbCoordinateProblem('5', '180.5')).toBe('lng_range');
    expect(flbCoordinateProblem('5', '-181')).toBe('lng_range');
    expect(flbCoordinateProblem('0', '0')).toBe('zero');
    expect(flbCoordinateProblem('0.0', '-0')).toBe('zero');
  });
});

describe('flbParseMapsInput: long links', () => {
  it('prefers the pin (!3d!4d) over the map centre (@)', () => {
    expect(
      coords(
        'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2944813,17z/data=!3m1!4b1!4m6!3m5!1s0x47e66e2964e34e2d:0x8ddca9ee380ef7e0!8m2!3d48.8583701!4d2.2944813',
      ),
    ).toEqual([48.8583701, 2.2944813]);
    expect(coords('https://www.google.com/maps/@37.4221,-122.0841,15z')).toEqual([
      37.4221, -122.0841,
    ]);
    expect(
      coords('https://www.google.com/maps/place/X/@10.0,20.0,17z/data=!3d11.5!4d21.5'),
    ).toEqual([11.5, 21.5]);
  });
  it('reads q, query, ll, center and destination parameters', () => {
    expect(coords('https://maps.google.com/?q=18.5204,73.8567')).toEqual([18.5204, 73.8567]);
    expect(coords('https://www.google.com/maps?q=18.5204%2C73.8567')).toEqual([18.5204, 73.8567]);
    expect(coords('https://www.google.com/maps/search/?api=1&query=18.5204,73.8567')).toEqual([
      18.5204, 73.8567,
    ]);
    expect(coords('https://maps.google.com/maps?ll=-33.8688,151.2093&z=12')).toEqual([
      -33.8688, 151.2093,
    ]);
    expect(coords('https://www.google.com/maps/dir/?api=1&destination=51.5,-0.12')).toEqual([
      51.5, -0.12,
    ]);
    expect(coords('https://www.google.com.au/maps/@-33.86,151.2,12z')).toEqual([-33.86, 151.2]);
    expect(coords('https://maps.google.co.in/maps?q=19.07,72.87')).toEqual([19.07, 72.87]);
  });
  it('accepts a link pasted without its scheme and surrounding spaces', () => {
    expect(coords('  maps.google.com/?q=18.5,73.8  ')).toEqual([18.5, 73.8]);
    expect(coords('google.com/maps/@18.5,73.8,15z')).toEqual([18.5, 73.8]);
  });
  it('reads a bare "lat, lng" pair', () => {
    expect(coords('18.5204, 73.8567')).toEqual([18.5204, 73.8567]);
    expect(coords('-18.5 -73.8')).toEqual([-18.5, -73.8]);
  });
  it('says why a link has no usable location', () => {
    expect(flbParseMapsInput('')).toEqual({ kind: 'invalid', problem: 'empty' });
    expect(flbParseMapsInput('hello world')).toEqual({ kind: 'invalid', problem: 'not_url' });
    expect(flbParseMapsInput('javascript:alert(1)')).toEqual({
      kind: 'invalid',
      problem: 'not_url',
    });
    expect(flbParseMapsInput('ftp://maps.google.com/?q=1,2')).toEqual({
      kind: 'invalid',
      problem: 'not_url',
    });
    expect(flbParseMapsInput('https://example.com/?q=18.5,73.8')).toEqual({
      kind: 'invalid',
      problem: 'not_maps',
    });
    expect(flbParseMapsInput('https://google.com.evil.com/maps/@1,2,3z')).toEqual({
      kind: 'invalid',
      problem: 'not_maps',
    });
    expect(flbParseMapsInput('https://evilgoogle.com/maps/@1,2,3z')).toEqual({
      kind: 'invalid',
      problem: 'not_maps',
    });
    expect(flbParseMapsInput('https://user:pw@www.google.com/maps/@1,2,3z')).toEqual({
      kind: 'invalid',
      problem: 'not_maps',
    });
    expect(flbParseMapsInput('https://www.google.com/search?q=18.5,73.8')).toEqual({
      kind: 'invalid',
      problem: 'not_maps',
    });
    expect(flbParseMapsInput('https://www.google.com/maps/place/Eiffel+Tower')).toEqual({
      kind: 'invalid',
      problem: 'no_coords',
    });
    expect(flbParseMapsInput('https://maps.google.com/?q=Eiffel+Tower')).toEqual({
      kind: 'invalid',
      problem: 'no_coords',
    });
  });
  it('range-checks what it extracts', () => {
    expect(flbParseMapsInput('https://maps.google.com/?q=95.1,73.8')).toEqual({
      kind: 'invalid',
      problem: 'lat_range',
    });
    expect(flbParseMapsInput('https://maps.google.com/?q=18.5,190.2')).toEqual({
      kind: 'invalid',
      problem: 'lng_range',
    });
    expect(flbParseMapsInput('https://maps.google.com/?q=0,0')).toEqual({
      kind: 'invalid',
      problem: 'zero',
    });
    expect(flbParseMapsInput('0, 0')).toEqual({ kind: 'invalid', problem: 'zero' });
  });
});

describe('flbParseMapsInput: short links', () => {
  it('hands a short link back to be resolved on the server', () => {
    expect(flbParseMapsInput('https://maps.app.goo.gl/AbC123xyz')).toEqual({
      kind: 'short',
      url: 'https://maps.app.goo.gl/AbC123xyz',
    });
    expect(flbParseMapsInput('maps.app.goo.gl/AbC123xyz')).toEqual({
      kind: 'short',
      url: 'https://maps.app.goo.gl/AbC123xyz',
    });
    expect(flbParseMapsInput('https://goo.gl/maps/AbC123')).toMatchObject({ kind: 'short' });
  });
  it('does not treat other goo.gl links as maps', () => {
    expect(flbParseMapsInput('https://goo.gl/somethingelse')).toEqual({
      kind: 'invalid',
      problem: 'no_coords',
    });
  });
});

describe('flbReadLocation', () => {
  it('keeps a step saved before the modes existed working', () => {
    expect(flbReadLocation({ lat: '18.5204', lng: '73.8567', title: 'x', address: 'y' })).toEqual({
      ok: true,
      lat: 18.5204,
      lng: 73.8567,
    });
    expect(flbReadLocation({ latitude: 18.5, longitude: 73.8 })).toEqual({
      ok: true,
      lat: 18.5,
      lng: 73.8,
    });
  });
  it('flags a step that never had real coordinates', () => {
    expect(flbReadLocation({ lat: '', lng: '' })).toEqual({ ok: false, problem: 'empty' });
    expect(flbReadLocation({ lat: '0', lng: '0' })).toEqual({ ok: false, problem: 'zero' });
    expect(flbReadLocation({ lat: '100', lng: '5' })).toEqual({ ok: false, problem: 'lat_range' });
    expect(flbReadLocation(null)).toEqual({ ok: false, problem: 'empty' });
  });
  it('explains a link step with no coordinates', () => {
    expect(
      flbReadLocation({
        locMode: 'link',
        mapsUrl: 'https://maps.app.goo.gl/abc',
        lat: '',
        lng: '',
      }),
    ).toEqual({ ok: false, problem: 'unresolved' });
    expect(flbReadLocation({ locMode: 'link', mapsUrl: 'nonsense', lat: '', lng: '' })).toEqual({
      ok: false,
      problem: 'not_url',
    });
    expect(
      flbReadLocation({
        locMode: 'link',
        mapsUrl: 'https://maps.google.com/?q=18.5,73.8',
        lat: '',
        lng: '',
      }),
    ).toEqual({ ok: true, lat: 18.5, lng: 73.8 });
  });
});

describe('flbFormatCoordinate', () => {
  it('trims float noise and trailing zeros', () => {
    expect(flbFormatCoordinate(18.52040000000001)).toBe('18.5204');
    expect(flbFormatCoordinate(-122.084801)).toBe('-122.084801');
    expect(flbFormatCoordinate(5)).toBe('5');
  });
});

describe('flbValidateGraph: Location node', () => {
  const run = (data: Record<string, unknown>) =>
    flbValidateGraph(
      [
        { id: 't', type: 'trigger', data: { deviceId: 'd' } },
        { id: 'l', type: 'location', data },
      ],
      [{ source: 't', target: 'l' }],
      { mode: 'chat', senderAvailable: true },
    );
  it('blocks Save / Publish on a location with no usable coordinates', () => {
    const r = run({ lat: '', lng: '' });
    expect(r.ok).toBe(false);
    expect(r.badNodeIds).toEqual(['l']);
    expect(run({ lat: '0', lng: '0' }).ok).toBe(false);
    expect(run({ lat: '91', lng: '5' }).ok).toBe(false);
  });
  it('lets a valid location through, optional name and address left empty', () => {
    expect(run({ lat: '18.5204', lng: '73.8567', title: '', address: '' }).ok).toBe(true);
    expect(run({ locMode: 'link', mapsUrl: 'https://maps.google.com/?q=1.5,2.5' }).ok).toBe(true);
  });
});
