import { describe, expect, it } from 'vitest';
import {
  EMPTY_BUTTONS,
  EMPTY_CONTACT,
  buildButtons,
  buildContacts,
  buildLocation,
  parseDegrees,
  splitPair,
} from './share';

describe('location form', () => {
  it('reads decimals with a dot or a comma', () => {
    expect(parseDegrees('28.6139')).toBe(28.6139);
    expect(parseDegrees('28,6139')).toBe(28.6139);
    expect(parseDegrees('-0.5')).toBe(-0.5);
    expect(parseDegrees('abc')).toBeNull();
    expect(parseDegrees('')).toBeNull();
  });
  it('splits a pasted "lat, lng" pair', () => {
    expect(splitPair('28.6139, 77.2090')).toEqual(['28.6139', '77.2090']);
    expect(splitPair('28.6139')).toBeNull();
  });
  it('refuses a missing or out of range coordinate', () => {
    const f = { latitude: '', longitude: '200', name: '', address: '' };
    expect(buildLocation(f)).toEqual({
      ok: false,
      problems: { latitude: 'required', longitude: 'range' },
    });
  });
  it('builds the send body with the optional place name', () => {
    expect(
      buildLocation({ latitude: '28.6', longitude: '77.2', name: ' Office ', address: '' }),
    ).toEqual({
      ok: true,
      input: { kind: 'location', latitude: 28.6, longitude: 77.2, name: 'Office' },
    });
  });
});

describe('contact form', () => {
  it('needs a name and a phone or an email', () => {
    expect(buildContacts([EMPTY_CONTACT])).toMatchObject({
      ok: false,
      problems: { '0.name': 'required', '0.phone': 'phoneOrEmail' },
    });
  });
  it('checks the shape of the phone and the email', () => {
    expect(buildContacts([{ name: 'A', phone: 'call me', email: 'nope', org: '' }])).toMatchObject({
      ok: false,
      problems: { '0.phone': 'phone', '0.email': 'email' },
    });
  });
  it('builds one card per row', () => {
    expect(
      buildContacts([
        { name: 'Asha', phone: '+91 98765 43210', email: '', org: 'Acme' },
        { name: 'Bob', phone: '', email: 'b@x.io', org: '' },
      ]),
    ).toEqual({
      ok: true,
      input: {
        kind: 'contacts',
        contacts: [
          { name: 'Asha', phones: ['+91 98765 43210'], emails: [], org: 'Acme' },
          { name: 'Bob', phones: [], emails: ['b@x.io'] },
        ],
      },
    });
  });
});

describe('buttons form', () => {
  it('needs a body and one title', () => {
    expect(buildButtons(EMPTY_BUTTONS)).toMatchObject({
      ok: false,
      problems: { body: 'required', 'title.0': 'required' },
    });
  });
  it('refuses two buttons with the same title, ignoring case', () => {
    expect(buildButtons({ ...EMPTY_BUTTONS, body: 'Pick', titles: ['Yes', 'yes'] })).toMatchObject({
      ok: false,
      problems: { 'title.1': 'duplicate' },
    });
  });
  it('skips empty rows', () => {
    expect(buildButtons({ ...EMPTY_BUTTONS, body: 'Pick', titles: ['Yes', '', 'No'] })).toEqual({
      ok: true,
      input: {
        kind: 'interactive',
        interactive: {
          type: 'buttons',
          body: 'Pick',
          buttons: [{ title: 'Yes' }, { title: 'No' }],
        },
      },
    });
  });
  it('a link button needs text and an http(s) url', () => {
    const f = { ...EMPTY_BUTTONS, type: 'cta_url' as const, body: 'Pay' };
    expect(buildButtons(f)).toMatchObject({
      ok: false,
      problems: { linkText: 'required', url: 'required' },
    });
    expect(buildButtons({ ...f, linkText: 'Open', url: 'javascript:x' })).toMatchObject({
      ok: false,
      problems: { url: 'url' },
    });
    expect(buildButtons({ ...f, linkText: 'Open', url: 'https://x.io/p' })).toMatchObject({
      ok: true,
    });
  });

  describe('list', () => {
    const list = { ...EMPTY_BUTTONS, type: 'list' as const, body: 'Choose', listButton: 'Options' };
    const row = (title: string, description = '') => ({ title, description });

    it('needs a body, a button and one row', () => {
      expect(buildButtons({ ...EMPTY_BUTTONS, type: 'list' })).toMatchObject({
        ok: false,
        problems: { body: 'required', listButton: 'required', 'row.0.0': 'required' },
      });
    });
    it('builds sections with their rows, skipping empty rows and sections', () => {
      expect(
        buildButtons({
          ...list,
          sections: [
            { title: 'Sizes', rows: [row('Small', 'Fits 6-8'), row('')] },
            { title: 'Empty', rows: [row('')] },
          ],
        }),
      ).toEqual({
        ok: true,
        input: {
          kind: 'interactive',
          interactive: {
            type: 'list',
            body: 'Choose',
            button: 'Options',
            sections: [{ title: 'Sizes', rows: [{ title: 'Small', description: 'Fits 6-8' }] }],
          },
        },
      });
    });
    it('refuses more than 10 rows in total', () => {
      const rows = Array.from({ length: 6 }, (_, i) => row(`R${i}`));
      expect(
        buildButtons({
          ...list,
          sections: [
            { title: 'A', rows },
            { title: 'B', rows },
          ],
        }),
      ).toMatchObject({ ok: false, problems: { rows: 'tooManyRows' } });
    });
    it('wants a title on every section once there are two', () => {
      expect(
        buildButtons({
          ...list,
          sections: [
            { title: 'A', rows: [row('x')] },
            { title: '', rows: [row('y')] },
          ],
        }),
      ).toMatchObject({ ok: false, problems: { 'section.1': 'required' } });
    });
  });
});
