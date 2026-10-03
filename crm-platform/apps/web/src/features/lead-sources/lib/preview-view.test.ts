import { describe, expect, it } from 'vitest';
import { ID, preview } from '../test-fixtures';
import {
  PREVIEW_REASON_CODES,
  previewIsReady,
  previewKey,
  previewView,
  valueText,
} from './preview-view';

describe('previewView', () => {
  it('shows a lead read from a pasted payload field by field', () => {
    const v = previewView(preview());
    expect(v.state).toBe('ready');
    expect(v.basedOn).toBe('payload');
    expect(v.usable).toBe(true);
    expect(v.reasons).toEqual([]);
    expect(v.contact).toMatchObject({
      name: 'Asha Rao',
      email: 'asha@example.test',
      phoneRaw: '98765 43210',
      phone: '+919876543210',
      phoneState: 'ok',
    });
    expect(v.customFields).toEqual([
      { key: 'budget', value: '5000' },
      { key: 'interested', value: 'true' },
    ]);
    expect(v.attribution.map((a) => a.field)).toEqual([
      'platform',
      'campaign',
      'adset',
      'ad',
      'form',
    ]);
    expect(v.attribution.find((a) => a.field === 'campaign')!.value).toBe('Launch');
    expect(v.availablePaths).toEqual(['lead.full_name', 'lead.mobile', 'lead.budget']);
  });

  it('says nothing was received yet when the answer is based on none', () => {
    const v = previewView(
      preview({
        basedOn: 'none',
        usable: false,
        reasons: ['no_payload'],
        availablePaths: [],
        contact: {
          name: null,
          firstName: null,
          lastName: null,
          email: null,
          phoneRaw: null,
          phone: null,
        },
        customFields: {},
      }),
    );
    expect(v.state).toBe('none');
    expect(v.usable).toBe(false);
    expect(v.reasons).toEqual([{ code: 'no_payload', known: true }]);
    expect(v.contact.phoneState).toBe('none');
  });

  it('reads a stored event, with its id', () => {
    const v = previewView(preview({ basedOn: 'event', eventId: ID(9), externalId: 'lead-9' }));
    expect(v).toMatchObject({
      state: 'ready',
      basedOn: 'event',
      eventId: ID(9),
      externalId: 'lead-9',
    });
  });

  it('flags a phone that could not be read as a number', () => {
    const v = previewView(
      preview({
        usable: false,
        reasons: ['invalid_phone'],
        contact: {
          name: 'A',
          firstName: null,
          lastName: null,
          email: null,
          phoneRaw: 'call me',
          phone: null,
        },
      }),
    );
    expect(v.contact.phoneState).toBe('unreadable');
    expect(v.usable).toBe(false);
  });

  it('is fine with an unreadable phone when the lead has an email (the lead is still usable)', () => {
    const v = previewView(
      preview({
        usable: true,
        reasons: ['phone_unreadable'],
        contact: {
          name: 'A',
          firstName: null,
          lastName: null,
          email: 'a@b.test',
          phoneRaw: 'x',
          phone: null,
        },
      }),
    );
    expect(v.usable).toBe(true);
    expect(v.contact.phoneState).toBe('unreadable');
    expect(v.reasons[0]).toEqual({ code: 'phone_unreadable', known: true });
  });

  it('knows every reason code of the API and shows an unknown one verbatim', () => {
    const v = previewView(
      preview({ usable: false, reasons: [...PREVIEW_REASON_CODES, 'from_the_future'] }),
    );
    expect(v.reasons.filter((r) => r.known)).toHaveLength(PREVIEW_REASON_CODES.length);
    expect(v.reasons.at(-1)).toEqual({ code: 'from_the_future', known: false });
  });

  it('offers each available path once, in the payload order', () => {
    const v = previewView(preview({ availablePaths: ['a', 'b', 'a', 'c', 'b'] }));
    expect(v.availablePaths).toEqual(['a', 'b', 'c']);
  });
});

describe('valueText', () => {
  it('shows strings, numbers, booleans and lists as text', () => {
    expect(valueText('x')).toBe('x');
    expect(valueText(12.5)).toBe('12.5');
    expect(valueText(false)).toBe('false');
    expect(valueText(['a', 'b'])).toBe('["a","b"]');
    expect(valueText(null)).toBe('');
    expect(valueText(undefined)).toBe('');
  });
});

describe('when the preview calls the API', () => {
  it('waits for a choice: a pasted payload, the last lead or a stored event', () => {
    expect(previewIsReady(null)).toBe(false);
    expect(previewIsReady({ kind: 'paste', payload: null })).toBe(false);
    expect(previewIsReady({ kind: 'paste', payload: { a: 1 } })).toBe(true);
    expect(previewIsReady({ kind: 'last' })).toBe(true);
    expect(previewIsReady({ kind: 'event', eventId: ID(1) })).toBe(true);
  });

  it('keys the request on its content, so the same draft is one request', () => {
    expect(previewKey({ a: 1, b: [2] })).toBe(previewKey({ a: 1, b: [2] }));
    expect(previewKey({ a: 1 })).not.toBe(previewKey({ a: 2 }));
  });
});
