import { describe, expect, it } from 'vitest';
import { slot, template, templates, uuid } from '../testing';
import {
  NO_FILTERS,
  filterTemplates,
  isFiltered,
  languageOptions,
  prefillVariables,
  previewModelOf,
  previewModelWithText,
  snippet,
  wouldPrefill,
} from './templates';

describe('template filters', () => {
  const list = templates();
  it('returns everything with no filter', () => {
    expect(filterTemplates(list, NO_FILTERS)).toHaveLength(3);
    expect(isFiltered(NO_FILTERS)).toBe(false);
  });
  it('filters by search text (name or body), language and category', () => {
    expect(filterTemplates(list, { ...NO_FILTERS, q: 'SUMMER' }).map((t) => t.name)).toEqual([
      'summer_sale',
    ]);
    expect(filterTemplates(list, { ...NO_FILTERS, q: 'your order' }).map((t) => t.name)).toEqual([
      'order_update',
    ]);
    expect(filterTemplates(list, { ...NO_FILTERS, language: 'hi' }).map((t) => t.name)).toEqual([
      'summer_sale',
    ]);
    expect(
      filterTemplates(list, { ...NO_FILTERS, category: 'authentication' }).map((t) => t.name),
    ).toEqual(['otp_code']);
    expect(filterTemplates(list, { q: 'otp', language: 'hi', category: '' })).toEqual([]);
    expect(isFiltered({ ...NO_FILTERS, q: ' x ' })).toBe(true);
  });
  it('derives language options from the data, most used first', () => {
    expect(languageOptions(list)).toEqual(['en_US', 'hi']);
    expect(languageOptions([])).toEqual([]);
  });
  it('makes a short flat snippet', () => {
    expect(snippet('a\n\nb   c')).toBe('a b c');
    expect(snippet('x'.repeat(200), 20)).toHaveLength(20);
    expect(snippet('x'.repeat(200), 20).endsWith('…')).toBe(true);
  });
});

describe('preview model', () => {
  it('shows header, body with its placeholders, footer and buttons', () => {
    const m = previewModelOf(
      template({ header: 'Order {{1}}', slots: [slot('header', 1), slot('body', 1)] }),
    );
    expect(m).toMatchObject({
      auth: false,
      language: 'en_US',
      headerKind: 'text',
      headerText: 'Order {{1}}',
      body: 'Hi {{1}}, your order {{2}} is on its way.',
      footer: 'Reply STOP to opt out',
      buttons: [{ kind: 'url', text: 'Track order' }],
    });
  });
  it('knows media headers, location and the authentication layout', () => {
    expect(
      previewModelOf(template({ attachmentType: 'image', attachmentUrl: 'https://x.test/a.png' })),
    ).toMatchObject({ headerKind: 'image', headerImageUrl: 'https://x.test/a.png' });
    expect(previewModelOf(template({ attachmentType: 'video' })).headerImageUrl).toBeNull();
    expect(previewModelOf(template({ attachmentType: 'location' })).headerKind).toBe('location');
    expect(previewModelOf(template({ category: 'authentication' })).auth).toBe(true);
    expect(previewModelOf(template()).headerKind).toBe('none');
  });
  it('maps button types and tolerates odd ones', () => {
    const m = previewModelOf(
      template({
        buttons: [
          { type: 'PHONE_NUMBER', text: 'Call' },
          { type: 'quick_reply', text: 'Yes' },
          { type: 'COPY_CODE' },
          { type: 'FLOW', text: 'Open' },
        ],
      }),
    );
    expect(m.buttons.map((b) => b.kind)).toEqual([
      'phone',
      'quick_reply',
      'copy_code',
      'quick_reply',
    ]);
    expect(m.buttons[2]!.text).toBe('');
  });
  it('can show the message resolved for a contact', () => {
    const m = previewModelWithText(template({ header: 'H {{1}}' }), {
      header: 'H Asha',
      body: 'Hi Asha',
      footer: null,
    });
    expect(m).toMatchObject({ headerText: 'H Asha', body: 'Hi Asha', footer: '' });
  });
});

describe('prefillVariables', () => {
  const slots = [
    { slot: 'body.1', key: 'first_name' },
    { slot: 'body.2', key: 'Order No' },
    { slot: 'body.3', key: 'Country Code' },
  ];
  it('maps a placeholder named after a contact field, however it is spelled', () => {
    const out = prefillVariables(slots, {});
    expect(out['body.1']).toEqual({ kind: 'field', field: 'first_name', fallback: null });
    expect(out['body.3']).toMatchObject({ field: 'country_code' });
    expect(out['body.2']).toBeUndefined();
  });
  it('maps custom properties too and never overwrites a mapping', () => {
    const existing = { 'body.1': { kind: 'fixed' as const, text: 'Hi' } };
    const out = prefillVariables(slots, existing, ['order_no']);
    expect(out['body.1']).toEqual({ kind: 'fixed', text: 'Hi' });
    expect(out['body.2']).toMatchObject({ field: 'order_no' });
    expect(wouldPrefill(existing, out)).toBe(true);
    expect(wouldPrefill(out, prefillVariables(slots, out, ['order_no']))).toBe(false);
  });
  it('ignores a key that is not a field', () => {
    expect(prefillVariables([{ slot: 'body.1', key: '1' }], {})).toEqual({});
    expect(uuid(1)).toBeTruthy();
  });
});
